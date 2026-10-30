/**
 * Hex color parsing, mixing and WCAG contrast. parseColor is the only way a color string enters a
 * palette.
 */
export type Rgba = { r: number; g: number; b: number; a: number };

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Accepts only #rgb, #rrggbb and #rrggbbaa; returns null for anything else. Hex-only is what keeps
 * colors safe to place in generated CSS and SVG.
 */
export function parseColor(value: string): Rgba | null {
  const match = HEX.exec(value);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  const byte = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return {
    r: byte(0),
    g: byte(2),
    b: byte(4),
    a: hex.length === 8 ? byte(6) / 255 : 1,
  };
}

const hexByte = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

export function formatColor(color: Rgba): string {
  const base = `#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}`;
  return color.a < 1 ? base + hexByte(color.a * 255) : base;
}

function mustParse(value: string): Rgba {
  const color = parseColor(value);
  if (!color) throw new Error(`Invalid color: ${value}`);
  return color;
}

/** `amount` is the weight of `top` (0..1). The result is opaque. Throws on an invalid color. */
export function mix(top: string, base: string, amount: number): string {
  const t = mustParse(top);
  const b = mustParse(base);
  const blend = (x: number, y: number) => x * amount + y * (1 - amount);
  return formatColor({
    r: blend(t.r, b.r),
    g: blend(t.g, b.g),
    b: blend(t.b, b.b),
    a: 1,
  });
}

/** Replaces the alpha of `color` (0..1). Throws on an invalid color. */
export function withAlpha(color: string, alpha: number): string {
  return formatColor({ ...mustParse(color), a: alpha });
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1..21) between two colors, ignoring alpha. Throws on an invalid color. */
export function contrast(a: string, b: string): number {
  const la = luminance(mustParse(a));
  const lb = luminance(mustParse(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
