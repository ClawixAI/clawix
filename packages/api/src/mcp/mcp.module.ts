import { Module } from '@nestjs/common';

import { ProviderConfigModule } from '../provider-config/provider-config.module.js';
import { AdminMcpController } from './admin-mcp.controller.js';
import { McpClientService } from './mcp-client.service.js';
import { McpController } from './mcp.controller.js';
import { McpOAuthDiscoveryService } from './mcp-oauth-discovery.service.js';
import { McpService } from './mcp.service.js';
import { McpTokenManager } from './mcp-token-manager.service.js';

@Module({
  imports: [ProviderConfigModule],
  providers: [McpClientService, McpOAuthDiscoveryService, McpService, McpTokenManager],
  controllers: [McpController, AdminMcpController],
  exports: [McpClientService, McpTokenManager],
})
export class McpModule {}
