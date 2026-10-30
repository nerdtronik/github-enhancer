/**
 * Builds and mounts the Custom themes section: radio cards per Mode, kept out of GitHub's own
 * appearance form.
 */
import { isBuiltin } from "./builtins";
import { previewDataUrl } from "./previewSvg";
import type { Theme, ThemeMode } from "./theme";
import { DETACHED_FORM, mountToolbar, type ToolbarActions } from "./toolbar";

export type ActiveIds = { light: string | null; dark: string | null };
interface CardActions {
  duplicate(id: string): void;
  edit(id: string): void;
  remove(id: string): void;
}
export interface SectionHandlers {
  select(mode: ThemeMode, id: string): void;
  clear(mode: ThemeMode): void;
  actions?: CardActions;
  toolbar?: ToolbarActions;
}

type ActionName = "duplicate" | "edit" | "delete";

interface SectionState {
  update(themes: readonly Theme[], active: ActiveIds, handlers: SectionHandlers): void;
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
// Margin percentages use the cell width, so 52.63% equals the preview height (aspect 190:100): the
// radio sits just under the preview, beside the card text.
const radioStyle = "position: absolute; z-index: 5; margin-top: calc(52.6315789474% + 4px); left: 18px;";
const states = new WeakMap<Element, SectionState>();
const rendered = new WeakMap<Element, string>();

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

function createActions(theme: Theme) {
  const bar = el("div", "d-flex flex-wrap flex-items-center mt-2 mr-2");
  bar.dataset.ghaThemeActions = "";
  bar.style.marginLeft = "30px";
  if (!isBuiltin(theme.id)) bar.append(actionButton("edit", "Edit"));
  bar.append(actionButton("duplicate", "Duplicate"));
  if (!isBuiltin(theme.id)) bar.append(actionButton("delete", "Delete"));
  return bar;
}

function createCell(mode: ThemeMode, key: string, value: string, preview: HTMLElement, title: string, text: string) {
  const cell = el("div", "position-relative tmp-mb-3 flex-shrink-0 col-6 col-lg-4");
  const radio = el("input", "position-absolute");
  radio.type = "radio";
  radio.name = `gha_theme_${mode}`;
  radio.id = `gha-theme-${key}-${mode}`;
  radio.value = value;
  radio.dataset.ghaMode = mode;
  // Detached from GitHub's appearance form so a form that may submit on change never sees our
  // radios. Selection is saved by our own handler.
  radio.setAttribute("form", DETACHED_FORM);
  radio.setAttribute("style", radioStyle);
  const label = el("label", "radio-label pl-0 pr-0 pt-0 pb-2 overflow-hidden color-theme-toggle-label width-full height-full");
  label.htmlFor = radio.id;
  const body = el("div", "d-flex flex-items-start mt-2 mr-2");
  body.style.marginLeft = "30px";
  const content = el("div", "");
  const name = el("div", "f5", title);
  const description = el("p", "text-small color-fg-muted mt-1 mb-0", text);
  content.append(name, description);
  body.append(content);
  label.append(preview, body);
  cell.append(radio, label);
  return cell;
}

function createDefaultCard(mode: ThemeMode) {
  const preview = el("div", "d-block border-bottom width-full");
  preview.setAttribute("style", "aspect-ratio: 190 / 100;");
  // The empty value stands for GitHub default; the handlers turn it into null (clear).
  const cell = createCell(mode, "default", "", preview, "GitHub default", "Use GitHub's own colors in this mode.");
  cell.dataset.ghaThemeDefault = "";
  return cell;
}

function createCard(theme: Theme, withActions: boolean) {
  const preview = el("div", "position-relative");
  const img = el("img", "d-block border-bottom width-full");
  img.alt = "";
  img.src = previewDataUrl(theme);
  preview.append(img);
  const description = theme.mode === "dark" ? "Dark theme" : "Light theme";
  // theme.name is untrusted: createCell writes it with textContent, never as markup. The preview is
  // a data: URL of hex colors.
  const cell = createCell(theme.mode, theme.id, theme.id, preview, theme.name, description);
  cell.dataset.ghaTheme = theme.id;
  cell.querySelector(".f5")!.append(el("span", "Label Label--accent ml-2", isBuiltin(theme.id) ? "Built-in" : "Custom"));
  if (withActions) cell.querySelector("label")!.append(createActions(theme));
  return cell;
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
  const grid = el("div", "d-flex gutter-condensed flex-wrap");
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", `Custom ${mode} themes`);
  sub.append(heading, description, grid);
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

function renderGrid(grid: Element, mode: ThemeMode, themes: readonly Theme[], withActions: boolean) {
  // Cells are reused by key (theme content plus whether actions show), so unchanged cards keep
  // their DOM and focus and the grid is rewritten only when the set or order changed.
  const old = new Map<string, Element>();
  for (const cell of grid.children) old.set(rendered.get(cell) ?? "", cell);
  const take = (key: string, create: () => HTMLElement) => {
    const cell = old.get(key) ?? create();
    rendered.set(cell, key);
    return cell;
  };
  const ofMode = themes.filter((theme) => theme.mode === mode);
  // Built-ins first, then custom themes, each in stored order.
  const ordered = [...ofMode.filter((t) => isBuiltin(t.id)), ...ofMode.filter((t) => !isBuiltin(t.id))];
  const cells = [
    take("default", () => createDefaultCard(mode)),
    ...ordered.map((theme) => take(JSON.stringify([theme, withActions]), () => createCard(theme, withActions))),
  ];
  const same = cells.length === grid.children.length && cells.every((cell, i) => grid.children[i] === cell);
  if (!same) grid.replaceChildren(...cells);
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
  section.addEventListener("click", onActionClick, true);
  section.addEventListener("click", onRadioEvent, true);
  section.addEventListener("change", onRadioEvent, true);

  return {
    update(themes, nextActive, nextHandlers) {
      handlers = nextHandlers;
      active = { ...nextActive };
      for (const mode of MODES) renderGrid(gridOf(section, mode), mode, themes, !!handlers.actions);
      mountToolbar(section.querySelector("[data-gha-themes-mode]")!, handlers.toolbar);
      sync();
    },
    dispose() {
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
  state.update(themes, active, handlers);
  return () => state.dispose();
}
