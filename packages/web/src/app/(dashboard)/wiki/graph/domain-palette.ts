// Curated base set: hues 60–120° apart for high mutual contrast.
// Stays in sync with the wireframe in
// docs/specs/2026-05-19-wiki-ui-redesign-design.md.
const BASE: Readonly<Record<string, string>> = Object.freeze({
  hr: '#4A90D9', // sky blue
  infra: '#84CC16', // lime
  product: '#EC4899', // magenta
  engineering: '#7C3AED', // violet
  ops: '#1ABC9C', // teal
});

const DAILY_COLOR = '#F39C12';
const UNTAGGED_COLOR = '#94A3B8';

// Brand selection accent is in 30°–50° (amber). Skip that band for
// auto-generated colors so they never clash with the UI selection state.
const RESERVED_LO = 30;
const RESERVED_HI = 50;

export function hashHue(domain: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < domain.length; i++) {
    h ^= domain.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let hue = (h >>> 0) % 360;
  if (hue >= RESERVED_LO && hue < RESERVED_HI) {
    hue = (hue + (RESERVED_HI - RESERVED_LO)) % 360;
  }
  return hue;
}

export function colorForDomain(domain: string | null, isDaily: boolean): string {
  if (!domain) return isDaily ? DAILY_COLOR : UNTAGGED_COLOR;
  if (domain in BASE) return BASE[domain]!;
  return `hsl(${hashHue(domain)}, 65%, 55%)`;
}

export const DOMAIN_PALETTE = Object.freeze({
  BASE,
  DAILY_COLOR,
  UNTAGGED_COLOR,
  RESERVED_LO,
  RESERVED_HI,
});
