/**
 * Finds GitHub Enterprise's extra header row, hides it and shows its text as a tab. Unknown markup
 * is left alone.
 */
export interface EnterpriseRow {
  header: HTMLElement;
  row: HTMLElement;
  globe: SVGElement;
  text: string;
  link?: string;
}

type Part = { text: string; href?: string };
type Background = { kind: "inherit" } | { kind: "copy"; value: string } | { kind: "fallback" };

export const ROW_ATTR = "data-gha-enterprise-row";
export const HOST_ATTR = "data-gha-enterprise-host";
export const TAB_ATTR = "data-gha-enterprise-tab";
export const TAB_SELECTOR = `[${TAB_ATTR}]`;
const INLINE_ATTR = "data-gha-enterprise-inline";
const MAX_HEADERS = 5;

const LABELLED_HEADER = 'header[aria-label="Global navigation menu"]';
const GLOBE = "svg.octicon-globe";
// Interactive or navigational content: a row containing any of it must not be hidden, or the user
// loses that control.
export const UNSAFE = [
  "input, textarea, select, nav, button, img, details, summary, dialog, form, svg.octicon-mark-github",
  "[role], [tabindex], [aria-haspopup], [aria-expanded], [popover], [contenteditable]",
].join(", ");
// Marks the main header bar (logo, navigation, search); a banner row sits before it.
const MAIN_MARKERS = 'svg.octicon-mark-github, nav, [role="search"], input';
// Headers inside page content (for example in a repository's main area) are never candidates.
const CONTENT = 'main, [role="main"], article, section';
const SVG_NS = "http://www.w3.org/2000/svg";
// cloneGlobe copies only these attributes and shapes, never the node itself, so no script,
// handler or foreign markup reaches the tab.
const SVG_ATTRS = [
  "class", "viewBox", "width", "height", "fill", "aria-hidden", "focusable", "data-component", "display", "overflow", "style",
];
const SHAPES = new Set(["path", "circle", "g"]);
const SHAPE_ATTRS = ["d", "fill", "fill-rule", "clip-rule", "cx", "cy", "r", "transform"];
// Only an rgb()/rgba() string, the form getComputedStyle returns, is allowed into the CSS variable.
const COMPUTED_COLOR =
  /^rgba?\(\s*\d{1,3}(\.\d+)?(\s*,\s*|\s+)\d{1,3}(\.\d+)?(\s*,\s*|\s+)\d{1,3}(\.\d+)?(\s*(,|\/)\s*(0|1|0?\.\d+|\d{1,3}%))?\s*\)$/;
const BG_VAR = "--gha-enterprise-bg";
const FALLBACK_CLASS = "gha-enterprise-tab--fallback-bg";
// Bound the background search so the cost stays small on a large header.
const BG_SCAN_DEPTH = 3;
const BG_SCAN_LIMIT = 20;
const MAX_TEXT = 120;
const MAX_SEGMENT = 40;

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const truncate = (text: string) => (text.length > MAX_SEGMENT ? `${text.slice(0, MAX_SEGMENT)}…` : text);
const isElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;

function collectParts(element: Element, parts: Part[] = []): Part[] {
  if (element.matches("a[href]")) {
    parts.push({ text: element.textContent ?? "", href: element.getAttribute("href") ?? "" });
    return parts;
  }
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) parts.push({ text: child.textContent ?? "" });
    if (isElement(child)) collectParts(child, parts);
  }
  return parts;
}

const partsText = (parts: Part[]) => normalize(parts.map((part) => part.text).join(" "));

// Safe to hide: no interactive content, at most one link (the tab can reproduce it) and 1 to
// MAX_TEXT characters of text.
function isSafe(element: Element): boolean {
  if (element.matches(UNSAFE) || element.querySelector(UNSAFE)) return false;
  if (element.querySelectorAll("a[href]").length > 1) return false;
  const length = partsText(collectParts(element)).length;
  return length >= 1 && length <= MAX_TEXT;
}

// Skips our own tab, which holds a copy of the globe, and anything in the main content.
const globesIn = (root: ParentNode) =>
  [...root.querySelectorAll<SVGElement>(GLOBE)].filter(
    (globe) => !globe.closest(TAB_SELECTOR) && !globe.closest('main, [role="main"]'),
  );

// Only globes whose nearest header is this one, so nested headers do not claim an outer globe.
const ownGlobes = (header: HTMLElement) => globesIn(header).filter((globe) => globe.closest("header") === header);

// The labelled global header is tried first; the cap bounds the work on pages with many headers.
function candidateHeaders(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>("header")]
    .filter((header) => header.closest(CONTENT) === null && ownGlobes(header).length)
    .sort((a, b) => Number(b.matches(LABELLED_HEADER)) - Number(a.matches(LABELLED_HEADER)))
    .slice(0, MAX_HEADERS);
}

// Climbs from the globe while each ancestor is still safe and keeps the highest. It stops at the
// first unsafe one (we rely on the logo, navigation or search sitting above the banner row) and
// never takes the header itself.
function highestSafeAncestor(globe: SVGElement, header: HTMLElement): HTMLElement | undefined {
  let row: HTMLElement | undefined;
  for (let node = globe.parentElement; node && node !== header; node = node.parentElement) {
    if (!isSafe(node)) break;
    row = node;
  }
  return row;
}

function hasMarkersAfter(row: HTMLElement): boolean {
  for (let sibling = row.nextElementSibling; sibling; sibling = sibling.nextElementSibling)
    if (sibling.matches(MAIN_MARKERS) || sibling.querySelector(MAIN_MARKERS)) return true;
  return false;
}

// A div that is a direct child of the header, or the first child of its parent with the main bar
// after it. This hides a whole banner row, not a fragment inside the main bar.
function isWholeRow(row: HTMLElement, header: HTMLElement): boolean {
  const parent = row.parentElement;
  if (row.localName !== "div" || !parent) return false;
  if (parent === header) return true;
  return parent.firstElementChild === row && hasMarkersAfter(row);
}

// If the row is all the header holds, hiding it would blank the header.
const hasOutsideContent = (header: HTMLElement, row: HTMLElement) =>
  [...header.querySelectorAll("*")].some(
    (element) => !row.contains(element) && !element.contains(row) && !element.closest(TAB_SELECTOR),
  );

function rowIn(header: HTMLElement): EnterpriseRow | string {
  const results = ownGlobes(header).map((globe) => rowFor(header, globe));
  // The first globe that yields a row wins; otherwise report why the first one failed.
  return results.find((result) => typeof result !== "string") ?? results[0] ?? "no globe";
}

function rowFor(header: HTMLElement, globe: SVGElement): EnterpriseRow | string {
  const row = highestSafeAncestor(globe, header);
  if (!row) return "no ancestor of the globe passes the safety checks";
  if (!isWholeRow(row, header)) return "the safe ancestor is not a separate header row";
  if (!hasOutsideContent(header, row)) return "the row is the only header content";
  const link = row.querySelector("a[href]")?.getAttribute("href") ?? undefined;
  return { header, row, globe, text: partsText(collectParts(row)), link };
}

// Each reason is logged once, because syncing re-runs on every relevant mutation.
const reported = new Set<string>();

export function resetDiagnostics(): void {
  reported.clear();
}

function report(reasons: string[], headers: HTMLElement[], rows: EnterpriseRow[]): void {
  for (const reason of reasons) {
    if (reported.has(reason)) continue;
    reported.add(reason);
    console.debug("Enterprise header:", reason, { headers, rows: rows.map(({ row }) => row) });
  }
}

export function findEnterpriseRows(doc: Document): EnterpriseRow[] {
  const headers = candidateHeaders(doc);
  const results = headers.map(rowIn);
  const rows = results.filter((result): result is EnterpriseRow => typeof result !== "string");
  report(
    results.filter((result): result is string => typeof result === "string"),
    headers,
    rows,
  );
  return rows;
}

export const findEnterpriseRow = (doc: Document): EnterpriseRow | undefined => findEnterpriseRows(doc)[0];

// Only same-origin https links are kept as links; anything else is shown as plain text.
function safeUrl(href: string, base: Location): string | undefined {
  try {
    const url = new URL(href, base.href);
    return url.protocol === "https:" && url.origin === base.origin ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// Built from text nodes and textContent only, so page text never becomes markup in the tab.
function renderSegment(doc: Document, parts: Part[]): Node[] {
  const pieces: Node[] = [];
  let pending = "";
  const flush = () => {
    const text = normalize(pending);
    pending = "";
    if (text) pieces.push(doc.createTextNode(truncate(text)));
  };
  for (const part of parts) {
    const href = part.href === undefined ? undefined : safeUrl(part.href, doc.location);
    if (!href) {
      pending += ` ${part.text}`;
      continue;
    }
    flush();
    const anchor = doc.createElement("a");
    anchor.className = "gha-enterprise-link";
    anchor.href = href;
    anchor.textContent = truncate(normalize(part.text));
    pieces.push(anchor);
  }
  flush();
  return pieces.flatMap((piece, index) => (index ? [doc.createTextNode(" "), piece] : [piece]));
}

// Two non-empty children are shown as two segments joined by a dot; any other shape is flattened
// into one.
function segments(row: HTMLElement): Part[][] {
  const groups = [...row.children].filter((child) => normalize(child.textContent ?? ""));
  if (groups.length === 2) return groups.map((group) => collectParts(group));
  return [collectParts(row)];
}

function copyAttributes(source: Element, target: Element, names: string[]): void {
  for (const name of names) {
    const value = source.getAttribute(name);
    if (value !== null) target.setAttribute(name, value);
  }
}

function cloneShapes(doc: Document, source: Element, target: Element): void {
  for (const child of source.children) {
    if (!SHAPES.has(child.localName)) continue;
    const shape = doc.createElementNS(SVG_NS, child.localName);
    copyAttributes(child, shape, SHAPE_ATTRS);
    cloneShapes(doc, child, shape);
    target.append(shape);
  }
}

function cloneGlobe(doc: Document, globe: SVGElement): SVGElement {
  const icon = doc.createElementNS(SVG_NS, "svg");
  copyAttributes(globe, icon, SVG_ATTRS);
  icon.setAttribute("aria-hidden", "true");
  cloneShapes(doc, globe, icon);
  return icon;
}

export const isComputedColor = (value: string) => COMPUTED_COLOR.test(value);

function isTransparent(value: string): boolean {
  if (!value || value === "transparent") return true;
  if (!isComputedColor(value)) return false;
  const channels = value.slice(value.indexOf("(") + 1, -1).split(/[\s,/]+/).filter(Boolean);
  return channels.length === 4 && parseFloat(channels[3]) === 0;
}

function paintedDescendant(view: Window, header: HTMLElement, row: HTMLElement): string | undefined {
  let level = [...header.children];
  let visited = 0;
  for (let depth = 1; depth <= BG_SCAN_DEPTH && level.length; depth++) {
    const next: Element[] = [];
    for (const element of level) {
      if (element === row || element.matches(TAB_SELECTOR)) continue;
      if (++visited > BG_SCAN_LIMIT) return undefined;
      const style = view.getComputedStyle(element);
      if (style.display === "none") continue;
      const value = style.backgroundColor;
      if (isComputedColor(value) && !isTransparent(value)) return value;
      next.push(...element.children);
    }
    level = next;
  }
  return undefined;
}

// A painted header is inherited through CSS; a transparent one gets the color of its first painted
// descendant; with none, a fallback class uses the page background.
function tabBackground(doc: Document, header: HTMLElement, row: HTMLElement): Background {
  const view = doc.defaultView;
  if (!view) return { kind: "fallback" };
  if (!isTransparent(view.getComputedStyle(header).backgroundColor)) return { kind: "inherit" };
  const value = paintedDescendant(view, header, row);
  return value ? { kind: "copy", value } : { kind: "fallback" };
}

// Writes only what changed to avoid needless DOM writes.
function setBackground(tab: HTMLElement, background: Background): void {
  const value = background.kind === "copy" ? background.value : "";
  if (tab.style.getPropertyValue(BG_VAR) !== value) {
    if (value) tab.style.setProperty(BG_VAR, value);
    else tab.style.removeProperty(BG_VAR);
  }
  // removeProperty can leave an empty style attribute; drop it so isEqualNode against a fresh tab
  // can hold.
  if (tab.hasAttribute("style") && !tab.getAttribute("style")) tab.removeAttribute("style");
  const fallback = background.kind === "fallback";
  if (tab.classList.contains(FALLBACK_CLASS) !== fallback) tab.classList.toggle(FALLBACK_CLASS, fallback);
}

function buildTab(doc: Document, { header, row, globe, text }: EnterpriseRow): HTMLElement {
  const tab = doc.createElement("span");
  tab.setAttribute(TAB_ATTR, "");
  tab.className = "gha-enterprise-tab";
  setBackground(tab, tabBackground(doc, header, row));
  tab.setAttribute("title", text);
  const icon = cloneGlobe(doc, globe);
  const label = doc.createElement("span");
  label.className = "gha-enterprise-text";
  segments(row).forEach((parts, index) => {
    if (index) label.append(doc.createTextNode(" · "));
    label.append(...renderSegment(doc, parts));
  });
  tab.append(icon, label);
  return tab;
}

function unhide(element: HTMLElement): void {
  element.removeAttribute(ROW_ATTR);
  if (!element.hasAttribute(INLINE_ATTR)) return;
  element.removeAttribute(INLINE_ATTR);
  element.style.removeProperty("display");
}

function clear(doc: Document, keep: EnterpriseRow[]): void {
  // Undo everything we did to rows, hosts and tabs that no longer match.
  const rows = new Set<Element>(keep.map(({ row }) => row));
  const headers = new Set<Element>(keep.map(({ header }) => header));
  for (const element of doc.querySelectorAll<HTMLElement>(`[${ROW_ATTR}], [${INLINE_ATTR}]`))
    if (!rows.has(element)) unhide(element);
  for (const element of doc.querySelectorAll(`[${HOST_ATTR}]`))
    if (!headers.has(element)) element.removeAttribute(HOST_ATTR);
  for (const tab of doc.querySelectorAll(TAB_SELECTOR)) if (!headers.has(tab.parentElement!)) tab.remove();
}

// The stylesheet rule hides the row. GitHub may style the row with an !important utility such as
// Primer's .d-flex, so if it still displays we also set an inline display:none !important, which
// beats any non-inline declaration. INLINE_ATTR records that so unhide can undo it.
function hide(doc: Document, row: HTMLElement): void {
  if (!row.hasAttribute(ROW_ATTR)) row.setAttribute(ROW_ATTR, "");
  if (row.hasAttribute(INLINE_ATTR)) return;
  if (doc.defaultView?.getComputedStyle(row).display === "none") return;
  row.setAttribute(INLINE_ATTR, "");
  row.style.setProperty("display", "none", "important");
}

// The tab is positioned against the header; a header that already has its own positioning is left
// as GitHub set it.
function isStatic(doc: Document, header: HTMLElement): boolean {
  const position = doc.defaultView?.getComputedStyle(header).position;
  return !position || position === "static";
}

function copyAttribute(source: Element, target: Element, name: string): void {
  const value = source.getAttribute(name);
  if (value === null) target.removeAttribute(name);
  else if (target.getAttribute(name) !== value) target.setAttribute(name, value);
}

function place(doc: Document, found: EnterpriseRow): void {
  const { header, row } = found;
  hide(doc, row);
  if (!header.hasAttribute(HOST_ATTR) && isStatic(doc, header)) header.setAttribute(HOST_ATTR, "");
  const fresh = buildTab(doc, found);
  // Update the existing tab in place and drop duplicates, so repeated syncs do not rebuild the DOM.
  const [existing, ...extra] = [...header.querySelectorAll<HTMLElement>(`:scope > ${TAB_SELECTOR}`)];
  for (const tab of extra) tab.remove();
  if (!existing) return void header.append(fresh);
  if (!existing.isEqualNode(fresh)) {
    for (const name of ["title", "class", "style"]) copyAttribute(fresh, existing, name);
    existing.replaceChildren(...fresh.childNodes);
  }
  if (header.lastElementChild !== existing) header.append(existing);
}

/**
 * Idempotent and safe on every relevant mutation: restores headers that no longer match and places
 * a tab for those that do.
 */
export function syncEnterpriseTab(doc: Document): void {
  const rows = findEnterpriseRows(doc);
  clear(doc, rows);
  for (const found of rows) place(doc, found);
}

function markedRow(tab: HTMLElement): { header: HTMLElement; row: HTMLElement } | undefined {
  const header = tab.parentElement;
  if (header?.localName !== "header") return undefined;
  const row = header.querySelector<HTMLElement>(`[${ROW_ATTR}]`);
  return row ? { header, row } : undefined;
}

/**
 * Cheap path for theme changes: recolor existing tabs; falls back to a full sync if a tab lost its
 * hidden row.
 */
export function refreshEnterpriseBackground(doc: Document): void {
  const tabs = [...doc.querySelectorAll<HTMLElement>(TAB_SELECTOR)];
  const marked = tabs.map(markedRow);
  if (marked.some((entry) => !entry)) return syncEnterpriseTab(doc);
  tabs.forEach((tab, index) => {
    const { header, row } = marked[index]!;
    setBackground(tab, tabBackground(doc, header, row));
  });
}

// Attribute changes are limited to our marker; see isRelevantRecord for which of those count.
export const OBSERVE_INIT: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: [ROW_ATTR],
};

const WATCHED = "header, .octicon-globe";

// Mutations inside our own tab are ignored so our updates do not trigger another sync.
const isOurs = (node: Node) => isElement(node) && node.closest(TAB_SELECTOR) !== null;

const touchesHeader = (node: Node) =>
  isElement(node) && !isOurs(node) && (node.matches(WATCHED) || node.querySelector(WATCHED) !== null);

function isRelevantRecord(record: MutationRecord): boolean {
  const { target } = record;
  // Adding our marker is ignored; its removal means the row must be hidden again.
  if (record.type === "attributes") return isElement(target) && !target.hasAttribute(ROW_ATTR);
  if (isElement(target) && !isOurs(target) && target.closest("header")) return true;
  return [...record.addedNodes, ...record.removedNodes].some(touchesHeader);
}

export const isRelevantMutation = (records: MutationRecord[]) => records.some(isRelevantRecord);
