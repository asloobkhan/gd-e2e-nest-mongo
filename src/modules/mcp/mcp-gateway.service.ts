import { Injectable, Logger } from '@nestjs/common';

import {
  McpChatMessage,
  McpChatRequest,
  McpChatResponse,
  McpContentBlock,
  McpInventory,
  McpServerInfo,
  McpToolInvocationRequest,
  McpToolInvocationResponse,
  McpToolSummary,
} from './mcp.types';
import { McpClientService } from './mcp-client.service';
import { McpServerService } from './mcp-server.service';

/**
 * Aggregates the local in-process MCP server with any remote MCP servers
 * the client connected to, presents a single inventory to the REST layer,
 * routes invocations, and runs a deterministic chat-preview heuristic
 * that turns a user message into a tool call when it can.
 */
@Injectable()
export class McpGatewayService {
  private readonly logger = new Logger(McpGatewayService.name);

  constructor(
    private readonly local: McpServerService,
    private readonly client: McpClientService,
  ) {}

  inventory(): McpInventory {
    const localInfo: McpServerInfo = {
      id: this.local.id,
      name: this.local.name,
      version: this.local.version,
      kind: 'local',
      connected: true,
    };
    return {
      servers: [localInfo, ...this.client.listConnections()],
      tools: [...this.local.listTools(), ...this.client.listTools()],
      resources: [
        ...this.local.listResources(),
        ...this.client.listResources(),
      ],
      prompts: this.client.listPrompts(),
    };
  }

  async invokeTool(
    request: McpToolInvocationRequest,
  ): Promise<McpToolInvocationResponse> {
    try {
      if (request.serverId === this.local.id) {
        const text = await this.local.invokeTool(
          request.name,
          request.arguments ?? {},
        );
        return { content: [{ type: 'text', text }] };
      }
      const content = await this.client.invokeTool(
        request.serverId,
        request.name,
        request.arguments ?? {},
      );
      return { content };
    } catch (err) {
      this.logger.warn(
        `MCP tool ${request.serverId}/${request.name} failed: ${
          err instanceof Error ? err.stack ?? err.message : String(err)
        }`,
      );
      return {
        isError: true,
        content: [{ type: 'text', text: 'MCP tool execution failed.' }],
      };
    }
  }

  async readResource(
    serverId: string,
    uri: string,
  ): Promise<McpContentBlock[]> {
    if (serverId === this.local.id) {
      const { text, mimeType } = await this.local.readResource(uri);
      return [{ type: 'resource', resource: { uri, mimeType, text } }];
    }
    return this.client.readResource(serverId, uri);
  }

  async chat(request: McpChatRequest): Promise<McpChatResponse> {
    const inventory = this.inventory();
    const message = request.message?.trim() ?? '';

    if (request.toolCall) {
      const tool = inventory.tools.find(
        (t) =>
          t.serverId === request.toolCall!.serverId &&
          t.name === request.toolCall!.name,
      );
      const inferred = tool && message ? this.extractArgs(message, tool) : {};
      const call: McpToolInvocationRequest = {
        ...request.toolCall,
        arguments: { ...inferred, ...(request.toolCall.arguments ?? {}) },
      };
      const result = await this.invokeTool(call);
      return { reply: this.toolMessage(call, result) };
    }

    const matched = this.matchTool(message, inventory.tools);
    if (matched) {
      const call: McpToolInvocationRequest = {
        serverId: matched.serverId,
        name: matched.name,
        arguments: this.extractArgs(message, matched),
      };
      const result = await this.invokeTool(call);
      return { reply: this.toolMessage(call, result) };
    }

    return {
      reply: {
        id: this.uuid(),
        role: 'assistant',
        text:
          inventory.tools.length === 0
            ? 'No MCP tools are registered yet. Configure MCP_CLIENT_REMOTES or add tools to the local server.'
            : `I can run ${inventory.tools.length} MCP tool(s). Try "list collections", "count profiles", or "get profile <username>".`,
        createdAt: new Date().toISOString(),
      },
      suggestedTools: inventory.tools.slice(0, 6),
    };
  }

  private matchTool(
    message: string,
    tools: McpToolSummary[],
  ): McpToolSummary | undefined {
    if (!message) return undefined;
    const lower = message.toLowerCase();
    const slash = tools.find((t) => lower.startsWith(`/${t.name}`));
    if (slash) return slash;

    if (/\b(list|show)\b.*\b(collections?|models?)\b/.test(lower)) {
      return tools.find((t) => t.name === 'list-collections');
    }
    if (/\b(count|how many)\b/.test(lower)) {
      return tools.find((t) => t.name === 'count-documents');
    }
    if (/\b(get|find|show|lookup)\b.*\bprofile\b/.test(lower)) {
      return tools.find((t) => t.name === 'get-profile');
    }
    if (/\b(find|search|query)\b.*\bdocuments?\b/.test(lower)) {
      return tools.find((t) => t.name === 'find-documents');
    }
    if (/\baggregate\b|\bpipeline\b/.test(lower)) {
      return tools.find((t) => t.name === 'aggregate-pipeline');
    }
    return undefined;
  }

  private extractArgs(
    message: string,
    tool: McpToolSummary,
  ): Record<string, unknown> {
    if (tool.name === 'get-profile') {
      const slash = message.match(/^\/get-profile\s+(\S+)/i);
      if (slash) return { username: slash[1] };
      const named = message.match(
        /(?:profile|user)(?:name)?\s+(?:is\s+)?([A-Za-z0-9_]+)/i,
      );
      if (named) return { username: named[1] };
      const trailing = message.match(/([A-Za-z0-9_]{2,})\s*$/);
      if (trailing) return { username: trailing[1] };
    }
    if (tool.name === 'count-documents') {
      const m = message.match(/\b([A-Z][A-Za-z0-9_]+)\b/);
      return { model: m ? m[1] : 'Profile' };
    }
    if (tool.name === 'find-documents') {
      const limitMatch = message.match(/\b(\d{1,3})\b/);
      const modelMatch = message.match(/\b([A-Z][A-Za-z0-9_]+)\b/);
      return {
        model: modelMatch ? modelMatch[1] : 'Profile',
        ...(limitMatch ? { limit: Number(limitMatch[1]) } : {}),
      };
    }
    return {};
  }

  private toolMessage(
    call: McpToolInvocationRequest,
    result: McpToolInvocationResponse,
  ): McpChatMessage {
    const text = result.content
      .map((c) => {
        if (c.type === 'text') return c.text;
        if (c.type === 'resource') return c.resource.text ?? c.resource.uri;
        return '[non-text content]';
      })
      .join('\n');
    return {
      id: this.uuid(),
      role: 'tool',
      text: result.isError ? `Tool error: ${text}` : text,
      toolCall: call,
      toolResult: result,
      createdAt: new Date().toISOString(),
    };
  }

  private uuid(): string {
    return (
      globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
    );
  }
}
