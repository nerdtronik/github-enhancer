/** Card and editor preview as a data: URL image drawn from the resolved palette. */
import { resolvePalette, type Theme } from "./theme";

export function previewDataUrl(theme: Theme): string {
  // Callers pass validated themes (hex colors only), so palette values cannot inject markup
  // into the SVG.
  const p = resolvePalette(theme.palette, theme.mode);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 190 100" width="190" height="100">` +
    `<rect width="190" height="100" fill="${p.bg}"/>` +
    `<rect width="190" height="14" fill="${p.bgAlt}"/>` +
    `<rect y="14" width="190" height="1" fill="${p.border}"/>` +
    `<circle cx="9" cy="7" r="3" fill="${p.accent}"/>` +
    `<rect x="18" y="5" width="40" height="4" rx="2" fill="${p.fg}"/>` +
    `<rect y="15" width="44" height="85" fill="${p.bgAlt}"/>` +
    `<rect x="44" y="15" width="1" height="85" fill="${p.border}"/>` +
    `<rect x="6" y="22" width="30" height="4" rx="2" fill="${p.fgMuted}"/>` +
    `<rect x="6" y="30" width="24" height="4" rx="2" fill="${p.purple}"/>` +
    `<rect x="6" y="38" width="27" height="4" rx="2" fill="${p.fgMuted}"/>` +
    `<rect x="54" y="22" width="80" height="5" rx="2" fill="${p.fg}"/>` +
    `<rect x="54" y="31" width="120" height="4" rx="2" fill="${p.fgMuted}"/>` +
    `<rect x="54" y="38" width="100" height="4" rx="2" fill="${p.fgMuted}"/>` +
    `<rect x="54" y="47" width="34" height="10" rx="3" fill="${p.green}"/>` +
    `<rect x="94" y="47" width="24" height="10" rx="3" fill="${p.red}"/>` +
    `<rect x="54" y="62" width="124" height="32" rx="3" fill="${p.bgInset}" stroke="${p.border}"/>` +
    `<rect x="60" y="68" width="32" height="4" rx="2" fill="${p.purple}"/>` +
    `<rect x="96" y="68" width="40" height="4" rx="2" fill="${p.yellow}"/>` +
    `<rect x="60" y="76" width="56" height="4" rx="2" fill="${p.accent}"/>` +
    `<rect x="60" y="84" width="44" height="4" rx="2" fill="${p.orange}"/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
