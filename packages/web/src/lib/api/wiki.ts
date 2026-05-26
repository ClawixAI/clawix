import type {
  CreateWikiPageInput,
  UpdateWikiPageInput,
  WikiShareTarget,
  WikiGraph,
} from '@clawix/shared';
import { authFetch } from '@/lib/auth';

export interface WikiPageDto {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  scope: 'AMBIENT' | 'ARCHIVED';
  isOrgShared: boolean;
  sharedGroupIds: string[];
  isOwned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WikiListQuery {
  ownership?: 'mine' | 'visible';
  tags?: string[];
  scope?: 'AMBIENT' | 'ARCHIVED';
  q?: string;
}

export interface WikiBacklink {
  id: string;
  slug: string;
  title: string;
  summary: string;
}

export interface WikiLintFinding {
  pageId: string;
  slug: string;
  title: string;
  finding: string;
  suggestion: string;
}

export type WikiLintCheck = 'orphans' | 'missing-summaries' | 'stale-claims' | 'broken-links';

export const wikiApi = {
  list(q: WikiListQuery = {}): Promise<WikiPageDto[]> {
    const params = new URLSearchParams();
    if (q.ownership) params.set('ownership', q.ownership);
    if (q.tags?.length) params.set('tags', q.tags.join(','));
    if (q.scope) params.set('scope', q.scope);
    if (q.q) params.set('q', q.q);
    const qs = params.toString();
    return authFetch<WikiPageDto[]>(`/memory${qs ? `?${qs}` : ''}`);
  },

  graph(opts: { ownership?: 'mine' | 'visible' } = {}): Promise<WikiGraph> {
    const ownership = opts.ownership ?? 'visible';
    return authFetch<WikiGraph>(`/memory/graph?ownership=${ownership}`);
  },

  get(id: string): Promise<WikiPageDto> {
    return authFetch<WikiPageDto>(`/memory/${encodeURIComponent(id)}`);
  },

  create(input: CreateWikiPageInput): Promise<WikiPageDto> {
    return authFetch<WikiPageDto>('/memory', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(id: string, input: UpdateWikiPageInput): Promise<WikiPageDto> {
    return authFetch<WikiPageDto>(`/memory/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  delete(id: string): Promise<void> {
    return authFetch<void>(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  share(id: string, target: WikiShareTarget): Promise<{ shareId: string }> {
    return authFetch<{ shareId: string }>(`/memory/${encodeURIComponent(id)}/share`, {
      method: 'POST',
      body: JSON.stringify(target),
    });
  },

  revokeShare(shareId: string): Promise<void> {
    return authFetch<void>(`/memory/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' });
  },

  unshareOrg(id: string): Promise<void> {
    return authFetch<void>(`/memory/${encodeURIComponent(id)}/org-share`, { method: 'DELETE' });
  },

  unshareGroup(id: string, groupId: string): Promise<void> {
    return authFetch<void>(
      `/memory/${encodeURIComponent(id)}/group-share/${encodeURIComponent(groupId)}`,
      { method: 'DELETE' },
    );
  },

  backlinks(id: string): Promise<WikiBacklink[]> {
    return authFetch<WikiBacklink[]>(`/memory/${encodeURIComponent(id)}/backlinks`);
  },

  getSchema(): Promise<{ content: string }> {
    return authFetch<{ content: string }>('/memory/schema');
  },

  updateSchema(content: string): Promise<{ ok: true }> {
    return authFetch<{ ok: true }>('/memory/schema', {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  },

  lint(checks?: WikiLintCheck[]): Promise<WikiLintFinding[]> {
    return authFetch<WikiLintFinding[]>('/memory/lint', {
      method: 'POST',
      body: JSON.stringify({ checks }),
    });
  },
};
