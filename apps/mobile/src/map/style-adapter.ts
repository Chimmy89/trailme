/**
 * Adapter: @trailme/map-style LayerSpec → rnmapbox `style` prop.
 *
 * The shared style package emits portable Mapbox GL style-spec objects with
 * kebab-case paint/layout keys (`circle-color`, `line-gradient`). mapbox-gl
 * consumes those verbatim; rnmapbox instead wants a SINGLE `style` object with
 * camelCase keys (`circleColor`, `lineGradient`). This is the one documented
 * per-platform divergence (see the map-style README). This adapter flattens
 * `paint` + `layout` and camelCases the keys so web and mobile render the same
 * style objects from one source of truth.
 *
 * Style-spec expression VALUES (the JSON arrays) are byte-portable and pass
 * through untouched.
 */
import type { LayerSpec } from '@trailme/map-style';

/** `circle-color` → `circleColor`, `line-gradient` → `lineGradient`. */
function toCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Flattens a LayerSpec's paint + layout into one camelCased style object for an
 * rnmapbox `<*Layer style={...}>`. The rnmapbox layer `style` prop is loosely
 * typed (the upstream style-prop types resolve under skipLibCheck), so the
 * returned record is accepted directly.
 */
export function toRNMapboxStyle(spec: LayerSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries({ ...spec.paint, ...spec.layout })) {
    out[toCamel(k)] = v;
  }
  return out;
}
