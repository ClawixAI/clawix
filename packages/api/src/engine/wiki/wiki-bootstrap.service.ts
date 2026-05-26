import { Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Policy } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WikiPageRepository } from '../../db/wiki-page.repository.js';
import { UserRepository } from '../../db/user.repository.js';
import { PolicyRepository } from '../../db/policy.repository.js';
import { loadSchemaTemplate } from './schema-template.js';

@Injectable()
export class WikiBootstrapService {
  private readonly logger = new Logger(WikiBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pages: WikiPageRepository,
    private readonly users: UserRepository,
    private readonly policies: PolicyRepository,
  ) {}

  /**
   * On first agent session per user (gated by User.wikiMigratedAt):
   *  1. Seed the _schema page if not already present (written directly via
   *     prisma to bypass the reserved-slug guard in WikiPageRepository).
   *  2. Split MEMORY.md by ## headers into individual WikiPages (AMBIENT up to
   *     the policy cap, then ARCHIVED).
   *  3. Stamp User.wikiMigratedAt so this runs exactly once per user.
   *
   * USER.md is intentionally NOT ingested. It remains the file-based source
   * of truth for the User Profile section, injected by BootstrapFileService
   * on every session.
   */
  async ensureMigrated(userId: string, workspaceDir: string): Promise<void> {
    // Idempotency guard — skip if already migrated.
    let user: Awaited<ReturnType<UserRepository['findById']>>;
    try {
      user = await this.users.findById(userId);
    } catch {
      // User not found — nothing to do.
      return;
    }
    if (user.wikiMigratedAt) return;

    // Resolve the ambient cap from the user's policy.
    const policy = await this.resolvePolicy(user.policyId);
    const cap = policy?.maxAmbientPages ?? 5;
    let ambientUsed = await this.pages.countAmbientOwnedBy(userId);

    const memoryDir = path.join(workspaceDir, 'memory');
    const migratedDir = path.join(memoryDir, '.migrated');
    await fs.mkdir(migratedDir, { recursive: true });

    // ── Step 1: _schema page ───────────────────────────────────────────────
    // Seeded first so it occupies an ambient slot before MEMORY.md sections
    // are processed, ensuring the total AMBIENT count never exceeds the cap.
    // Written directly via prisma to bypass the reserved-slug guard in
    // WikiPageRepository.create.
    const existing = await this.pages.findBySlug(userId, '_schema');
    if (!existing) {
      const tpl = await loadSchemaTemplate();
      await this.prisma.wikiPage.create({
        data: {
          ownerId: userId,
          title: 'Wiki Schema',
          slug: '_schema',
          summary: 'How this wiki is organized — read me on every session.',
          content: tpl,
          tags: ['kind:schema'],
          scope: 'AMBIENT',
        },
      });
      ambientUsed++;
    }

    // ── Step 2: MEMORY.md ──────────────────────────────────────────────────
    const memoryMdPath = path.join(memoryDir, 'MEMORY.md');
    if (await fileExists(memoryMdPath)) {
      const raw = (await fs.readFile(memoryMdPath, 'utf-8')).trim();
      if (raw) {
        const sections = splitByH2(raw);
        for (const section of sections) {
          const scope: 'AMBIENT' | 'ARCHIVED' = ambientUsed < cap ? 'AMBIENT' : 'ARCHIVED';
          await this.pages.create({
            ownerId: userId,
            title: section.title,
            summary: section.summary,
            content: section.body,
            tags: [],
            scope,
          });
          if (scope === 'AMBIENT') ambientUsed++;
        }
      }
      await fs.rename(memoryMdPath, path.join(migratedDir, 'MEMORY.md'));
    }

    // ── Step 3: stamp migration timestamp ─────────────────────────────────
    await this.prisma.user.update({
      where: { id: userId },
      data: { wikiMigratedAt: new Date() },
    });

    this.logger.log(`Wiki migrated for user ${userId}`);
  }

  private async resolvePolicy(policyId: string | null): Promise<Policy | null> {
    if (!policyId) return null;
    try {
      return await this.policies.findById(policyId);
    } catch {
      return null;
    }
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function firstNonEmptyLine(s: string): string {
  return (
    s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  );
}

interface Section {
  readonly title: string;
  readonly summary: string;
  readonly body: string;
}

/**
 * Split markdown by top-level `## ` headers. Each header becomes a section.
 * If no `##` headers exist, the entire content is returned as a single
 * "Notes" section.
 */
function splitByH2(content: string): readonly Section[] {
  const lines = content.split(/\r?\n/);
  const sections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const m = /^##\s+(.+)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { title: (m[1] ?? '').trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);

  if (sections.length === 0) {
    return [
      {
        title: 'Notes',
        summary: firstNonEmptyLine(content) || 'Imported from MEMORY.md',
        body: content,
      },
    ];
  }

  return sections.map((s) => {
    const body = s.lines.join('\n').trim();
    return {
      title: s.title,
      summary: firstNonEmptyLine(body) || s.title,
      body,
    };
  });
}
