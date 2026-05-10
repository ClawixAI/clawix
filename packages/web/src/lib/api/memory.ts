import type { CreateMemoryItemInput, MemoryListScope, UpdateMemoryItemInput } from '@clawix/shared';
import { authFetch } from '@/lib/auth';

export interface MemoryItem {
  id: string;
  ownerId: string;
  content: unknown;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** True iff a non-revoked MemoryShare(targetType=ORG) row exists for this item. */
  isOrgShared: boolean;
}

export const memoryApi = {
  list(scope: MemoryListScope): Promise<{ items: MemoryItem[] }> {
    return authFetch(`/memory?scope=${encodeURIComponent(scope)}`);
  },

  read(id: string): Promise<MemoryItem> {
    return authFetch(`/memory/${encodeURIComponent(id)}`);
  },

  create(input: CreateMemoryItemInput): Promise<MemoryItem> {
    return authFetch('/memory', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(id: string, input: UpdateMemoryItemInput): Promise<MemoryItem> {
    return authFetch(`/memory/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  delete(id: string): Promise<void> {
    return authFetch(`/memory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
};

/** Pull the human-facing string out of an item's content (string | { text } | JSON). */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && 'text' in content) {
    const t = (content as { text?: unknown }).text;
    if (typeof t === 'string') return t;
  }
  try {
    return JSON.stringify(content);
  } catch {
    return '';
  }
}

/** Extract the `domain:<x>` tag value (or "untagged" if none). */
export function getDomain(item: MemoryItem): string {
  const tag = item.tags.find((t) => t.startsWith('domain:'));
  return tag ? tag.slice('domain:'.length) : 'untagged';
}

/** Whether this item is shared org-wide via an active MemoryShare(ORG) row. */
export function isOrgShared(item: MemoryItem): boolean {
  return item.isOrgShared;
}

/** Tags that are not the domain tag or daily:* journal tags. */
export function freeFormTags(item: MemoryItem): string[] {
  return item.tags.filter((t) => !t.startsWith('domain:') && !t.startsWith('daily:'));
}
