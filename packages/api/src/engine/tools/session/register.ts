import type { SessionSearchService } from '../../session-recall/session-search.service.js';
import type { ToolRegistry } from '../../tool-registry.js';

import { createSessionSearchTool } from './session-search.tool.js';

export interface SessionToolDeps {
  searchService: SessionSearchService;
}

export function registerSessionTools(
  registry: ToolRegistry,
  deps: SessionToolDeps,
  userId: string,
): void {
  registry.register(createSessionSearchTool(deps.searchService, userId));
}
