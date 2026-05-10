/**
 * browser_snapshot tool — captures a semantic accessibility snapshot of the
 * current page, assigning @e<n> refs to interactive elements for use with
 * browser_click, browser_type, etc.
 *
 * The legacy `page.accessibility.snapshot()` API was deprecated in Playwright
 * 1.45 and removed in 1.59+. We now build the tree from CDP's
 * `Accessibility.getFullAXTree`, which returns a flat node list that we
 * reassemble into the shape the walker expects.
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../../../tool.js';
import type { BrowserSessionManager, SnapshotRefMap } from '../browser-session-manager.js';
import type { RunContextResolver } from './browser-navigate.js';

const logger = createLogger('engine:tools:browser:snapshot');

const BROWSER_OP_TIMEOUT_MS = Number(process.env['BROWSER_OP_TIMEOUT_MS'] ?? 10_000);

/** Roles that are purely decorative — skipped in compact mode. */
const DECORATIVE_ROLES = new Set(['none', 'presentation']);

/**
 * Chrome accessibility roles that aren't valid ARIA roles for `getByRole()`.
 * These either represent rendering primitives (StaticText, InlineTextBox) or
 * the page root (RootWebArea). We still surface them in `full` mode but skip
 * locator creation since `getByRole()` would throw on unknown roles.
 */
const CDP_INTERNAL_ROLES = new Set([
  'RootWebArea',
  'StaticText',
  'InlineTextBox',
  'LineBreak',
  'GenericContainer',
]);

interface A11yNode {
  role?: string;
  name?: string;
  value?: string;
  children?: A11yNode[];
}

interface CdpAxValue<T> {
  value?: T;
}

interface CdpAxNode {
  nodeId: string;
  role?: CdpAxValue<string>;
  name?: CdpAxValue<string>;
  value?: CdpAxValue<string>;
  childIds?: string[];
  ignored?: boolean;
}

interface WalkResult {
  lines: string[];
  refMap: SnapshotRefMap;
  counter: number;
}

/**
 * Reassemble CDP's flat AX node list into a hierarchical A11yNode tree
 * rooted at the `RootWebArea`. Returns null if the page has no AX tree
 * (e.g. about:blank before navigation completes).
 */
function buildTreeFromCdp(nodes: CdpAxNode[]): A11yNode | null {
  if (!nodes.length) return null;
  const byId = new Map<string, CdpAxNode>();
  for (const n of nodes) byId.set(n.nodeId, n);

  const root = nodes.find((n) => n.role?.value === 'RootWebArea') ?? nodes[0];
  if (!root) return null;

  const visited = new Set<string>();
  const convert = (n: CdpAxNode): A11yNode => {
    visited.add(n.nodeId);
    const childIds = n.childIds ?? [];
    const children: A11yNode[] = [];
    for (const id of childIds) {
      if (visited.has(id)) continue;
      const child = byId.get(id);
      if (!child || child.ignored) continue;
      children.push(convert(child));
    }
    const node: A11yNode = {};
    if (n.role?.value) node.role = n.role.value;
    if (n.name?.value) node.name = n.name.value;
    if (n.value?.value) node.value = n.value.value;
    if (children.length) node.children = children;
    return node;
  };

  return convert(root);
}

function isInteresting(node: A11yNode, full: boolean): boolean {
  if (full) return true;
  const role = node.role ?? '';
  if (DECORATIVE_ROLES.has(role)) return false;
  // Must have a role and a non-empty name for compact mode
  return !!(role && node.name);
}

function walkNode(
  node: A11yNode,
  depth: number,
  full: boolean,
  page: {
    getByRole: (role: string, opts: { name: string }) => { first: () => unknown };
  },
  result: WalkResult,
): void {
  const role = node.role ?? 'unknown';
  const name = node.name ?? '';

  if (isInteresting(node, full)) {
    result.counter += 1;
    const ref = `@e${result.counter}`;
    const indent = '  '.repeat(depth);
    const namePart = name ? ` "${name}"` : '';
    result.lines.push(`${indent}${ref} ${role}${namePart}`);

    // Store locator for interactive use. Skip Chrome-internal roles
    // (RootWebArea, StaticText, etc.) because getByRole() rejects them.
    if (role !== 'unknown' && name && !CDP_INTERNAL_ROLES.has(role)) {
      try {
        const locator = page.getByRole(role, { name }).first();
        result.refMap.set(ref, locator);
      } catch {
        result.refMap.set(ref, null);
      }
    } else {
      // Still assign a ref slot for full mode but store null as placeholder
      result.refMap.set(ref, null);
    }
  }

  if (node.children) {
    for (const child of node.children) {
      walkNode(child, depth + 1, full, page, result);
    }
  }
}

export function createBrowserSnapshotTool(
  manager: BrowserSessionManager,
  getRunContext: RunContextResolver,
): Tool {
  return {
    name: 'browser_snapshot',
    description:
      'Capture a semantic accessibility snapshot of the current page. ' +
      'Assigns @e<n> refs to interactive elements. ' +
      'Must call browser_navigate first. ' +
      'Use browser_click, browser_type, or browser_press with the returned refs.',
    parameters: {
      type: 'object',
      properties: {
        full: {
          type: 'boolean',
          description:
            'If true, include all nodes (even decorative). Default false returns compact view.',
        },
      },
      required: [],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const full = params['full'] === true;
      const ctx = getRunContext();

      const context = manager.getPlaywrightContext(ctx.runId);
      if (!context) {
        return { output: 'browser_snapshot: navigate first', isError: true };
      }

      const pages = context.pages();
      if (!pages.length) {
        return { output: 'browser_snapshot: navigate first', isError: true };
      }

      interface CdpSession {
        send(method: 'Accessibility.enable'): Promise<unknown>;
        send(method: 'Accessibility.getFullAXTree'): Promise<{ nodes: CdpAxNode[] }>;
        detach(): Promise<void>;
      }

      interface SnapshotPage {
        getByRole(role: string, opts: { name: string }): { first: () => unknown };
      }

      interface SnapshotContext {
        newCDPSession(p: unknown): Promise<CdpSession>;
      }

      const page = pages[0] as unknown as SnapshotPage;
      const cdpCtx = context as unknown as SnapshotContext;

      try {
        const cdp = await cdpCtx.newCDPSession(pages[0]);
        let tree: A11yNode | null = null;
        try {
          await cdp.send('Accessibility.enable');
          const ax = await Promise.race([
            cdp.send('Accessibility.getFullAXTree'),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(`accessibility tree timed out after ${BROWSER_OP_TIMEOUT_MS}ms`),
                  ),
                BROWSER_OP_TIMEOUT_MS,
              ),
            ),
          ]);
          tree = buildTreeFromCdp(ax.nodes);
        } finally {
          await cdp.detach().catch(() => {});
        }

        const result: WalkResult = { lines: [], refMap: new Map(), counter: 0 };

        if (tree) {
          // Walk children of root (WebArea/document) rather than the root itself
          if (tree.children) {
            for (const child of tree.children) {
              walkNode(child, 0, full, page, result);
            }
          } else {
            walkNode(tree, 0, full, page, result);
          }
        }

        manager.setSnapshotRefs(ctx.runId, result.refMap);

        const output = result.lines.length
          ? result.lines.join('\n')
          : '(no interactive elements found)';

        return { output, isError: false };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ runId: ctx.runId, reason }, 'browser_snapshot failed');
        return { output: `browser_snapshot: ${reason}`, isError: true };
      }
    },
  };
}
