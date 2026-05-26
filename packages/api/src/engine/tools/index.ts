import type { IContainerRunner } from '../container-runner.js';
import type { ToolRegistry } from '../tool-registry.js';
import {
  createEditFileTool,
  createListDirectoryTool,
  createReadFileTool,
  createWriteFileTool,
} from './file-io.js';
import { createShellTool } from './shell.js';

export { createCronTool, registerCronTools } from './cron.js';
export type { CronPolicy } from './cron.js';

/**
 * Register all built-in container tools into the given registry.
 *
 * @param registry - The ToolRegistry to register tools into.
 * @param containerId - The Docker container ID the tools will execute against.
 * @param containerRunner - The container runner used to exec commands.
 */
export function registerBuiltinTools(
  registry: ToolRegistry,
  containerId: string,
  containerRunner: IContainerRunner,
): void {
  registry.register(createShellTool(containerId, containerRunner));
  registry.register(createReadFileTool(containerId, containerRunner));
  registry.register(createWriteFileTool(containerId, containerRunner));
  registry.register(createEditFileTool(containerId, containerRunner));
  registry.register(createListDirectoryTool(containerId, containerRunner));
}
