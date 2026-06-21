/**
 * Deterministic per-guard colour.
 *
 * `guardColor(seed)` maps any stable string (a guard's UUID) to one of a fixed
 * set of high-contrast hues. Determinism matters because web and mobile must
 * tint the SAME guard identically without coordinating — both call this with
 * the guard id and get the same hex back. The heatmap is intentionally NOT
 * per-guard tinted (monochrome recency density); this palette is for live
 * markers and per-guard trail lines only.
 */

/**
 * 12-hue qualitative palette chosen for contrast against both light and dark
 * basemaps and reasonable separability for the common deuteranopia case.
 */
export const GUARD_PALETTE = [
  '#e6194b', // red
  '#3cb44b', // green
  '#4363d8', // blue
  '#f58231', // orange
  '#911eb4', // purple
  '#0ea5e9', // sky
  '#bfa800', // gold
  '#f032e6', // magenta
  '#1f9e89', // teal
  '#9a6324', // brown
  '#808000', // olive
  '#000075', // navy
] as const;

/** FNV-1a 32-bit hash — small, fast, stable across JS engines (web + Hermes). */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept in unsigned range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic hex colour for a guard, derived from a stable seed (its id). */
export function guardColor(seed: string): string {
  const index = fnv1a(seed) % GUARD_PALETTE.length;
  // Index is always in range; the assertion satisfies noUncheckedIndexedAccess.
  return GUARD_PALETTE[index]!;
}
