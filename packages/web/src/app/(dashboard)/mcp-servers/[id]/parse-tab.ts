export type McpDetailTab = 'info' | 'tools' | 'tiers' | 'calls';

const TABS: readonly McpDetailTab[] = ['info', 'tools', 'tiers', 'calls'];

export function parseTab(raw: string | null): McpDetailTab {
  return (TABS as readonly string[]).includes(raw ?? '') ? (raw as McpDetailTab) : 'info';
}
