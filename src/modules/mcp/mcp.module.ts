import { Module } from '@nestjs/common';

import { ProfileModule } from '../profile/profile.module';
import { McpClientService } from './mcp-client.service';
import { McpController } from './mcp.controller';
import { McpGatewayService } from './mcp-gateway.service';
import { McpServerService } from './mcp-server.service';

@Module({
  imports: [ProfileModule],
  controllers: [McpController],
  providers: [McpServerService, McpClientService, McpGatewayService],
  exports: [McpServerService, McpClientService, McpGatewayService],
})
export class McpModule {}
