/**
 * The workflow's own name, taken from a sidebar link. Other extensions append text to the label
 * (for example a relative time in an <em>), which must not count as part of the name.
 */
const FOREIGN = "em, relative-time, tool-tip, [data-gha-ignore]";

export function nameOf(link: Element): string {
  if (!link.querySelector(FOREIGN)) return link.textContent.trim();
  const copy = link.cloneNode(true) as Element;
  for (const extra of copy.querySelectorAll(FOREIGN)) extra.remove();
  return copy.textContent.trim();
}
