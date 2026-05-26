import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { WikiPageRepository } from '../../../db/wiki-page.repository.js';
import type { WikiLinkRepository } from '../../../db/wiki-link.repository.js';
import type { WikiShareRepository } from '../../../db/wiki-share.repository.js';
import type { WikiSearchRepository } from '../../../db/wiki-search.repository.js';
import type { AuditLogRepository } from '../../../db/audit-log.repository.js';
import type { UserRepository } from '../../../db/user.repository.js';
import type { PolicyRepository } from '../../../db/policy.repository.js';
import type { ToolRegistry } from '../../tool-registry.js';

import { createWikiIndexTool } from './wiki-index.tool.js';
import { createWikiReadTool } from './wiki-read.tool.js';
import { createWikiSearchTool } from './wiki-search.tool.js';
import { createWikiWriteTool } from './wiki-write.tool.js';
import { createWikiDeleteTool } from './wiki-delete.tool.js';
import { createWikiShareTool } from './wiki-share.tool.js';
import { createWikiUnshareTool } from './wiki-unshare.tool.js';
import { createWikiLogTool } from './wiki-log.tool.js';
import { createWikiLintTool } from './wiki-lint.tool.js';

export interface WikiToolDeps {
  prisma: PrismaService;
  pages: WikiPageRepository;
  links: WikiLinkRepository;
  shares: WikiShareRepository;
  search: WikiSearchRepository;
  audit: AuditLogRepository;
  users: UserRepository;
  policies: PolicyRepository;
}

export function registerWikiTools(
  registry: ToolRegistry,
  deps: WikiToolDeps,
  userId: string,
  opts: { lintEnabled: boolean },
): void {
  registry.register(createWikiIndexTool(deps.pages, userId));
  registry.register(createWikiReadTool(deps.pages, deps.links, userId));
  registry.register(createWikiSearchTool(deps.search, userId));
  registry.register(
    createWikiWriteTool(
      deps.pages,
      deps.links,
      deps.audit,
      deps.users,
      deps.policies,
      deps.search,
      userId,
    ),
  );
  registry.register(createWikiDeleteTool(deps.pages, deps.links, deps.audit, userId));
  registry.register(
    createWikiShareTool(deps.pages, deps.shares, deps.audit, deps.users, deps.prisma, userId),
  );
  registry.register(
    createWikiUnshareTool(deps.prisma, deps.pages, deps.shares, deps.audit, userId),
  );
  registry.register(createWikiLogTool(deps.prisma, userId));
  if (opts.lintEnabled) {
    registry.register(createWikiLintTool(deps.pages, deps.links, deps.audit, userId));
  }
}
