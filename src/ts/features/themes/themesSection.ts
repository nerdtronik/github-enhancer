/**
 * Builds and mounts the Custom themes section: a searchable list of themes per Mode (a chip with
 * the theme's main colors, its name and actions), kept out of GitHub's own appearance form.
 */
import { isBuiltin } from "./builtins";
import { swatches, type CatalogEntry } from "./catalog";
import type { Theme, ThemeMode } from "./theme";
import { DETACHED_FORM, mountToolbar, type ToolbarActions } from "./toolbar";

export type ActiveIds = { light: string | null; dark: string | null };
interface RowActions {
  duplicate(id: string): void;
  edit(id: string): void;
  remove(id: string): void;
}
export interface SectionHandlers {
  select(mode: ThemeMode, id: string): void;
  clear(mode: ThemeMode): void;
  actions?: RowActions;
  toolbar?: ToolbarActions;
}

type ActionName = "duplicate" | "edit" | "delete";

interface SectionState {
  update(themes: readonly Theme[], active: ActiveIds, handlers: SectionHandlers, catalog: readonly CatalogEntry[]): void;
  dispose(): void;
}

export const SECTION = "[data-gha-themes-section]";
export const GITHUB_RADIO = 'input[type="radio"][data-mode]';
const MODES: readonly ThemeMode[] = ["dark", "light"];
const INTRO = "Pick a theme for each mode. A theme only applies while GitHub itself is in the same mode.";
const COPY = {
  dark: { title: "Dark themes", example: "Dark default" },
  light: { title: "Light themes", example: "Light default" },
};
const states = new WeakMap<Element, SectionState>();
const rendered = new WeakMap<Element, string>();

type Kind = "builtin" | "custom";
interface Row {
  id: string;
  name: string;
  mode: ThemeMode;
  colors: string[];
  kind: Kind;
}
const KIND_LABEL: Record<Kind, string> = { builtin: "Built-in", custom: "Custom" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function actionButton(action: ActionName, text: string) {
  const button = el("button", "btn btn-sm", text);
  button.type = "button";
  // Detached from GitHub's form: its submit and autosave handling must not see our buttons.
  button.setAttribute("form", DETACHED_FORM);
  button.dataset.ghaAction = action;
  return button;
}

function createActions(row: Row) {
  const bar = el("div", "d-flex flex-items-center flex-shrink-0");
  bar.dataset.ghaThemeActions = "";
  if (row.kind === "custom") bar.append(actionButton("edit", "Edit"));
  bar.append(actionButton("duplicate", "Duplicate"));
  if (row.kind === "custom") bar.append(actionButton("delete", "Delete"));
  return bar;
}

// The chip is the theme's background with its main colors as circles. Colors come from validated
// palettes (hex only) and are set through the style object, never as markup.
function createChip(colors: string[]) {
  const chip = el("span", "gha-theme-chip");
  chip.setAttribute("aria-hidden", "true");
  if (!colors.length) {
    chip.classList.add("gha-theme-chip-empty");
    return chip;
  }
  chip.style.backgroundColor = colors[0];
  for (const color of colors.slice(1)) {
    const dot = el("span", "gha-theme-dot");
    dot.style.backgroundColor = color;
    chip.append(dot);
  }
  return chip;
}

function createRow(mode: ThemeMode, key: string, value: string, chip: HTMLElement, title: string) {
  const row = el("div", "gha-theme-row");
  const radio = el("input", "gha-theme-radio");
  radio.type = "radio";
  radio.name = `gha_theme_${mode}`;
  radio.id = `gha-theme-${key}-${mode}`;
  radio.value = value;
  radio.dataset.ghaMode = mode;
  // Detached from GitHub's appearance form so a form that may submit on change never sees our
  // radios. Selection is saved by our own handler.
  radio.setAttribute("form", DETACHED_FORM);
  const label = el("label", "gha-theme-label");
  label.htmlFor = radio.id;
  // The title may come from an imported file: textContent only, never markup.
  label.append(chip, el("span", "gha-theme-name", title));
  row.dataset.ghaName = title.toLowerCase();
  row.append(radio, label);
  return row;
}

function createDefaultRow(mode: ThemeMode) {
  // The empty value stands for GitHub default; the handlers turn it into null (clear).
  const row = createRow(mode, "default", "", createChip([]), "GitHub default");
  row.dataset.ghaThemeDefault = "";
  row.querySelector("label")!.append(el("span", "text-small color-fg-muted ml-2", "Use GitHub's own colors in this mode."));
  return row;
}

function createThemeRow(item: Row, withActions: boolean) {
  const row = createRow(item.mode, item.id, item.id, createChip(item.colors), item.name);
  row.dataset.ghaTheme = item.id;
  row.dataset.ghaKind = item.kind;
  // The badge sits next to the actions, away from the name, so long names stay readable.
  row.append(el("span", "Label Label--accent flex-shrink-0 mr-2", KIND_LABEL[item.kind]));
  if (withActions) row.append(createActions(item));
  return row;
}

function createSubsection(mode: ThemeMode) {
  const { title, example } = COPY[mode];
  const sub = el("div", "mt-4");
  sub.dataset.ghaThemesMode = mode;
  const heading = el("h3", "f4 text-bold mb-1", title);
  const description = el(
    "p",
    "color-fg-muted text-small mb-3",
    `Applies when GitHub is in a ${mode} mode. To use one of these, first select one of GitHub's ${mode} themes above (for example "${example}"), then choose a theme here. With "Sync with system", this theme is used for ${mode} mode.`,
  );
  const search = el("input", "form-control input-sm gha-theme-search");
  search.type = "search";
  search.placeholder = "Search themes";
  search.setAttribute("aria-label", `Search ${mode} themes`);
  search.setAttribute("autocomplete", "off");
  search.setAttribute("form", DETACHED_FORM);
  const grid = el("div", "gha-theme-list");
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", `Custom ${mode} themes`);
  const empty = el("p", "color-fg-muted text-small mt-2 mb-0", "No themes match your search.");
  empty.hidden = true;
  sub.append(heading, description, search, grid, empty);
  return sub;
}

function createSection() {
  const section = el("div", "mt-5");
  section.dataset.ghaThemesSection = "";
  const subhead = el("div", "Subhead");
  subhead.append(el("h2", "Subhead-heading", "Custom themes"));
  section.append(subhead, el("p", "color-fg-muted", INTRO), ...MODES.map(createSubsection));
  return section;
}

const gridOf = (section: Element, mode: ThemeMode) =>
  section.querySelector(`[data-gha-themes-mode="${mode}"] [role="radiogroup"]`)!;

const rowsOf = (themes: readonly Theme[], catalog: readonly CatalogEntry[], mode: ThemeMode): Row[] => {
  const ofMode = themes.filter((theme) => theme.mode === mode);
  // Built-ins first (the hand-tuned ones, then the shipped theme files), then custom themes in
  // stored order; a shipped theme that is already listed is not repeated.
  const ordered = [...ofMode.filter((t) => isBuiltin(t.id)), ...ofMode.filter((t) => !isBuiltin(t.id))];
  const seen = new Set(ordered.map((theme) => theme.id));
  const builtin = ordered.filter((theme) => isBuiltin(theme.id)).map((theme): Row => ({ id: theme.id, name: theme.name, mode, colors: swatches(theme), kind: "builtin" }));
  const shipped = catalog.filter((entry) => entry.mode === mode && !seen.has(entry.id)).map((entry): Row => ({ ...entry, kind: "builtin" }));
  const own = ordered.filter((theme) => !isBuiltin(theme.id)).map((theme): Row => ({ id: theme.id, name: theme.name, mode, colors: swatches(theme), kind: "custom" }));
  return [...builtin, ...shipped, ...own];
};

function renderGrid(grid: Element, mode: ThemeMode, rows: Row[], withActions: boolean) {
  // Rows are reused by key (content plus whether actions show), so unchanged rows keep their DOM
  // and focus and the list is rewritten only when the set or order changed.
  const old = new Map<string, Element>();
  for (const cell of grid.children) old.set(rendered.get(cell) ?? "", cell);
  const take = (key: string, create: () => HTMLElement) => {
    const cell = old.get(key) ?? create();
    rendered.set(cell, key);
    return cell;
  };
  const cells = [
    take("default", () => createDefaultRow(mode)),
    ...rows.map((row) => take(JSON.stringify([row, withActions]), () => createThemeRow(row, withActions))),
  ];
  const same = cells.length === grid.children.length && cells.every((cell, i) => grid.children[i] === cell);
  if (!same) grid.replaceChildren(...cells);
}

// Hides rows that do not contain the search text; GitHub default always stays visible.
function applySearch(sub: Element) {
  const query = sub.querySelector<HTMLInputElement>(".gha-theme-search")!.value.trim().toLowerCase();
  let shown = 0;
  for (const row of sub.querySelectorAll<HTMLElement>(".gha-theme-list > .gha-theme-row")) {
    const match = row.hasAttribute("data-gha-theme-default") || !query || (row.dataset.ghaName ?? "").includes(query);
    row.hidden = !match;
    if (match && !row.hasAttribute("data-gha-theme-default")) shown++;
  }
  sub.querySelector<HTMLElement>("p.mb-0")!.hidden = !query || shown > 0;
}

function mountSection(section: HTMLElement): SectionState {
  let handlers: SectionHandlers;
  let active: ActiveIds = { light: null, dark: null };

  const sync = () => {
    for (const mode of MODES) {
      const cells = [...gridOf(section, mode).children];
      const radios = cells.map((cell) => cell.querySelector("input")!);
      // The radios are detached from GitHub's form, so checked state is driven from our Active ids.
      // An id with no card falls back to GitHub default.
      const wanted = radios.some((radio) => radio.value === active[mode]) ? active[mode] : "";
      cells.forEach((cell, i) => {
        radios[i].checked = radios[i].value === wanted;
        cell.toggleAttribute("data-gha-active", radios[i].checked);
      });
    }
  };

  // Click and change stop here so GitHub's own listeners do not react to our radios; only change
  // updates the Active theme.
  const onRadioEvent = (event: Event) => {
    const radio = event.target;
    if (!(radio instanceof HTMLInputElement) || radio.type !== "radio") return;
    event.stopPropagation();
    if (event.type !== "change") return;
    const mode = radio.dataset.ghaMode as ThemeMode;
    active = { ...active, [mode]: radio.value || null };
    sync();
    if (radio.value) handlers.select(mode, radio.value);
    else handlers.clear(mode);
  };

  const onActionClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>("[data-gha-action]");
    const card = button?.closest<HTMLElement>("[data-gha-theme]");
    if (!button || !card) return;
    event.stopPropagation();
    event.preventDefault();
    const id = card.dataset.ghaTheme!;
    const action = button.dataset.ghaAction as ActionName;
    if (action === "delete") handlers.actions?.remove(id);
    else handlers.actions?.[action](id);
  };

  // Capture phase, so these run before the radios' own listeners and before bubbling handlers
  // GitHub attaches to ancestors of the section.
  const onSearch = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.classList.contains("gha-theme-search")) return;
    event.stopPropagation();
    applySearch(input.closest("[data-gha-themes-mode]")!);
  };
  section.addEventListener("input", onSearch, true);
  section.addEventListener("click", onActionClick, true);
  section.addEventListener("click", onRadioEvent, true);
  section.addEventListener("change", onRadioEvent, true);

  return {
    update(themes, nextActive, nextHandlers, catalog) {
      handlers = nextHandlers;
      active = { ...nextActive };
      for (const mode of MODES) {
        renderGrid(gridOf(section, mode), mode, rowsOf(themes, catalog, mode), !!handlers.actions);
        applySearch(section.querySelector(`[data-gha-themes-mode="${mode}"]`)!);
      }
      mountToolbar(section.querySelector("[data-gha-themes-mode]")!, handlers.toolbar);
      sync();
    },
    dispose() {
      section.removeEventListener("input", onSearch, true);
      section.removeEventListener("click", onActionClick, true);
      section.removeEventListener("click", onRadioEvent, true);
      section.removeEventListener("change", onRadioEvent, true);
      section.remove();
      states.delete(section);
    },
  };
}

function removeSection(section: Element) {
  const state = states.get(section);
  if (state) state.dispose();
  else section.remove();
}

function findAnchor(root: ParentNode): Element | null {
  // Our radios use data-gha-mode and do not match GITHUB_RADIO; the filter guards against that
  // changing.
  const radios = [...root.querySelectorAll(GITHUB_RADIO)].filter((radio) => !radio.closest(SECTION));
  if (!radios.length) return null;
  // Prefer the whole form so the section is placed after it, outside it.
  const custom = radios[0].closest("appearance-form") ?? radios[0].closest("form");
  if (custom) return custom;
  const last = radios[radios.length - 1];
  return (last.closest('[role="radiogroup"]') ?? last).parentElement;
}

/**
 * Idempotent: reuses the existing section, removes duplicates, and removes it when GitHub's radios
 * are gone. Returns a disposer.
 */
export function mountThemesSection(
  root: ParentNode,
  themes: readonly Theme[],
  active: ActiveIds,
  handlers: SectionHandlers,
  catalog: readonly CatalogEntry[] = [],
): () => void {
  const [existing, ...extra] = [...document.querySelectorAll<HTMLElement>(SECTION)];
  extra.forEach(removeSection);
  const anchor = findAnchor(root);
  if (!anchor) {
    if (existing) removeSection(existing);
    return () => {};
  }
  let section = existing && states.has(existing) ? existing : undefined;
  // A section without state has no listeners attached, so replace it.
  if (existing && !section) existing.remove();
  section ??= createSection();
  const state = states.get(section) ?? mountSection(section);
  states.set(section, state);
  if (anchor.nextElementSibling !== section) anchor.after(section);
  state.update(themes, active, handlers, catalog);
  return () => state.dispose();
}
