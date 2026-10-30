/**
 * Small DOM helpers shared by features, mirroring GitHub's own controls so injected UI feels
 * native. Seam: the `ui` object (toggle, detailsMenu, isPlainClick).
 */
export interface ToggleOptions {
  label: string;
  labelId: string;
  pressed: boolean;
  onChange: (next: boolean) => void;
  variant?: "track" | "knob";
  rowClass?: string;
  buttonClass?: string;
}

export interface Toggle {
  row: HTMLElement;
  button: HTMLButtonElement;
  sync(pressed: boolean): void;
}

// Decorative parts of the switch are hidden because the button's state is announced through
// aria-pressed and its label.
function ariaHidden(element: HTMLElement): HTMLElement {
  element.setAttribute("aria-hidden", "true");
  return element;
}

/**
 * Builds a labelled on/off switch (a button with aria-pressed, not a checkbox, matching GitHub's
 * menu switches). It does not flip itself: it calls onChange(next) and the caller decides the
 * resulting state and calls sync().
 */
export function toggle(options: ToggleOptions): Toggle {
  const { variant = "track" } = options;
  const row = document.createElement("div");
  row.className =
    options.rowClass ?? (variant === "track" ? "gha-run-setting" : "gha-run-settings-row");
  const label = document.createElement("span");
  label.id = options.labelId;
  label.textContent = options.label;
  const button = document.createElement("button");
  button.type = "button";
  if (options.buttonClass) button.className = options.buttonClass;
  button.setAttribute("aria-labelledby", options.labelId);
  let status: HTMLElement | undefined;
  if (variant === "track") {
    const track = ariaHidden(document.createElement("span"));
    track.className = "gha-run-setting-track";
    status = ariaHidden(document.createElement("span"));
    button.append(track, status);
  } else button.append(document.createElement("span"));
  const sync = (pressed: boolean) => {
    button.setAttribute("aria-pressed", String(pressed));
    if (status) status.textContent = pressed ? "On" : "Off";
  };
  sync(options.pressed);
  button.addEventListener("click", () =>
    options.onChange(button.getAttribute("aria-pressed") !== "true"),
  );
  row.append(label, button);
  return { row, button, sync };
}

// One binding per menu: calling detailsMenu twice (e.g. on every re-render) must not stack document
// listeners, so the existing disposer is returned instead.
const bound = new WeakMap<HTMLDetailsElement, () => void>();

/**
 * Gives a <details> dropdown GitHub's behavior: click outside closes it, Escape closes it and
 * returns focus to the <summary>. Returns a disposer. stopPropagation keeps Escape from also
 * closing a surrounding dialog or page handler.
 */
export function detailsMenu(
  menu: HTMLDetailsElement,
  options: { stopPropagation?: boolean } = {},
): () => void {
  const existing = bound.get(menu);
  if (existing) return existing;
  const onClick = (event: Event) => {
    if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    menu.open = false;
    menu.querySelector<HTMLElement>("summary")?.focus();
    event.preventDefault();
    if (options.stopPropagation) event.stopPropagation();
  };
  document.addEventListener("click", onClick);
  menu.addEventListener("keydown", onKeydown);
  const dispose = () => {
    document.removeEventListener("click", onClick);
    menu.removeEventListener("keydown", onKeydown);
    bound.delete(menu);
  };
  bound.set(menu, dispose);
  return dispose;
}

/**
 * True only for an unmodified primary click; modified clicks (new tab, download) must keep the
 * browser's default behavior instead of being handled in-page.
 */
export function isPlainClick(event: MouseEvent): boolean {
  return !(
    event.button ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  );
}

export const ui = { toggle, detailsMenu, isPlainClick };
