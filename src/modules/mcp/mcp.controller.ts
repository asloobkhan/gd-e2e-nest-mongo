import {
  All,
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  McpChatRequest,
  McpChatResponse,
  McpInventory,
  McpToolInvocationRequest,
  McpToolInvocationResponse,
} from './mcp.types';
import { McpGatewayService } from './mcp-gateway.service';
import { McpServerService } from './mcp-server.service';

@ApiTags('mcp')
@Controller('api/mcp')
export class McpController {
  constructor(
    private readonly gateway: McpGatewayService,
    private readonly server: McpServerService,
  ) {}

  @Get('inventory')
  inventory(): McpInventory {
    return this.gateway.inventory();
  }

  @Post('invoke')
  invoke(
    @Body() body: McpToolInvocationRequest,
  ): Promise<McpToolInvocationResponse> {
    return this.gateway.invokeTool(body);
  }

  @Get('resource')
  resource(
    @Query('serverId') serverId: string,
    @Query('uri') uri: string,
  ): Promise<McpToolInvocationResponse> {
    if (!serverId || !uri) {
      throw new BadRequestException(
        'Both "serverId" and "uri" query parameters are required.',
      );
    }
    return this.gateway
      .readResource(serverId, uri)
      .then((content) => ({ content }));
  }

  @Post('chat')
  chat(@Body() body: McpChatRequest): Promise<McpChatResponse> {
    return this.gateway.chat(body);
  }

  /**
   * Native MCP Streamable HTTP transport. Native MCP clients (Claude
   * Desktop / Code, mcp-cli, etc.) point at this URL and speak the
   * protocol directly.
   */
  @All('transport')
  async transport(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.server.handleTransportRequest(
      req.raw,
      reply.raw,
      (req as FastifyRequest & { body: unknown }).body,
    );
  }
}
