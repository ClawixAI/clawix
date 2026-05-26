import * as path from 'path';

import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import * as fs from 'fs/promises';
import { existsSync } from 'fs';

import { renderTemplate } from './template-renderer.js';

const logger = createLogger('engine:workspace-seeder');

/** Explicit list of bootstrap files to seed (matches BootstrapFileService). */
const BOOTSTRAP_FILES = ['SOUL.md', 'USER.md'] as const;

/** Directory containing .template files — mounted via docker-compose or local dev fallback. */
const TEMPLATES_DIR =
  process.env['TEMPLATES_DIR'] ?? path.resolve(process.cwd(), '../../infra/templates');

export interface SeedParams {
  readonly workspacePath: string;
  readonly templateVars: Readonly<Record<string, string>>;
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

    // Seed projector templates if they exist
    await this.seedProjectorTemplates(workspacePath);
  }

  private async seedProjectorTemplates(workspacePath: string): Promise<void> {
    const projectorTemplatesDir = path.join(TEMPLATES_DIR, 'projector');
    const targetProjectorDir = path.join(workspacePath, 'projector');

    if (!existsSync(projectorTemplatesDir)) {
      logger.debug({ projectorTemplatesDir }, 'No projector templates directory found');
      return;
    }

    try {
      const entries = await fs.readdir(projectorTemplatesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;

        const sourceDir = path.join(projectorTemplatesDir, entry.name);
        const targetDir = path.join(targetProjectorDir, entry.name);

        // Skip if target already exists (idempotent)
        if (existsSync(targetDir)) {
          logger.debug({ targetDir }, 'Projector template already exists, skipping');
          continue;
        }

        await this.copyDirectory(sourceDir, targetDir);
        logger.info({ source: entry.name, targetDir }, 'Projector template seeded');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ error: message }, 'Failed to seed projector templates');
    }
  }

  private async copyDirectory(source: string, target: string): Promise<void> {
    await fs.mkdir(target, { recursive: true });

    const entries = await fs.readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(source, entry.name);
      const destPath = path.join(target, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
