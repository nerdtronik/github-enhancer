/**
 * Calls back when page colors may have changed (theme attributes, the gha-themes style, the OS
 * scheme).
 */
const THEME_ATTRIBUTES = ["data-color-mode", "data-light-theme", "data-dark-theme"];
// Must match the id the themes injector gives its style element.
const STYLE_ID = "gha-themes";

const isThemeStyle = (node: Node) => node.nodeType === Node.ELEMENT_NODE && (node as Element).id === STYLE_ID;

const movesThemeStyle = (record: MutationRecord) =>
  record.type === "childList" && [...record.addedNodes, ...record.removedNodes].some(isThemeStyle);

/** Returns a function that stops all watching. */
export function watchThemeChanges(doc: Document, onChange: () => void): () => void {
  const root = doc.documentElement;
  let style: HTMLElement | null = null;
  const styleObserver = new MutationObserver(() => onChange());

  // The injector rewrites the style's content on theme change without touching the root attributes,
  // so the style itself is observed.
  const attachStyle = () => {
    const current = doc.getElementById(STYLE_ID);
    if (current === style) return;
    styleObserver.disconnect();
    style = current;
    if (style) styleObserver.observe(style, { childList: true, characterData: true, subtree: true });
  };

  const rootObserver = new MutationObserver((records) => {
    const moved = records.some(movesThemeStyle);
    if (moved) attachStyle();
    if (moved || records.some((record) => record.type === "attributes")) onChange();
  });
  rootObserver.observe(root, { childList: true, attributes: true, attributeFilter: THEME_ATTRIBUTES });
  attachStyle();

  // In auto mode an OS scheme change recolors the page without any DOM mutation.
  const media = doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)");
  const listener = () => onChange();
  media?.addEventListener("change", listener);

  return () => {
    rootObserver.disconnect();
    styleObserver.disconnect();
    media?.removeEventListener("change", listener);
    style = null;
  };
}
