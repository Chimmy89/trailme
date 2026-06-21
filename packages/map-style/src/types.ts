/**
 * Minimal local typings for the slice of the Mapbox GL style spec we emit.
 *
 * We deliberately do NOT depend on `mapbox-gl` or `@rnmapbox/maps` types: this
 * package emits plain JSON that BOTH libraries accept. A style-spec expression
 * is just a JSON array whose first element is the operator; paint/layout values
 * are literals or expressions. Keeping our own structural types means the
 * package has zero runtime and zero map-library dependency.
 */

/** A Mapbox GL style-spec expression: `[operator, ...args]`, recursively. */
export type Expression = [string, ...ExpressionValue[]];

export type ExpressionValue =
  | string
  | number
  | boolean
  | null
  | Expression
  | ExpressionValue[];

/** A paint/layout property value: a literal, an array literal, or an expression. */
export type StyleValue = string | number | boolean | null | Expression | ExpressionValue[];

/** A bag of paint properties (e.g. `circle-color`, `line-gradient`). */
export type PaintSpec = Record<string, StyleValue>;

/** A bag of layout properties (e.g. `line-cap`, `icon-image`). */
export type LayoutSpec = Record<string, StyleValue>;

/**
 * A portable layer definition. Both mapbox-gl (`map.addLayer`) and rnmapbox
 * (`<*Layer style={...}>`) accept this shape; the only divergence is that
 * rnmapbox folds `paint` + `layout` into a single `style` prop, so a tiny
 * per-platform adapter flattens them. See README.
 */
export interface LayerSpec {
  id: string;
  type: 'circle' | 'symbol' | 'line' | 'heatmap';
  source?: string;
  'source-layer'?: string;
  paint?: PaintSpec;
  layout?: LayoutSpec;
}
