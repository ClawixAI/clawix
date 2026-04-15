import * as path from 'path';

import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import * as fs from 'fs/promises';

import { renderTemplate } from './template-renderer.js';
import { extractText } from './memory-utils.js';

const logger = createLogger('engine:workspace-seeder');

/** Explicit list of bootstrap files to seed (matches BootstrapFileService). */
const BOOTSTRAP_FILES = ['SOUL.md', 'USER.md'] as const;

/** Directory containing .template files — mounted via docker-compose or local dev fallback. */
const TEMPLATES_DIR = process.env['TEMPLATES_DIR'] ?? path.resolve(process.cwd(), '../../infra/templates');

export interface SeedParams {
  readonly workspacePath: string;
  readonly templateVars: Readonly<Record<string, string>>;
  readonly existingMemoryItems?: readonly {
    readonly content: unknown;
    readonly tags: readonly string[];
  }[];
}

@Injectable()
export class WorkspaceSeederService {
  async seedWorkspace(params: SeedParams): Promise<void> {
    const { workspacePath, templateVars } = params;

    await fs.mkdir(workspacePath, { recursive: true });
    await fs.mkdir(path.join(workspacePath, 'memory'), { recursive: true });

    for (const filename of BOOTSTRAP_FILES) {
      const targetPath = path.join(workspacePath, filename);

      // Do not overwrite existing files (idempotent).
      // Note: TOCTOU race between access() and writeFile() is acceptable
      // since seeding is a one-time operation per user creation.
      try {
        await fs.access(targetPath);
        logger.debug({ targetPath }, 'Bootstrap file already exists, skipping');
        continue;
      } catch {
        // File does not exist — proceed to create
      }

      // Read and render template
      const templatePath = path.join(TEMPLATES_DIR, `${filename}.template`);
      try {
        const template = await fs.readFile(templatePath, 'utf-8');
        const rendered = renderTemplate(template, templateVars);
        await fs.writeFile(targetPath, rendered, 'utf-8');
        logger.info({ targetPath, filename }, 'Bootstrap file seeded');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ templatePath, error: message }, 'Failed to seed bootstrap file, skipping');
      }
    }

    // Seed MEMORY.md if it doesn't exist and there are existing memory items
    const memoryFilePath = path.join(workspacePath, 'memory', 'MEMORY.md');
    try {
      await fs.access(memoryFilePath);
      logger.debug({ memoryFilePath }, 'MEMORY.md already exists, skipping seed');
    } catch {
      if (params.existingMemoryItems && params.existingMemoryItems.length > 0) {
        const content = this.formatMemoryItemsAsMarkdown(params.existingMemoryItems);
        await fs.writeFile(memoryFilePath, content, 'utf-8');
        logger.info({ memoryFilePath }, 'MEMORY.md seeded from existing memory items');
      }
    }
  }

  private formatMemoryItemsAsMarkdown(
    items: readonly { readonly content: unknown; readonly tags: readonly string[] }[],
  ): string {
    const grouped = new Map<string, string[]>();
    for (const item of items) {
      const text = extractText(item.content);

      const tag = item.tags.find((t) => !t.startsWith('daily:')) ?? 'general';
      const existing = grouped.get(tag) ?? [];
      grouped.set(tag, [...existing, text]);
    }

    const sections = ['# Memory', ''];
    for (const [tag, texts] of [...grouped.entries()].sort()) {
      const heading = tag.charAt(0).toUpperCase() + tag.slice(1);
      sections.push(`## ${heading}`);
      for (const text of texts) {
        sections.push(`- ${text}`);
      }
      sections.push('');
    }

    return sections.join('\n');
  }
}
