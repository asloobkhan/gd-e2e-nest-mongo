import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'http';
import { Connection, PipelineStage } from 'mongoose';
import { z } from 'zod';

/* eslint-disable @typescript-eslint/no-explicit-any */
// The MCP SDK declares its `inputSchema` parameter against the version of
// zod it was compiled against; structural typing breaks across zod minor
// versions for ZodRecord, and the SDK's overloaded registerTool() can't
// narrow the callback when we pass the shape through any-cast. Both casts
// are at the SDK boundary only — runtime behavior is unchanged.
type ToolInputShape = Record<string, z.ZodTypeAny>;

import { ProfileService } from '../profile/profile.service';
import { McpResourceSummary, McpToolSummary } from './mcp.types';

const LOCAL_SERVER_ID = 'local';
const HARD_DOC_LIMIT = 100;

/**
 * Runs an in-process MCP server that exposes a curated, mongoose-aware
 * slice of the API. The same server backs:
 *
 *   - The native MCP Streamable HTTP transport at /api/v1/mcp/transport
 *     (Claude Desktop / Code, mcp-cli, etc.).
 *   - The internal `invokeTool` / `readResource` API used by the gateway
 *     to power the REST chat endpoint.
 *
 * Tools are deliberately gated to a whitelist of model names read from
 * MCP_ALLOWED_MODELS to avoid exposing arbitrary collection access.
 */
@Injectable()
export class McpServerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpServerService.name);
  private readonly serverName: string;
  private readonly serverVersion: string;
  private readonly allowedModels: Set<string>;

  private server!: McpServer;
  private transport?: StreamableHTTPServerTransport;
  private readonly tools: McpToolSummary[] = [];
  private readonly resources: McpResourceSummary[] = [];
  private readonly toolHandlers = new Map<
    string,
    (args: Record<string, unknown>) => Promise<string>
  >();
  private readonly resourceHandlers = new Map<
    string,
    (uri: URL) => Promise<{ text: string; mimeType?: string }>
  >();

  constructor(
    private readonly configService: ConfigService,
    private readonly profileService: ProfileService,
    @InjectConnection() private readonly connection: Connection,
  ) {
    this.serverName =
      this.configService.get<string>('MCP_SERVER_NAME') ??
      'nest-rest-mongo-mcp';
    this.serverVersion =
      this.configService.get<string>('MCP_SERVER_VERSION') ?? '1.0.0';
    const raw =
      this.configService.get<string>('MCP_ALLOWED_MODELS') ?? 'Profile';
    this.allowedModels = new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  async onModuleInit(): Promise<void> {
    this.server = new McpServer({
      name: this.serverName,
      version: this.serverVersion,
    });

    this.registerListCollectionsTool();
    this.registerCountDocumentsTool();
    this.registerFindDocumentsTool();
    this.registerAggregatePipelineTool();
    this.registerGetProfileTool();
    this.registerProfileSchemaResource();
    this.registerServerInfoResource();

    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () =>
        globalThis.crypto?.randomUUID?.() ??
        Math.random().toString(36).slice(2),
    });
    await this.server.connect(this.transport);

    this.logger.log(
      `Local MCP server "${this.serverName}@${this.serverVersion}" ready with ${this.tools.length} tools and ${this.resources.length} resources (allowed models: ${[...this.allowedModels].join(', ') || '(none)'})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.transport?.close();
    } catch (err) {
      this.logger.warn(`Failed to close MCP transport cleanly: ${err}`);
    }
  }

  get id(): string {
    return LOCAL_SERVER_ID;
  }

  get name(): string {
    return this.serverName;
  }

  get version(): string {
    return this.serverVersion;
  }

  listTools(): McpToolSummary[] {
    return this.tools;
  }

  listResources(): McpResourceSummary[] {
    return this.resources;
  }

  async invokeTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<string> {
    const handler = this.toolHandlers.get(name);
    if (!handler) {
      throw new Error(`Unknown MCP tool: ${name}`);
    }
    return handler(args);
  }

  async readResource(
    uri: string,
  ): Promise<{ text: string; mimeType?: string }> {
    const handler = this.resourceHandlers.get(uri);
    if (!handler) {
      throw new Error(`Unknown MCP resource: ${uri}`);
    }
    return handler(new URL(uri));
  }

  async handleTransportRequest(
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<void> {
    if (!this.transport) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'MCP transport not initialised yet' }));
      return;
    }
    await this.transport.handleRequest(req, res, body);
  }

  private assertAllowedModel(modelName: string): void {
    if (!this.allowedModels.has(modelName)) {
      throw new Error(
        `Model "${modelName}" is not in the MCP_ALLOWED_MODELS whitelist`,
      );
    }
  }

  private collectionFor(modelName: string) {
    this.assertAllowedModel(modelName);
    const model = this.connection.models[modelName];
    if (!model) {
      throw new Error(`Unknown mongoose model: ${modelName}`);
    }
    return model;
  }

  private clampLimit(value: unknown, fallback = 25): number {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.max(1, Math.min(n, HARD_DOC_LIMIT));
  }

  private registerListCollectionsTool(): void {
    const description =
      'List every mongoose model the MCP server is allowed to inspect (controlled by MCP_ALLOWED_MODELS).';
    (this.server.registerTool as any)(
      'list-collections',
      { description, inputSchema: {} },
      async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify([...this.allowedModels], null, 2),
          },
        ],
      }),
    );
    this.tools.push({
      name: 'list-collections',
      description,
      serverId: LOCAL_SERVER_ID,
      inputSchema: { type: 'object', properties: {} },
    });
    this.toolHandlers.set('list-collections', async () =>
      JSON.stringify([...this.allowedModels], null, 2),
    );
  }

  private registerCountDocumentsTool(): void {
    const description =
      'Count documents in an allowed collection that match an optional filter.';
    const inputSchema: ToolInputShape = {
      model: z.string().min(1),
      filter: z.record(z.unknown()).optional(),
    };
    (this.server.registerTool as any)(
      'count-documents',
      { description, inputSchema: inputSchema as any },
      async ({ model, filter }: { model: string; filter?: Record<string, unknown> }) => {
        const collection = this.collectionFor(model);
        const count = await collection.countDocuments(filter ?? {}).exec();
        return {
          content: [{ type: 'text', text: String(count) }],
        };
      },
    );
    this.tools.push({
      name: 'count-documents',
      description,
      serverId: LOCAL_SERVER_ID,
      inputSchema: {
        type: 'object',
        required: ['model'],
        properties: {
          model: { type: 'string', minLength: 1 },
          filter: { type: 'object', additionalProperties: true },
        },
      },
    });
    this.toolHandlers.set('count-documents', async (args) => {
      const collection = this.collectionFor(String(args.model ?? ''));
      const filter = (args.filter as Record<string, unknown>) ?? {};
      const count = await collection.countDocuments(filter).exec();
      return String(count);
    });
  }

  private registerFindDocumentsTool(): void {
    const description = `Run a find() on an allowed collection, optionally filtered and projected. Limit is clamped to ${HARD_DOC_LIMIT}.`;
    const inputSchema: ToolInputShape = {
      model: z.string().min(1),
      filter: z.record(z.unknown()).optional(),
      projection: z.record(z.unknown()).optional(),
      limit: z.number().int().min(1).max(HARD_DOC_LIMIT).optional(),
    };
    (this.server.registerTool as any)(
      'find-documents',
      { description, inputSchema: inputSchema as any },
      async ({
        model,
        filter,
        projection,
        limit,
      }: {
        model: string;
        filter?: Record<string, unknown>;
        projection?: Record<string, unknown>;
        limit?: number;
      }) => {
        const collection = this.collectionFor(model);
        const safeLimit = this.clampLimit(limit);
        const docs = await collection
          .find(filter ?? {}, projection ?? null)
          .limit(safeLimit)
          .lean()
          .exec();
        return {
          content: [{ type: 'text', text: JSON.stringify(docs, null, 2) }],
        };
      },
    );
    this.tools.push({
      name: 'find-documents',
      description,
      serverId: LOCAL_SERVER_ID,
      inputSchema: {
        type: 'object',
        required: ['model'],
        properties: {
          model: { type: 'string', minLength: 1 },
          filter: { type: 'object', additionalProperties: true },
          projection: { type: 'object', additionalProperties: true },
          limit: { type: 'integer', minimum: 1, maximum: HARD_DOC_LIMIT },
        },
      },
    });
    this.toolHandlers.set('find-documents', async (args) => {
      const collection = this.collectionFor(String(args.model ?? ''));
      const filter = (args.filter as Record<string, unknown>) ?? {};
      const projection = (args.projection as Record<string, unknown>) ?? null;
      const safeLimit = this.clampLimit(args.limit);
      const docs = await collection
        .find(filter, projection)
        .limit(safeLimit)
        .lean()
        .exec();
      return JSON.stringify(docs, null, 2);
    });
  }

  private registerAggregatePipelineTool(): void {
    const description = `Run an aggregation pipeline against an allowed collection. The final stage is forced to $limit ${HARD_DOC_LIMIT} so the response stays bounded.`;
    const inputSchema: ToolInputShape = {
      model: z.string().min(1),
      pipeline: z.array(z.record(z.unknown())),
    };
    (this.server.registerTool as any)(
      'aggregate-pipeline',
      { description, inputSchema: inputSchema as any },
      async ({
        model,
        pipeline,
      }: {
        model: string;
        pipeline: Record<string, unknown>[];
      }) => {
        const collection = this.collectionFor(model);
        const safePipeline = [
          ...pipeline,
          { $limit: HARD_DOC_LIMIT },
        ] as unknown as PipelineStage[];
        const docs = await collection.aggregate(safePipeline).exec();
        return {
          content: [{ type: 'text', text: JSON.stringify(docs, null, 2) }],
        };
      },
    );
    this.tools.push({
      name: 'aggregate-pipeline',
      description,
      serverId: LOCAL_SERVER_ID,
      inputSchema: {
        type: 'object',
        required: ['model', 'pipeline'],
        properties: {
          model: { type: 'string', minLength: 1 },
          pipeline: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
    });
    this.toolHandlers.set('aggregate-pipeline', async (args) => {
      const collection = this.collectionFor(String(args.model ?? ''));
      const pipeline = Array.isArray(args.pipeline)
        ? (args.pipeline as Record<string, unknown>[])
        : [];
      const safePipeline = [
        ...pipeline,
        { $limit: HARD_DOC_LIMIT },
      ] as unknown as PipelineStage[];
      const docs = await collection.aggregate(safePipeline).exec();
      return JSON.stringify(docs, null, 2);
    });
  }

  private registerGetProfileTool(): void {
    const description = 'Fetch a profile by username from the Profile model.';
    const inputSchema: ToolInputShape = { username: z.string().min(1) };
    (this.server.registerTool as any)(
      'get-profile',
      { description, inputSchema: inputSchema as any },
      async ({ username }: { username: string }) => {
        const profile = await this.profileService.getByUsername(username);
        if (!profile) {
          return {
            isError: true,
            content: [
              { type: 'text', text: `No profile named "${username}"` },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  _id: profile._id.toString(),
                  username: profile.username,
                  email: profile.email,
                  name: profile.name,
                  avatar: profile.avatar,
                  roles: profile.roles,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );
    this.tools.push({
      name: 'get-profile',
      description,
      serverId: LOCAL_SERVER_ID,
      inputSchema: {
        type: 'object',
        required: ['username'],
        properties: { username: { type: 'string', minLength: 1 } },
      },
    });
    this.toolHandlers.set('get-profile', async (args) => {
      const username = String(args.username ?? '');
      if (!username) {
        throw new Error('username is required');
      }
      const profile = await this.profileService.getByUsername(username);
      if (!profile) {
        return `No profile named "${username}"`;
      }
      return JSON.stringify(
        {
          _id: profile._id.toString(),
          username: profile.username,
          email: profile.email,
          name: profile.name,
          avatar: profile.avatar,
          roles: profile.roles,
        },
        null,
        2,
      );
    });
  }

  private registerProfileSchemaResource(): void {
    const uri = 'mcp://nest/schema/profile';
    const text = JSON.stringify(
      {
        model: 'Profile',
        fields: {
          _id: 'ObjectId',
          username: 'string (unique, indexed)',
          email: 'string',
          name: 'string',
          password: 'string (sha256, hidden by app conventions)',
          avatar: 'string (gravatar url)',
          roles: 'string[] (AppRoles enum: DEFAULT | ADMIN)',
          date: 'Date',
        },
      },
      null,
      2,
    );
    this.server.registerResource(
      'profile-schema',
      uri,
      {
        title: 'Profile schema',
        description: 'Static description of the Profile mongoose schema.',
        mimeType: 'application/json',
      },
      async () => ({
        contents: [{ uri, mimeType: 'application/json', text }],
      }),
    );
    this.resources.push({
      uri,
      name: 'Profile schema',
      description: 'Static description of the Profile mongoose schema.',
      mimeType: 'application/json',
      serverId: LOCAL_SERVER_ID,
    });
    this.resourceHandlers.set(uri, async () => ({
      text,
      mimeType: 'application/json',
    }));
  }

  private registerServerInfoResource(): void {
    const uri = 'mcp://nest/server-info';
    this.server.registerResource(
      'server-info',
      uri,
      {
        title: 'Server info',
        description: 'Name, version, and runtime info for this MCP server.',
        mimeType: 'application/json',
      },
      async () => {
        const text = JSON.stringify(
          {
            name: this.serverName,
            version: this.serverVersion,
            node: process.version,
            uptimeSeconds: Math.round(process.uptime()),
            allowedModels: [...this.allowedModels],
          },
          null,
          2,
        );
        return {
          contents: [{ uri, mimeType: 'application/json', text }],
        };
      },
    );
    this.resources.push({
      uri,
      name: 'Server info',
      description: 'Name, version, and runtime info for this MCP server.',
      mimeType: 'application/json',
      serverId: LOCAL_SERVER_ID,
    });
    this.resourceHandlers.set(uri, async () => ({
      text: JSON.stringify(
        {
          name: this.serverName,
          version: this.serverVersion,
          node: process.version,
          uptimeSeconds: Math.round(process.uptime()),
          allowedModels: [...this.allowedModels],
        },
        null,
        2,
      ),
      mimeType: 'application/json',
    }));
  }
}
