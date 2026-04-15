/**
 * File I/O tools — read, write, edit, and list files inside a container.
 *
 * Security: all paths are validated to remain within /workspace to prevent
 * path traversal attacks.
 */
import path from 'path';

import { createLogger } from '@clawix/shared';

import type { IContainerRunner } from '../container-runner.js';
import type { Tool, ToolResult } from '../tool.js';

const logger = createLogger('engine:tools:file-io');

const WORKSPACE_ROOT = '/workspace';
const SKILLS_ROOT = '/skills';

/** Directories the agent is allowed to access inside the container. */
const ALLOWED_ROOTS = [WORKSPACE_ROOT, SKILLS_ROOT] as const;

// ------------------------------------------------------------------ //
//  Path validation                                                    //
// ------------------------------------------------------------------ //

/**
 * Normalize and validate a path for container use.
 * Uses posix normalization and ensures the resolved path remains within
 * an allowed root (/workspace or /skills).
 *
 * @param inputPath - The user-supplied path.
 * @returns The normalized absolute path.
 * @throws If the path escapes the allowed directories.
 */
export function validateContainerPath(inputPath: string): string {
  const normalized = path.posix.normalize(inputPath);

  const isAllowed = ALLOWED_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );

  if (!isAllowed) {
    throw new Error(
      `Path "${inputPath}" is outside the allowed directories (${ALLOWED_ROOTS.join(', ')})`,
    );
  }

  return normalized;
}

// ------------------------------------------------------------------ //
//  read_file                                                          //
// ------------------------------------------------------------------ //

/**
 * Create a read_file tool that reads the contents of a file from the container.
 */
export function createReadFileTool(containerId: string, containerRunner: IContainerRunner): Tool {
  return {
    name: 'read_file',
    description: 'Read the contents of a file from the container filesystem.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Path to the file to read (must be within ${WORKSPACE_ROOT} or ${SKILLS_ROOT}).`,
        },
      },
      required: ['path'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const rawPath = params['path'] as string;

      let validatedPath: string;
      try {
        validatedPath = validateContainerPath(rawPath);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { output: message, isError: true };
      }

      logger.debug({ containerId, path: validatedPath }, 'Reading file');

      const result = await containerRunner.exec(containerId, ['cat', validatedPath]);

      if (result.exitCode !== 0) {
        const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
        return { output: combined || `Failed to read file: ${validatedPath}`, isError: true };
      }

      return { output: result.stdout, isError: false };
    },
  };
}

// ------------------------------------------------------------------ //
//  write_file                                                         //
// ------------------------------------------------------------------ //

/**
 * Create a write_file tool that writes content to a file in the container.
 * Creates parent directories if they do not exist.
 */
export function createWriteFileTool(containerId: string, containerRunner: IContainerRunner): Tool {
  return {
    name: 'write_file',
    description:
      'Write content to a file in the container filesystem. Creates parent directories as needed.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Path to the file to write (must be within ${WORKSPACE_ROOT} or ${SKILLS_ROOT}).`,
        },
        content: {
          type: 'string',
          description: 'Content to write to the file.',
        },
      },
      required: ['path', 'content'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const rawPath = params['path'] as string;
      const content = params['content'] as string;

      let validatedPath: string;
      try {
        validatedPath = validateContainerPath(rawPath);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { output: message, isError: true };
      }

      const parentDir = path.posix.dirname(validatedPath);

      logger.debug({ containerId, path: validatedPath, parentDir }, 'Writing file');

      // Ensure parent directory exists
      const mkdirResult = await containerRunner.exec(containerId, ['mkdir', '-p', parentDir]);
      if (mkdirResult.exitCode !== 0) {
        const combined = [mkdirResult.stdout, mkdirResult.stderr].filter(Boolean).join('\n');
        return {
          output: combined || `Failed to create directory: ${parentDir}`,
          isError: true,
        };
      }

      // Write content via tee
      const teeResult = await containerRunner.exec(containerId, ['tee', validatedPath], {
        stdin: content,
      });

      if (teeResult.exitCode !== 0) {
        const combined = [teeResult.stdout, teeResult.stderr].filter(Boolean).join('\n');
        return { output: combined || `Failed to write file: ${validatedPath}`, isError: true };
      }

      return { output: `File written: ${validatedPath}`, isError: false };
    },
  };
}

// ------------------------------------------------------------------ //
//  edit_file                                                          //
// ------------------------------------------------------------------ //

/**
 * Create an edit_file tool that replaces exactly one occurrence of old_text with new_text.
 * Fails if old_text appears zero or more than one time in the file.
 */
export function createEditFileTool(containerId: string, containerRunner: IContainerRunner): Tool {
  const readTool = createReadFileTool(containerId, containerRunner);
  const writeTool = createWriteFileTool(containerId, containerRunner);

  return {
    name: 'edit_file',
    description:
      'Edit a file by replacing exactly one occurrence of old_text with new_text. Fails if old_text is not found or appears more than once.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Path to the file to edit (must be within ${WORKSPACE_ROOT} or ${SKILLS_ROOT}).`,
        },
        old_text: {
          type: 'string',
          description: 'The text to replace. Must appear exactly once in the file.',
        },
        new_text: {
          type: 'string',
          description: 'The replacement text.',
        },
      },
      required: ['path', 'old_text', 'new_text'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const rawPath = params['path'] as string;
      const oldText = params['old_text'] as string;
      const newText = params['new_text'] as string;

      // Validate path early
      try {
        validateContainerPath(rawPath);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { output: message, isError: true };
      }

      logger.debug({ containerId, path: rawPath }, 'Editing file');

      // Read current contents
      const readResult = await readTool.execute({ path: rawPath });
      if (readResult.isError) {
        return readResult;
      }

      const currentContent = readResult.output;

      // Count occurrences of old_text
      const occurrences = currentContent.split(oldText).length - 1;
      if (occurrences === 0) {
        return {
          output: `edit_file failed: old_text not found in ${rawPath}`,
          isError: true,
        };
      }
      if (occurrences > 1) {
        return {
          output: `edit_file failed: old_text found ${occurrences} times in ${rawPath} — must appear exactly once`,
          isError: true,
        };
      }

      const updatedContent = currentContent.replace(oldText, newText);

      // Write updated content
      return writeTool.execute({ path: rawPath, content: updatedContent });
    },
  };
}

// ------------------------------------------------------------------ //
//  list_directory                                                     //
// ------------------------------------------------------------------ //

/**
 * Create a list_directory tool that lists files in a container directory.
 */
export function createListDirectoryTool(
  containerId: string,
  containerRunner: IContainerRunner,
): Tool {
  return {
    name: 'list_directory',
    description: `List files and directories. Path must be within ${WORKSPACE_ROOT} or ${SKILLS_ROOT}. Defaults to ${WORKSPACE_ROOT}.`,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Directory to list (must be within ${WORKSPACE_ROOT} or ${SKILLS_ROOT}; defaults to ${WORKSPACE_ROOT}).`,
        },
      },
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const rawPath = typeof params['path'] === 'string' ? params['path'] : WORKSPACE_ROOT;

      let validatedPath: string;
      try {
        validatedPath = validateContainerPath(rawPath);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { output: message, isError: true };
      }

      logger.debug({ containerId, path: validatedPath }, 'Listing directory');

      const result = await containerRunner.exec(containerId, ['ls', '-la', validatedPath]);

      if (result.exitCode !== 0) {
        const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
        return {
          output: combined || `Failed to list directory: ${validatedPath}`,
          isError: true,
        };
      }

      return { output: result.stdout, isError: false };
    },
  };
}
