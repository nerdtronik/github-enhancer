/** Modal editor for one custom theme: color pickers, live preview and contrast warnings. */
import { BUILTIN_THEMES } from "./builtins";
import { contrast, formatColor, parseColor } from "./color";
import { previewDataUrl } from "./previewSvg";
import {
  createThemeId,
  MAX_NAME,
  resolvePalette,
  ROLES,
  validateTheme,
  type Palette,
  type SyntaxKey,
  type Theme,
  type ThemeMode,
} from "./theme";

type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  bg: "Background",
  fg: "Text",
  fgMuted: "Muted text",
  border: "Border",
  accent: "Accent",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  cyan: "Cyan",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

const MAX_ERROR = 120;
type OptionalRole = "bgAlt" | "bgInset" | "comment" | "selection";

// When a base role changes, the optional roles derived from it are dropped so resolvePalette
// recomputes them instead of keeping stale values.
const DERIVED: Partial<Record<Role, OptionalRole[]>> = {
  bg: ["bgAlt", "bgInset"],
  fg: ["bgAlt", "bgInset"],
  fgMuted: ["comment"],
  accent: ["selection"],
};

const DERIVED_SYNTAX: Partial<Record<Role, SyntaxKey>> = {
  pink: "keyword",
  green: "function",
  purple: "constant",
  yellow: "string",
  cyan: "tag",
  orange: "variable",
};

// Warnings only, never blocking: text roles 4.5:1, accent 3:1, border a visible 1.1:1 edge.
const FLOORS: [Role, number][] = [["fg", 4.5], ["fgMuted", 4.5], ["accent", 3], ["border", 1.1]];

export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > MAX_ERROR ? `${text.slice(0, MAX_ERROR - 1)}…` : text;
}

export function contrastWarnings(theme: Theme): string[] {
  const palette = resolvePalette(theme.palette, theme.mode);
  const warnings: string[] = [];
  for (const [role, floor] of FLOORS) {
    const ratio = contrast(palette[role], palette.bg);
    if (ratio >= floor) continue;
    const shown = (Math.floor(ratio * 10) / 10).toFixed(1);
    warnings.push(`${ROLE_LABELS[role]} (${role}) on background is ${shown}:1, below ${floor}:1`);
  }
  return warnings;
}

export function copyOf(source: Theme): Theme {
  const base = source.name.slice(0, MAX_NAME - " copy".length).trimEnd();
  return validateTheme({ ...source, id: createThemeId(), name: `${base} copy` });
}

export function startFromCopy(mode: ThemeMode, active: Theme | undefined): Theme {
  const source = active?.mode === mode ? active : BUILTIN_THEMES.find((theme) => theme.mode === mode)!;
  return copyOf(source);
}

export interface EditorOptions {
  theme: Theme;
  isNew: boolean;
  onSave(theme: Theme): Promise<void>;
  onCancel(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text: string, className: string, attr: string) {
  const node = el("button", className, text);
  node.type = "button";
  node.setAttribute(attr, "");
  return node;
}

// <input type=color> only holds #rrggbb, so alpha is dropped for the picker; the text field keeps
// the full value.
const opaqueHex = (value: string) => {
  const color = parseColor(value);
  return color ? formatColor({ ...color, a: 1 }) : null;
};

function modeField(mode: ThemeMode, isNew: boolean, onChange: (mode: ThemeMode) => void) {
  const label = el("label", "d-block mb-3", "Mode ");
  if (!isNew) {
    const text = el("span", "text-bold", mode);
    text.dataset.ghaField = "mode";
    label.append(text);
    return label;
  }
  const select = el("select", "form-select ml-2");
  select.dataset.ghaField = "mode";
  for (const value of ["light", "dark"] as const) {
    const option = el("option", "", value);
    option.value = value;
    option.selected = value === mode;
    select.append(option);
  }
  select.addEventListener("change", () => onChange(select.value === "light" ? "light" : "dark"));
  label.append(select);
  return label;
}

/**
 * Opens the editor. If onSave rejects the message is shown and the dialog stays open. Returns a
 * close function that does not call onCancel.
 */
export function openEditor({ theme, isNew, onSave, onCancel }: EditorOptions): () => void {
  const colors: Partial<Palette> = { ...theme.palette };
  const invalid = new Set<Role>();
  let mode = theme.mode;
  let saving = false;
  let done = false;

  const dialog = el("dialog", "Box color-shadow-large p-0");
  dialog.dataset.ghaThemeEditor = "";
  dialog.setAttribute("aria-label", isNew ? "New theme" : "Edit theme");
  const title = el("h2", "Box-title", isNew ? "New theme" : `Edit ${theme.name}`);
  const header = el("div", "Box-header");
  header.append(title);
  const body = el("div", "Box-body");

  const nameLabel = el("label", "d-block mb-3", "Name");
  const name = el("input", "form-control d-block width-full mt-1");
  name.type = "text";
  name.maxLength = MAX_NAME;
  name.value = theme.name;
  name.dataset.ghaField = "name";
  nameLabel.append(name);

  const preview = el("img", "d-block border rounded-2 mb-3 width-full");
  preview.alt = "Theme preview";
  preview.dataset.ghaPreview = "";
  const warnings = el("ul", "list-style-none color-fg-attention mb-2");
  warnings.dataset.ghaWarnings = "";
  warnings.setAttribute("role", "status");
  const error = el("p", "color-fg-danger mb-0");
  error.dataset.ghaError = "";
  error.setAttribute("role", "alert");

  const rows = el("div", "mb-3");
  for (const role of ROLES) rows.append(colorRow(role));

  const save = button("Save", "btn btn-primary", "data-gha-save");
  const cancel = button("Cancel", "btn mr-2", "data-gha-cancel");
  const footer = el("div", "Box-footer d-flex flex-justify-end");
  footer.append(cancel, save);
  const setMode = (next: ThemeMode) => {
    mode = next;
    refresh();
  };
  body.append(nameLabel, modeField(mode, isNew, setMode), rows, preview, warnings, error);
  dialog.append(header, body, footer);

  function colorRow(role: Role) {
    const row = el("div", "d-flex flex-items-center mb-2");
    row.dataset.ghaRole = role;
    const picker = el("input", "mr-2");
    picker.type = "color";
    picker.id = `gha-theme-editor-${role}`;
    picker.value = opaqueHex(colors[role]!) ?? "#000000";
    const label = el("label", "flex-1", ROLE_LABELS[role]);
    label.htmlFor = picker.id;
    const hex = el("input", "form-control input-sm");
    hex.type = "text";
    hex.value = colors[role]!;
    // Room for #rrggbbaa.
    hex.maxLength = 9;
    hex.spellcheck = false;
    hex.setAttribute("aria-label", `${ROLE_LABELS[role]} hex`);
    picker.addEventListener("input", () => {
      hex.value = picker.value;
      setColor(role, row, hex, picker.value);
    });
    hex.addEventListener("input", () => {
      const value = hex.value.trim();
      const opaque = opaqueHex(value);
      if (opaque) picker.value = opaque;
      setColor(role, row, hex, opaque ? value : null);
    });
    row.append(picker, label, hex);
    return row;
  }

  function setColor(role: Role, row: HTMLElement, hex: HTMLInputElement, value: string | null) {
    for (const node of [row, hex]) {
      if (value) node.removeAttribute("aria-invalid");
      else node.setAttribute("aria-invalid", "true");
    }
    if (!value) invalid.add(role);
    else {
      colors[role] = value;
      dropDerived(role);
      invalid.delete(role);
    }
    refresh();
  }

  function dropDerived(role: Role) {
    for (const optional of DERIVED[role] ?? []) delete colors[optional];
    const key = DERIVED_SYNTAX[role];
    if (!key || !colors.syntax) return;
    colors.syntax = { ...colors.syntax };
    delete colors.syntax[key];
  }

  const nameValid = () => {
    const text = name.value.trim();
    return text.length > 0 && text.length <= MAX_NAME;
  };

  // Same validation as storage, so the editor cannot save what loading would reject.
  const draft = () => validateTheme({ id: theme.id, name: name.value, mode, palette: colors });

  function refresh() {
    save.disabled = saving || invalid.size > 0 || !nameValid();
    // Keep the last good preview while a field holds an invalid color.
    if (invalid.size) return;
    const current = { ...theme, mode, palette: colors as Palette };
    preview.src = previewDataUrl(current);
    warnings.replaceChildren(...contrastWarnings(current).map((text) => el("li", "", text)));
  }

  const finish = (cancelled: boolean) => {
    // Cancel button, Escape and the close event can all arrive; teardown runs once.
    if (done) return;
    done = true;
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    dialog.remove();
    if (cancelled) onCancel();
  };

  const close = () => finish(false);
  const dismiss = () => finish(true);

  async function submit() {
    if (save.disabled) return;
    error.textContent = "";
    saving = true;
    refresh();
    try {
      await onSave(draft());
      close();
    } catch (failure) {
      error.textContent = errorText(failure);
    } finally {
      saving = false;
      refresh();
    }
  }

  name.addEventListener("input", refresh);
  save.addEventListener("click", () => void submit());
  cancel.addEventListener("click", dismiss);
  // Handle Escape ourselves so teardown always goes through finish().
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener("close", dismiss);

  refresh();
  document.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  name.focus();
  return close;
}
