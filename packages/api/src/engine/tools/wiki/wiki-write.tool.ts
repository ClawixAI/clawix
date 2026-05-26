import type { WikiPageRepository } from '../../../db/wiki-page.repository.js';
import type { WikiLinkRepository } from '../../../db/wiki-link.repository.js';
import type { WikiSearchRepository } from '../../../db/wiki-search.repository.js';
import type { AuditLogRepository } from '../../../db/audit-log.repository.js';
import type { UserRepository } from '../../../db/user.repository.js';
import type { PolicyRepository } from '../../../db/policy.repository.js';
import type { Policy } from '../../../generated/prisma/client.js';
import type { Tool, ToolResult } from '../../tool.js';
import { parseWikiLinks } from '../../wiki/parse-wiki-links.js';
import { createLogger } from '@clawix/shared';

const logger = createLogger('engine:tools:wiki-write');

const CANDIDATE_LINK_LIMIT = 5;
const CANDIDATE_SEARCH_LIMIT = 15;

const MAX_CONTENT = 10000;
const MAX_SUMMARY = 200;
const MAX_TAGS = 20;
const MAX_TAG_LEN = 50;
const RESERVED_SLUGS = new Set(['_schema']);

/**
 * Create or update a wiki page.
 *
 * Handles:
 *  - Input validation (length caps, tag rules, reserved slugs)
 *  - Ambient-page cap enforcement via user → policy lookup
 *  - Backlink rebuild after every write
 *  - Audit logging (wiki.create / wiki.update / wiki.scope_change)
 *  - Best-effort cross-link suggestions in the response so the agent can
 *    discover related pages it didn't think to link to.
 *
 * @param pages      WikiPageRepository for CRUD operations
 * @param links      WikiLinkRepository for [[slug]] backlink reconciliation
 * @param audit      AuditLogRepository for structured audit rows
 * @param users      UserRepository to resolve the caller's policyId
 * @param policies   PolicyRepository to look up ambient-page cap
 * @param search     WikiSearchRepository for post-write candidate-link lookup
 * @param userId     The authenticated caller's id (injected by the runner)
 */
export function createWikiWriteTool(
  pages: WikiPageRepository,
  links: WikiLinkRepository,
  audit: AuditLogRepository,
  users: UserRepository,
  policies: PolicyRepository,
  search: WikiSearchRepository,
  userId: string,
): Tool {
  return {
    name: 'wiki_write',
    description:
      'Create or update a wiki page. To update, pass `pageId`. ' +
      'Before writing a new page, scan the Wiki Index in your system prompt for related pages ' +
      "and call `wiki_search` whenever the index is large or you're not sure — both to avoid " +
      'duplicating existing pages AND to find related ones you should cross-link. ' +
      'Always link to related pages with `[[slug]]` markers in the content — those become ' +
      'backlinks future-you can navigate, and isolated pages decay into noise. ' +
      'After a successful write this tool returns `candidateLinks` — review them and, when ' +
      'genuinely related, follow up with another `wiki_write` to add the `[[slug]]` markers ' +
      '(either to this page or to the related ones, so the connection works in both directions). ' +
      'Do NOT use this for user-profile facts (name, timezone, role, preferences, work context) — ' +
      'those belong in `/workspace/USER.md` (write with `edit_file`); duplicating them to the wiki ' +
      'creates two sources of truth that drift. ' +
      "Mark scope:'AMBIENT' only when this page is something the user should know about without " +
      "asking (e.g. current project state, ongoing initiatives). Default 'ARCHIVED'.",
    parameters: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Update this page if provided; otherwise create new.',
        },
        title: {
          type: 'string',
          description: 'Page title; slug derived from this.',
        },
        summary: {
          type: 'string',
          description: 'One-liner shown in the index. Required for new pages; ≤200 chars.',
        },
        content: {
          type: 'string',
          description: 'Markdown body. Use [[slug]] to link other pages. ≤10000 chars.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags. One domain:<x> tag required when non-daily tags present.',
        },
        scope: {
          type: 'string',
          enum: ['AMBIENT', 'ARCHIVED'],
          description: "Default 'ARCHIVED'.",
        },
      },
      required: ['title', 'content'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const pageId = params['pageId'] as string | undefined;
      const title = String(params['title'] ?? '').trim();
      const summary = params['summary'] !== undefined ? String(params['summary']) : '';
      const content = String(params['content'] ?? '');
      const rawTags = Array.isArray(params['tags']) ? (params['tags'] as string[]) : [];
      const scope = params['scope'] as 'AMBIENT' | 'ARCHIVED' | undefined;

      // ── Validation ──────────────────────────────────────────────────────────
      if (title.length === 0) {
        return err('Title is required and must contain non-whitespace characters.');
      }
      if (content.length > MAX_CONTENT) {
        return err(`Content too long (max ${MAX_CONTENT} chars).`);
      }
      if (summary.length > MAX_SUMMARY) {
        return err(`Summary too long (max ${MAX_SUMMARY} chars).`);
      }
      if (rawTags.length > MAX_TAGS) {
        return err(`Too many tags (max ${MAX_TAGS}).`);
      }
      if (rawTags.some((t) => t.length > MAX_TAG_LEN)) {
        return err(`Tag too long (max ${MAX_TAG_LEN} chars).`);
      }

      const normalizedTags = rawTags.map((t) => t.toLowerCase());
      const domainTags = normalizedTags.filter((t) => t.startsWith('domain:'));
      const dailyTags = normalizedTags.filter((t) => t.startsWith('daily:'));
      const otherTags = normalizedTags.filter(
        (t) => !t.startsWith('domain:') && !t.startsWith('daily:'),
      );

      // When non-daily tags are present, exactly one domain:* tag is required.
      if (otherTags.length > 0 && domainTags.length !== 1 && dailyTags.length === 0) {
        return err('When using non-daily tags, exactly one `domain:<x>` tag is required.');
      }
      if (domainTags.length > 1) {
        return err('Exactly one `domain:<x>` tag is allowed; found multiple.');
      }

      if (!pageId) {
        const slug = slugifyForCheck(title);
        if (RESERVED_SLUGS.has(slug)) {
          return err(`Slug "${slug}" is reserved.`);
        }
      }

      // ── Resolve ambient cap once (used both for the pre-check and for the
      // atomic create/setScope helpers below). ─────────────────────────────────
      const user = await users.findById(userId);
      const policy: Policy = await policies.findById(user.policyId);
      const cap: number = policy.maxAmbientPages ?? 5;

      // ── Fetch previous page once (used for both the scope-change audit and
      // the ambient short-circuit check). ─────────────────────────────────────
      const previousPage = pageId ? await pages.findById(pageId) : null;
      const previousScope = previousPage?.scope;

      // ── Create or update ────────────────────────────────────────────────────
      let resultPage;
      try {
        if (pageId) {
          // Promote-to-AMBIENT goes through the atomic helper so the cap is
          // enforced under a serializable count+update window.
          if (scope === 'AMBIENT' && previousScope !== 'AMBIENT') {
            const promoted = await pages.setScopeWithAmbientCap(userId, pageId, 'AMBIENT', cap);
            if (!promoted) return err('Page not found or not yours.');
          }
          resultPage = await pages.updateByOwner(userId, pageId, {
            title,
            summary,
            content,
            tags: normalizedTags,
            scope,
          });
          if (!resultPage) {
            return err('Page not found or not yours.');
          }
        } else {
          resultPage = await pages.createWithAmbientCap(
            {
              ownerId: userId,
              title,
              summary,
              content,
              tags: normalizedTags,
              scope,
            },
            cap,
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message === 'AMBIENT_CAP_REACHED') {
          const ambientList = await pages.listOwnedByUser(userId, {
            scope: 'AMBIENT',
            limit: cap,
          });
          const body = {
            cap,
            currentAmbient: ambientList.map((p) => ({
              id: p.id,
              title: p.title,
              updatedAt: p.updatedAt.toISOString(),
            })),
          };
          return { output: `WIKI_AMBIENT_FULL: ${JSON.stringify(body)}`, isError: true };
        }
        throw e;
      }

      // ── Backlink rebuild ─────────────────────────────────────────────────────
      await links.rebuildForPage(resultPage.id, userId, content);

      // ── Audit ────────────────────────────────────────────────────────────────
      // Exclude `pageId` from the changed-fields list — it identifies the row,
      // it is not itself a field being mutated.
      const fieldsChanged = Object.keys(params).filter((k) => k !== 'pageId');
      await audit.create({
        userId,
        action: pageId ? 'wiki.update' : 'wiki.create',
        resource: 'wiki_page',
        resourceId: resultPage.id,
        details: pageId
          ? { slug: resultPage.slug, fieldsChanged }
          : { slug: resultPage.slug, title: resultPage.title, scope: resultPage.scope },
      });

      if (scope !== undefined && previousScope !== undefined && scope !== previousScope) {
        await audit.create({
          userId,
          action: 'wiki.scope_change',
          resource: 'wiki_page',
          resourceId: resultPage.id,
          details: { from: previousScope, to: scope },
        });
      }

      // ── Candidate-link suggestions ───────────────────────────────────────────
      // Best-effort: run a similarity search over visible pages and surface any
      // that aren't already linked, so the agent can follow up with [[slug]]
      // markers. Never let a search failure break the write.
      const candidateLinks = await findCandidateLinks(
        search,
        userId,
        resultPage.id,
        title,
        summary,
        content,
      );

      const payload: {
        pageId: string;
        slug: string;
        action: 'created' | 'updated';
        candidateLinks?: { slug: string; title: string; summary: string }[];
        hint?: string;
      } = {
        pageId: resultPage.id,
        slug: resultPage.slug,
        action: pageId ? 'updated' : 'created',
      };
      if (candidateLinks.length > 0) {
        payload.candidateLinks = candidateLinks;
        payload.hint =
          'These existing pages look related. If any are genuinely related, call `wiki_write` ' +
          `again to add [[slug]] markers to this page, or update those pages to backlink to [[${resultPage.slug}]]. ` +
          'Skip ones that are only tangentially related.';
      }

      return { output: JSON.stringify(payload), isError: false };
    },
  };
}

/**
 * Run a similarity search against visible pages and return up to
 * `CANDIDATE_LINK_LIMIT` candidates, excluding the just-saved page and any
 * slugs the agent already linked to from this page's content.
 *
 * Best-effort: errors are logged and swallowed (returns `[]`) so a search
 * failure never breaks the write itself.
 */
async function findCandidateLinks(
  search: WikiSearchRepository,
  userId: string,
  savedPageId: string,
  title: string,
  summary: string,
  content: string,
): Promise<{ slug: string; title: string; summary: string }[]> {
  const queryParts = [title, summary, content.slice(0, 200)].filter((p) => p.trim().length > 0);
  const query = queryParts.join(' ').slice(0, 500).trim();
  if (query.length === 0) return [];

  try {
    const alreadyLinked = new Set(parseWikiLinks(content));
    const hits = await search.search({
      userId,
      query,
      ownership: 'visible',
      limit: CANDIDATE_SEARCH_LIMIT,
    });
    return hits
      .filter((h) => h.id !== savedPageId && !alreadyLinked.has(h.slug))
      .slice(0, CANDIDATE_LINK_LIMIT)
      .map((h) => ({ slug: h.slug, title: h.title, summary: h.summary }));
  } catch (err) {
    logger.warn({ userId, savedPageId, err }, 'Candidate-link search failed; returning none');
    return [];
  }
}

function err(msg: string): ToolResult {
  return { output: msg, isError: true };
}

/**
 * Quick slug derivation for reserved-slug checking only.
 * The real slug (with uniqueness) is handled inside WikiPageRepository.create.
 */
function slugifyForCheck(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (NFKD output)
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}
