/**
 * Browser tools registration. Tools register only when a BrowserProvider is
 * active. If the registry has no active provider, nothing registers and
 * existing web_* tools keep working.
 *
 * Every tool is wrapped with `withInstrumentation` so each execute() call
 * emits a structured info log: {runId, userId, tool, durationMs, isError}.
 */
import type { ToolRegistry } from '../../../tool-registry.js';
import type { BrowserSessionManager } from '../browser-session-manager.js';
import type { BrowserProviderRegistry } from '../browser-provider-registry.js';
import type { RunContextResolver } from './browser-navigate.js';
import { createBrowserNavigateTool } from './browser-navigate.js';
import { createBrowserSnapshotTool } from './browser-snapshot.js';
import { createBrowserClickTool } from './browser-click.js';
import { createBrowserTypeTool } from './browser-type.js';
import { createBrowserPressTool } from './browser-press.js';
import { createBrowserScrollTool } from './browser-scroll.js';
import { createBrowserBackTool } from './browser-back.js';
import { createBrowserConsoleTool } from './browser-console.js';
import { createBrowserGetImagesTool } from './browser-get-images.js';
import { createBrowserDialogTool } from './browser-dialog.js';
import { createBrowserVisionTool } from './browser-vision.js';
import { createBrowserCdpTool } from './browser-cdp.js';
import { withInstrumentation } from './with-instrumentation.js';

export function registerBrowserTools(
  registry: ToolRegistry,
  providerRegistry: BrowserProviderRegistry,
  manager: BrowserSessionManager,
  getRunContext: RunContextResolver,
): void {
  if (!providerRegistry.getActive()) return;
  const wrap = (tool: ReturnType<typeof createBrowserNavigateTool>) =>
    withInstrumentation(tool, getRunContext);
  registry.register(wrap(createBrowserNavigateTool(manager, getRunContext)));
  registry.register(wrap(createBrowserSnapshotTool(manager, getRunContext)));
  registry.register(wrap(createBrowserClickTool(manager, getRunContext)));
  registry.register(wrap(createBrowserTypeTool(manager, getRunContext)));
  registry.register(wrap(createBrowserPressTool(manager, getRunContext)));
  registry.register(wrap(createBrowserScrollTool(manager, getRunContext)));
  registry.register(wrap(createBrowserBackTool(manager, getRunContext)));
  registry.register(wrap(createBrowserConsoleTool(manager, getRunContext)));
  registry.register(wrap(createBrowserGetImagesTool(manager, getRunContext)));
  registry.register(wrap(createBrowserDialogTool(manager, getRunContext)));
  registry.register(wrap(createBrowserVisionTool(manager, getRunContext)));
  registry.register(wrap(createBrowserCdpTool(manager, getRunContext)));
}
