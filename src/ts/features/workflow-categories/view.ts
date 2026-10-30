/**
 * Categories UI for the Actions sidebar: renders user categories and pinned workflows from the
 * rows passed to `sync`, persists changes, and keeps native pin/picker controls in sync.
 */
import { createIcon } from "../../core/settings";
import { ui } from "../../core/ui";
import * as categoryStore from "./categoryStore";
import {
  cloneCategories,
  mergeBackup,
  sameSnapshot,
  validateBackup,
  validateCategories,
  type Category,
  type Snapshot,
} from "./model";

type CategoriesState = {
  repository: string;
  sidebar: HTMLElement | undefined;
  workflows: HTMLAnchorElement[];
  workflowPath: string;
  query: string;
  view: HTMLElement | undefined;
  loaded: boolean;
  renderKey: string;
  renderedWorkflows: HTMLAnchorElement[];
  renderedPins: (HTMLElement | null)[];
  renderedAllLink: HTMLAnchorElement | undefined;
  hiddenAllRow: HTMLElement | null | undefined;
  nativePickerPositions: Map<HTMLElement, HTMLElement>;
  data: Snapshot;
  pendingSave: { repository: string; snapshot: Snapshot; revision: number } | undefined;
  saveStatus: string;
  saveStatusDismissed: boolean;
  saveInvalidated: boolean;
  pendingImport: Snapshot | undefined;
  importError: string;
  importNotice: string;
  formMode: string;
  formCategory: string;
  pendingWorkflowId: string;
  formValue: string;
  editing: string;
  editingRemoved: Set<string>;
  editingAdded: Set<string>;
};

// All per-repository view state in one object so reset() can replace it wholesale.
const createState = (): CategoriesState => ({
  repository: "",
  sidebar: undefined,
  workflows: [],
  workflowPath: "",
  query: "",
  view: undefined,
  loaded: false,
  renderKey: "",
  renderedWorkflows: [],
  renderedPins: [],
  renderedAllLink: undefined,
  hiddenAllRow: undefined,
  nativePickerPositions: new Map(),
  data: { categories: [] },
  pendingSave: undefined,
  saveStatus: "",
  saveStatusDismissed: false,
  saveInvalidated: false,
  pendingImport: undefined,
  importError: "",
  importNotice: "",
  formMode: "",
  formCategory: "",
  pendingWorkflowId: "",
  formValue: "",
  editing: "",
  editingRemoved: new Set(),
  editingAdded: new Set(),
});

// `revision` bumps on every reset(); async loads and saves compare it to ignore results that belong
// to a previous repository. `drafts` holds unsaved snapshots per repository that outlive reset();
// `invalidatedDrafts` marks those whose save failed because the extension context was lost.
let state = createState();
let revision = 0;
let writing = false;
let writeTask: Promise<void> | undefined;
let nativePickerObserver: ResizeObserver | undefined;
const drafts = new Map<string, Snapshot>();
const invalidatedDrafts = new Set<string>();

const snapshot = (): Snapshot => ({
  categories: cloneCategories(state.data.categories),
});

const workflowId = (link: HTMLAnchorElement): string =>
  link.pathname.slice(state.workflowPath.length);
const categoryFor = (name: string): Category | undefined =>
  state.data.categories.find((category) => category.name === name);
const assigned = (id: string): string[] =>
  state.data.categories
    .filter((category) => category.workflows.includes(id))
    .map((category) => category.name);
const matching = (link: HTMLAnchorElement): boolean =>
  link.textContent.toLowerCase().includes(state.query.trim().toLowerCase());
const pinButton = (row: Element | null): HTMLElement | null =>
  row?.querySelector(
    '[data-component="ActionList.TrailingAction"][class*="pinButton"] button, button[aria-label*="pin" i]',
  ) ??
  ([...(row?.querySelectorAll("button[aria-labelledby]") ?? [])].find(
    (button) =>
      /^(?:unpin|pin|remove pin)\b/i.test(
        document
          .getElementById(button.getAttribute("aria-labelledby") ?? "")
          ?.textContent.trim() ?? "",
      ),
  ) as unknown as HTMLElement | null);
const pinLabel = (pin: HTMLElement | null): string =>
  pin
    ? (pin.getAttribute("aria-label") ??
      document
        .getElementById(pin.getAttribute("aria-labelledby") ?? "")
        ?.textContent.trim() ??
      "Pin workflow")
    : "";
const isPinned = (pin: HTMLElement | null): boolean =>
  /^(?:Unpin|Remove pin)\b/i.test(pinLabel(pin));

// Serial writer: only one write at a time, always writing the latest pendingSave. A draft is
// dropped only once the same snapshot has been saved, so a failed or superseded save keeps it.
// A failed save for a stale revision (view reset meanwhile) is not shown; the draft is retained.
async function persist(): Promise<void> {
  if (writing) return;
  writing = true;
  while (state.pendingSave) {
    const current = state.pendingSave;
    state.pendingSave = undefined;
    try {
      await categoryStore.save(current.repository, current.snapshot);
      const savedRepository = current.repository;
      if (sameSnapshot(drafts.get(savedRepository), current.snapshot)) {
        drafts.delete(savedRepository);
        invalidatedDrafts.delete(savedRepository);
        if (state.repository === savedRepository && state.saveStatus === "error") {
          state.saveStatus = "";
          updateSaveStatus(state.view);
        }
      }
    } catch (error) {
      // "Extension context invalidated": the extension was reloaded while this tab stayed open,
      // so its storage API is gone for good and retrying from this tab cannot work.
      console.warn("Could not save workflow categories", error);
      if (revision === current.revision) {
        state.pendingSave = undefined;
        state.saveStatus = "error";
        state.saveStatusDismissed = false;
        state.saveInvalidated = /Extension context invalidated/i.test(String(error));
        updateSaveStatus(state.view);
        break;
      }
    }
    if (revision === current.revision && !state.pendingSave) {
      state.saveStatus = "";
      updateSaveStatus(state.view);
    }
  }
  writing = false;
}

// Queues a snapshot write. showSaving=false is for quiet changes (collapse toggles): the status
// stays hidden as "pending" unless a visible save is already in progress.
function save(showSaving = true): Promise<void> | undefined {
  state.importNotice = "";
  state.view?.querySelector(".gha-workflow-category-import-notice")?.remove();
  state.pendingSave = { repository: state.repository, snapshot: snapshot(), revision };
  state.saveStatus = showSaving || state.saveStatus === "saving" ? "saving" : "pending";
  state.saveStatusDismissed = false;
  state.saveInvalidated = false;
  if (!writing) writeTask = persist();
  updateSaveStatus(state.view);
  return writeTask;
}

function exportCategories(): void {
  const backup = {
    format: "gha-workflow-categories",
    version: 2,
    repository: state.repository,
    ...snapshot(),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `gha-categories-${state.repository.replaceAll("/", "-")}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function applyImport(mode: "merge" | "replace"): Promise<void> {
  if (!state.pendingImport) return;
  const next =
    mode === "merge"
      ? { categories: mergeBackup(state.data.categories, state.pendingImport.categories) }
      : state.pendingImport;
  const importingRepository = state.repository;
  state.data = next;
  state.pendingImport = undefined;
  state.importError = "";
  state.importNotice = "";
  state.formMode = "";
  state.editing = "";
  state.editingRemoved.clear();
  state.editingAdded.clear();
  const write = save();
  render();
  await write;
  if (state.repository === importingRepository && !state.saveStatus) {
    state.importNotice = "Categories imported and saved.";
    render();
  }
}

function updateSaveStatus(root: HTMLElement | undefined): void {
  if (!root) return;
  let status = root.querySelector(
    ":scope > .gha-workflow-category-save-status",
  );
  if (!state.saveStatus || state.saveStatus === "pending" || state.saveStatusDismissed) {
    status?.remove();
    return;
  }
  if (!status) {
    status = document.createElement("div");
    status.className = "gha-workflow-category-save-status";
    root
      .querySelector(":scope > .gha-workflow-categories-heading")
      ?.after(status);
  }
  status.setAttribute("role", state.saveStatus === "error" ? "alert" : "status");
  const message =
    state.saveStatus === "error"
      ? state.saveInvalidated
        ? "Category changes were not saved. This tab lost its extension connection; note the changes, refresh this tab, and redo them."
        : "Category changes were not saved. Retry before leaving or reloading this tab."
      : "Saving category changes…";
  status.replaceChildren(
    makeButton(
      message,
      () => {
        state.saveStatusDismissed = true;
        status.remove();
      },
      "gha-workflow-category-message",
    ),
  );
  if (state.saveStatus === "error" && !state.saveInvalidated)
    status.append(makeButton("Retry save", () => save()));
}

/**
 * Discards the view for the current repository (navigation or collapsed sidebar). Unsaved or failed
 * changes are kept as drafts so returning to the repository shows them again.
 */
export function reset(): void {
  if (state.saveStatus && state.repository) {
    drafts.set(state.repository, snapshot());
    if (state.saveInvalidated) invalidatedDrafts.add(state.repository);
    else invalidatedDrafts.delete(state.repository);
  }
  revision++;
  nativePickerObserver?.disconnect();
  state.view?.remove();
  state.hiddenAllRow?.removeAttribute("data-gha-workflow-all-hidden");
  state = createState();
  document
    .querySelectorAll("[data-gha-workflow-add-native]")
    .forEach((item) => item.remove());
}

// Hides native rows already listed under a category or in Pinned, or filtered out by the query.
function nativeVisibility(): void {
  for (const link of state.workflows) {
    const row = link.closest("li");
    row?.toggleAttribute(
      "data-gha-workflow-hidden",
      !matching(link) ||
        assigned(workflowId(link)).length > 0 ||
        isPinned(pinButton(row)),
    );
  }
}

function makeButton(
  label: string,
  onClick: () => void,
  className?: string,
): HTMLButtonElement {
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = label;
  if (className) item.className = className;
  item.addEventListener("click", onClick);
  return item;
}

function updateToggleAll(
  button: HTMLElement | null = state.view?.querySelector(
    ".gha-workflow-category-toggle-all",
  ) as HTMLElement | null,
): void {
  if (!button) return;
  const expand = state.data.categories.some((category) => category.collapsed);
  const label = expand ? "Expand all categories" : "Collapse all categories";
  button.setAttribute("aria-label", label);
  button.title = label;
  const icon = expand ? "chevrons-down" : "chevrons-up";
  if (button.dataset.icon === icon) return;
  button.dataset.icon = icon;
  button.replaceChildren(createIcon(icon));
}

// Menus are <details>; keep only one open at a time.
function menuClick(event: Event): void {
  event.stopPropagation();
  for (const menu of document.querySelectorAll<HTMLDetailsElement>(
    ".gha-workflow-category-picker[open], .gha-workflow-category-options[open]",
  )) {
    if (menu !== event.currentTarget) menu.open = false;
  }
}

function categoryForm(): HTMLElement {
  const form = document.createElement("form");
  form.className = "gha-workflow-category-form";
  form.hidden = !state.formMode;
  const field = document.createElement("input");
  field.setAttribute("aria-label", "Category name");
  field.placeholder = "Category name";
  field.maxLength = 40;
  field.required = true;
  field.value = state.formValue;
  field.addEventListener("input", () => {
    state.formValue = field.value;
  });
  const error = document.createElement("span");
  error.className = "gha-workflow-category-error";
  error.setAttribute("role", "alert");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = field.value.trim();
    const duplicate = state.data.categories.some(
      (item) =>
        item.name !== state.formCategory &&
        item.name.toLowerCase() === name.toLowerCase(),
    );
    if (!name || duplicate) {
      error.textContent = duplicate
        ? "Category already exists"
        : "Enter a category name";
      return;
    }
    if (state.formMode === "new") {
      state.data.categories.push({
        name,
        workflows: state.pendingWorkflowId ? [state.pendingWorkflowId] : [],
        collapsed: false,
      });
    } else {
      categoryFor(state.formCategory)!.name = name;
      if (state.editing === state.formCategory) state.editing = name;
    }
    state.formMode = "";
    state.formCategory = "";
    state.pendingWorkflowId = "";
    state.formValue = "";
    save();
    render();
  });
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.textContent = "Save";
  saveButton.className = "gha-workflow-category-save";
  form.append(
    field,
    saveButton,
    makeButton("Cancel", () => {
      state.formMode = "";
      state.formCategory = "";
      state.pendingWorkflowId = "";
      state.formValue = "";
      render();
    }),
  );
  form.append(error);
  return form;
}

function categoryPicker(link: HTMLAnchorElement, native = false): HTMLElement {
  const id = workflowId(link);
  const menu = document.createElement("details");
  menu.className = "gha-workflow-category-picker";
  menu.addEventListener("click", menuClick);
  if (native) menu.setAttribute("data-gha-workflow-add-native", "");
  const summary = document.createElement("summary");
  summary.setAttribute(
    "aria-label",
    `Add ${link.textContent.trim()} to categories`,
  );
  summary.title = "Add to category";
  summary.textContent = "+";
  const panel = document.createElement("div");
  panel.className = "gha-workflow-category-menu";
  const populate = () => {
    panel.replaceChildren();
    for (const { name } of state.data.categories.filter(
      (item) =>
        !item.workflows.includes(id) &&
        !(state.editing === item.name && state.editingAdded.has(id)),
    )) {
      panel.append(
        makeButton(name, () => {
          if (state.editing === name) state.editingAdded.add(id);
          else categoryFor(name)!.workflows.push(id);
          menu.open = false;
          if (state.editing !== name) save();
          render();
        }),
      );
    }
    panel.append(
      makeButton("Create new category", () => {
        menu.open = false;
        state.formMode = "new";
        state.formCategory = "";
        state.pendingWorkflowId = id;
        state.formValue = "";
        render();
        state.view
          ?.querySelector<HTMLElement>('input[aria-label="Category name"]')
          ?.focus();
      }),
    );
  };
  summary.addEventListener("click", () => {
    if (!menu.open) populate();
  });
  populate();
  menu.append(summary, panel);
  return menu;
}

// Adds a "+" category picker to each native row. It is keyed by text, assignments and pin presence
// so it is rebuilt only when it would differ. Rows with a pin are observed with a ResizeObserver
// because the pin's width and position change with layout and the picker is placed relative to it.
function syncNativePickers(): void {
  const pinnedRows = new Map<HTMLElement, HTMLElement>();
  for (const link of state.workflows) {
    const row = link.closest("li");
    if (!row) continue;
    const pin = pinButton(row);
    const key = JSON.stringify([
      link.textContent,
      assigned(workflowId(link)),
      !!pin,
    ]);
    const existing = row.querySelector(
      ":scope > [data-gha-workflow-add-native]",
    ) as HTMLElement | null;
    if (existing?.dataset.key !== key) {
      const picker = categoryPicker(link, true);
      picker.dataset.key = key;
      if (pin) picker.setAttribute("data-gha-has-pin", "");
      if (existing) existing.replaceWith(picker);
      else row.append(picker);
    }
    row
      .querySelector(":scope > [data-gha-workflow-add-native]")
      ?.toggleAttribute("data-gha-pinned", isPinned(pin));
    if (!pin) {
      if (row.style.getPropertyValue("--gha-native-picker-inset"))
        row.style.removeProperty("--gha-native-picker-inset");
      continue;
    }
    if (!row.classList.contains("gha-workflow-api-row"))
      pinnedRows.set(row, pin);
  }
  if (pinnedRows.size && !nativePickerObserver)
    nativePickerObserver = new ResizeObserver(syncNativePickerPositions);
  for (const [row, pin] of state.nativePickerPositions) {
    if (pinnedRows.get(row) === pin) continue;
    nativePickerObserver!.unobserve(row);
    nativePickerObserver!.unobserve(pin);
  }
  for (const [row, pin] of pinnedRows) {
    if (state.nativePickerPositions.get(row) === pin) continue;
    nativePickerObserver!.observe(row);
    nativePickerObserver!.observe(pin);
  }
  state.nativePickerPositions = pinnedRows;
}

// Sets --gha-native-picker-inset so the picker sits left of the pin; skipped when not laid out.
function syncNativePickerPositions(): void {
  const positions = [...state.nativePickerPositions].map(([row, pin]) => {
    const rowRect = row.getBoundingClientRect();
    const pinRect = pin.getBoundingClientRect();
    return [
      row,
      rowRect.width && pinRect.width
        ? `${Math.ceil(rowRect.right - pinRect.left)}px`
        : "",
    ];
  });
  for (const [row, inset] of positions) {
    if (
      inset &&
      (row as HTMLElement).style.getPropertyValue(
        "--gha-native-picker-inset",
      ) !== inset
    )
      (row as HTMLElement).style.setProperty(
        "--gha-native-picker-inset",
        inset as string,
      );
  }
}

function categoryLink(link: HTMLAnchorElement): HTMLElement {
  const row = document.createElement("li");
  row.className = "gha-workflow-category-row";
  row.style.fontSize = getComputedStyle(link).fontSize;
  const anchor = document.createElement("a");
  anchor.href = link.href;
  anchor.textContent = link.textContent.trim();
  if (link.hasAttribute("data-gha-workflow-disabled")) {
    anchor.setAttribute("data-gha-workflow-disabled", "");
    anchor.setAttribute(
      "aria-label",
      `${anchor.textContent}, disabled workflow`,
    );
  }
  if (
    link.pathname === location.pathname ||
    link.hasAttribute("aria-current") ||
    link.closest("li")?.hasAttribute("aria-current")
  ) {
    row.setAttribute("data-gha-active", "");
    anchor.setAttribute("aria-current", "page");
  }
  anchor.addEventListener("click", (event) => {
    if (!ui.isPlainClick(event)) return;
    event.preventDefault();
    link.click();
  });
  row.append(anchor, categoryPicker(link));
  const nativePin = pinButton(link.closest("li"));
  if (nativePin) {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "gha-workflow-category-pin";
    pin.setAttribute("aria-label", pinLabel(nativePin));
    pin.title = pinLabel(nativePin);
    pin.toggleAttribute("data-gha-pinned", isPinned(nativePin));
    const icon = nativePin.querySelector("svg")?.cloneNode(true);
    pin.append(icon ?? document.createTextNode("Pin"));
    pin.addEventListener("click", () => {
      nativePin.click();
      window.setTimeout(render, 0);
    });
    row.append(pin);
  }
  return row;
}

function categorySection(name: string): HTMLElement {
  const category = categoryFor(name)!;
  const section = document.createElement("section");
  section.className = "gha-workflow-category";
  section.setAttribute("data-gha-category-name", name);
  const allMembers = state.workflows.filter(
    (link) =>
      category.workflows.includes(workflowId(link)) ||
      (state.editing === name && state.editingAdded.has(workflowId(link))),
  );
  const members = allMembers.filter(matching);
  if (state.query.trim() && !members.length && state.editing !== name)
    section.hidden = true;
  const header = document.createElement("div");
  header.className = "gha-workflow-category-header";
  header.toggleAttribute("data-gha-editing", state.editing === name);
  const list = document.createElement("ul");
  list.className = "gha-workflow-category-list";
  const updateList = () => {
    const isCollapsed = category.collapsed;
    for (const row of list.children) (row as HTMLElement).hidden = isCollapsed;
    list.hidden = state.editing === name || isCollapsed;
  };
  const toggle = makeButton(
    name,
    () => {
      category.collapsed = !category.collapsed;
      updateList();
      const editor = section.querySelector(
        ".gha-workflow-category-editor",
      ) as HTMLElement | null;
      if (editor) editor.hidden = category.collapsed;
      toggle.setAttribute("aria-expanded", String(!category.collapsed));
      updateToggleAll();
      syncNativePickers();
      save(false);
    },
    "gha-workflow-category-toggle",
  );
  toggle.setAttribute("aria-expanded", String(!category.collapsed));
  toggle.setAttribute("aria-label", name);
  const nameText = document.createElement("span");
  nameText.className = "gha-workflow-category-name";
  nameText.textContent = name;
  toggle.replaceChildren(nameText);
  const count = document.createElement("span");
  count.className = "gha-workflow-category-count";
  count.textContent = String(members.length);
  count.setAttribute("aria-hidden", "true");
  const options = document.createElement("details");
  options.className = "gha-workflow-category-options";
  options.addEventListener("click", menuClick);
  const optionsButton = document.createElement("summary");
  optionsButton.setAttribute("aria-label", `Options for ${name}`);
  optionsButton.textContent = "⋯";
  const optionsMenu = document.createElement("div");
  optionsMenu.className = "gha-workflow-category-menu";
  if (allMembers.length && !state.editing) {
    const edit = makeButton("Edit workflows", () => {
      state.editing = name;
      state.editingRemoved.clear();
      state.editingAdded.clear();
      if (category.collapsed) {
        category.collapsed = false;
        save(false);
      }
      render();
      state.view
        ?.querySelector<HTMLElement>(".gha-workflow-category-editor input")
        ?.focus();
    });
    edit.setAttribute("aria-label", `Edit workflows in ${name}`);
    optionsMenu.append(edit);
  }
  const rename = makeButton("Rename", () => {
    state.formMode = "rename";
    state.formCategory = name;
    state.pendingWorkflowId = "";
    state.formValue = name;
    render();
    state.view
      ?.querySelector<HTMLElement>('input[aria-label="Category name"]')
      ?.focus();
  });
  rename.setAttribute("aria-label", `Rename ${name}`);
  const remove = makeButton("Delete", () => {
    if (!window.confirm(`Delete category “${name}”?`)) return;
    state.data.categories = state.data.categories.filter((item) => item !== category);
    if (state.editing === name) state.editing = "";
    save();
    render();
    state.view?.querySelector<HTMLElement>(".gha-workflow-category-new")?.focus();
  });
  remove.setAttribute("aria-label", `Delete ${name}`);
  optionsMenu.append(rename, remove);
  options.append(optionsButton, optionsMenu);
  header.append(toggle);
  if (state.editing === name) {
    const finishEditing = () => {
      state.editing = "";
      state.editingRemoved.clear();
      state.editingAdded.clear();
      render();
      [...(state.view?.querySelectorAll(".gha-workflow-category") ?? [])]
        .find((item) => item.getAttribute("data-gha-category-name") === name)
        ?.querySelector<HTMLElement>(".gha-workflow-category-toggle")
        ?.focus();
    };
    header.append(
      makeButton(
        "Save",
        () => {
          for (const id of state.editingRemoved)
            category.workflows = category.workflows.filter(
              (item) => item !== id,
            );
          for (const id of state.editingAdded)
            if (!state.editingRemoved.has(id) && !category.workflows.includes(id))
              category.workflows.push(id);
          if (state.editingRemoved.size || state.editingAdded.size) save();
          finishEditing();
        },
        "gha-workflow-category-edit-save",
      ),
      makeButton("Cancel", finishEditing, "gha-workflow-category-edit-cancel"),
    );
  } else {
    toggle.append(count);
    header.append(options);
  }
  section.append(header);
  for (const link of members) list.append(categoryLink(link));
  updateList();
  section.append(list);
  if (state.editing === name && allMembers.length) {
    const editor = document.createElement("div");
    editor.className = "gha-workflow-category-editor";
    editor.hidden = category.collapsed;
    for (const link of allMembers) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.workflowId = workflowId(link);
      checkbox.checked = !state.editingRemoved.has(workflowId(link));
      checkbox.addEventListener("change", () => {
        const id = workflowId(link);
        if (checkbox.checked) state.editingRemoved.delete(id);
        else state.editingRemoved.add(id);
      });
      label.append(checkbox, document.createTextNode(link.textContent.trim()));
      editor.append(label);
    }
    section.append(editor);
  }
  return section;
}

// Rebuild only when something visible changed: a rebuild replaces the DOM (and the focused
// input). Link and pin identity is compared too, since a re-rendered node can keep the same text.
function render(): void {
  if (!state.loaded || !state.sidebar?.isConnected) return;
  nativeVisibility();
  const allLink = [
    ...state.sidebar.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ].find(
    (link) =>
      link.origin === location.origin &&
      link.pathname.replace(/\/$/, "") === `/${state.repository}/actions`,
  );
  const allRow = allLink?.closest("li") ?? allLink;
  if (state.hiddenAllRow !== allRow) {
    state.hiddenAllRow?.removeAttribute("data-gha-workflow-all-hidden");
    allRow?.setAttribute("data-gha-workflow-all-hidden", "");
    state.hiddenAllRow = allRow;
  }
  const pins = state.workflows.map((link) => pinButton(link.closest("li")));
  const signature = JSON.stringify([
    state.repository,
    state.data,
    state.query,
    allLink?.textContent,
    allLink?.getAttribute("aria-current"),
    state.workflows.map((link, index) => [
      workflowId(link),
      link.textContent,
      pinLabel(pins[index]),
      link.hasAttribute("aria-current") ||
        link.closest("li")?.hasAttribute("aria-current"),
    ]),
    location.pathname,
    state.formMode,
    state.formCategory,
    state.pendingWorkflowId,
    state.editing,
    [...state.editingAdded],
    state.pendingImport?.categories.length,
    state.importError,
    state.importNotice,
  ]);
  if (
    state.view?.isConnected &&
    state.view.nextElementSibling === state.sidebar &&
    state.renderKey === signature &&
    state.renderedWorkflows.length === state.workflows.length &&
    state.renderedWorkflows.every((link, index) => link === state.workflows[index]) &&
    state.renderedPins.every((pin, index) => pin === pins[index]) &&
    state.renderedAllLink === allLink &&
    state.workflows.every((link) =>
      link
        .closest("li")
        ?.querySelector(":scope > [data-gha-workflow-add-native]"),
    )
  )
    return;
  syncNativePickers();
  // Remember focus: the rebuild below replaces the input.
  const fieldFocused =
    document.activeElement?.getAttribute("aria-label") === "Category name";
  const next = document.createElement("div");
  next.className = "gha-workflow-categories";
  if (allLink) {
    const movedLink = document.createElement("a");
    movedLink.className = "gha-workflow-all-link";
    movedLink.href = allLink.href;
    movedLink.style.fontSize = getComputedStyle(allLink).fontSize;
    movedLink.append(
      ...[...allLink.childNodes].map((node) => node.cloneNode(true)),
    );
    if (location.pathname.replace(/\/$/, "") === `/${state.repository}/actions`)
      movedLink.setAttribute("aria-current", "page");
    movedLink.addEventListener("click", (event) => {
      if (!ui.isPlainClick(event)) return;
      event.preventDefault();
      allLink.click();
    });
    next.append(movedLink);
  }
  const pinned = state.workflows.filter(
    (link, index) => isPinned(pins[index]) && matching(link),
  );
  if (pinned.length) {
    const section = document.createElement("section");
    section.className = "gha-workflow-pinned";
    section.setAttribute("aria-label", "Pinned workflows");
    const heading = document.createElement("div");
    heading.className = "gha-workflow-categories-heading";
    const title = document.createElement("h3");
    title.className = "gha-workflow-category-title";
    title.textContent = "Pinned workflows";
    heading.append(title);
    const list = document.createElement("ul");
    list.className = "gha-workflow-pinned-list";
    for (const link of pinned) list.append(categoryLink(link));
    section.append(heading, list);
    next.append(section);
  }
  const heading = document.createElement("div");
  heading.className = "gha-workflow-categories-heading";
  const title = document.createElement("h3");
  title.className = "gha-workflow-category-title";
  title.textContent = "Categories";
  const newCategory = makeButton(
    "New category",
    () => {
      state.formMode = "new";
      state.formCategory = "";
      state.pendingWorkflowId = "";
      state.formValue = "";
      render();
      state.view
        ?.querySelector<HTMLElement>('input[aria-label="Category name"]')
        ?.focus();
    },
    "gha-workflow-category-new",
  );
  heading.append(title);
  const backupOptions = document.createElement("details");
  backupOptions.className =
    "gha-workflow-category-options gha-workflow-category-backup";
  backupOptions.addEventListener("click", menuClick);
  const backupTrigger = document.createElement("summary");
  backupTrigger.setAttribute("aria-label", "Category backup options");
  backupTrigger.title = "Import or export categories";
  backupTrigger.textContent = "⋯";
  const backupMenu = document.createElement("div");
  backupMenu.className = "gha-workflow-category-menu";
  backupMenu.append(
    makeButton("Export categories", () => {
      backupOptions.open = false;
      exportCategories();
    }),
  );
  const file = document.createElement("input");
  file.type = "file";
  file.accept = ".json,application/json";
  file.hidden = true;
  file.setAttribute("aria-label", "Choose category backup");
  file.addEventListener("change", async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    const selectedRepository = state.repository;
    try {
      const parsed = JSON.parse(await selected.text());
      if (state.repository !== selectedRepository) return;
      state.pendingImport = validateBackup(parsed, state.repository) ?? undefined;
      state.importError = "";
    } catch (error) {
      if (state.repository !== selectedRepository) return;
      state.pendingImport = undefined;
      state.importError =
        error instanceof SyntaxError
          ? "Invalid JSON category backup."
          : (error as Error).message;
    }
    state.importNotice = "";
    render();
  });
  backupMenu.append(
    makeButton("Import categories", () => {
      backupOptions.open = false;
      file.click();
    }),
  );
  backupOptions.append(backupTrigger, backupMenu, file);
  const headingActions = document.createElement("div");
  headingActions.className = "gha-workflow-category-heading-actions";
  if (state.data.categories.length) {
    const toggleAll = makeButton(
      "",
      () => {
        const expand = state.data.categories.some((category) => category.collapsed);
        for (const category of state.data.categories) category.collapsed = !expand;
        save(false);
        state.renderKey = "";
        render();
        state.view
          ?.querySelector<HTMLElement>(".gha-workflow-category-toggle-all")
          ?.focus();
      },
      "gha-workflow-category-toggle-all",
    );
    updateToggleAll(toggleAll);
    newCategory.textContent = "+";
    newCategory.title = "New category";
    newCategory.setAttribute("aria-label", "New category");
    headingActions.append(toggleAll, newCategory);
  }
  headingActions.append(backupOptions);
  heading.append(headingActions);
  next.append(heading);
  updateSaveStatus(next);
  if (!state.data.categories.length) {
    const emptyList = document.createElement("ul");
    emptyList.className = "gha-workflow-category-empty";
    const item = document.createElement("li");
    item.append(newCategory);
    emptyList.append(item);
    next.append(emptyList);
  }
  next.append(categoryForm());
  if (state.pendingImport) {
    const prompt = document.createElement("div");
    prompt.className = "gha-workflow-category-import-prompt";
    prompt.setAttribute("role", "group");
    prompt.setAttribute("aria-label", "Import categories");
    const message = document.createElement("div");
    message.textContent = `Import ${state.pendingImport.categories.length} categories for ${state.repository}. Merge adds to your categories; Replace removes the current categories.`;
    const actions = document.createElement("div");
    actions.className = "gha-workflow-category-import-actions";
    actions.append(
      makeButton("Merge", () => applyImport("merge")),
      makeButton("Replace", () => applyImport("replace")),
      makeButton("Cancel", () => {
        state.pendingImport = undefined;
        render();
      }),
    );
    prompt.append(message, actions);
    next.append(prompt);
  }
  if (state.importError || state.importNotice) {
    const message = document.createElement("div");
    message.className = state.importError
      ? "gha-workflow-category-import-error"
      : "gha-workflow-category-import-notice";
    message.setAttribute("role", state.importError ? "alert" : "status");
    message.append(
      makeButton(
        state.importError || state.importNotice,
        () => {
          state.importError = "";
          state.importNotice = "";
          render();
        },
        "gha-workflow-category-message",
      ),
    );
    next.append(message);
  }
  for (const { name } of state.data.categories) next.append(categorySection(name));
  state.view?.remove();
  state.sidebar!.before(next);
  state.view = next;
  state.renderKey = signature;
  state.renderedWorkflows = [...state.workflows];
  state.renderedPins = pins;
  state.renderedAllLink = allLink;
  if (fieldFocused)
    state.view
      ?.querySelector<HTMLElement>('input[aria-label="Category name"]')
      ?.focus();
}

/**
 * Entry point from the workflow filter on every update: switches repository (resetting and loading
 * its saved categories, or a draft if one exists) and re-renders with the current rows.
 */
export function sync(
  nextRepository: string,
  nextSidebar: HTMLElement,
  nextWorkflows: HTMLAnchorElement[],
  nextQuery: string,
  nextWorkflowPath: string,
): void {
  if (state.repository !== nextRepository) {
    reset();
    state.repository = nextRepository;
    const loadRevision = revision;
    const showStored = (
      saved: Snapshot | undefined,
      draft: boolean,
    ) => {
      // Ignore results for a repository the user already left.
      if (revision !== loadRevision) return;
      state.data = { categories: validateCategories(saved?.categories ?? []) };
      if (draft) {
        state.saveStatus = "error";
        state.saveInvalidated = invalidatedDrafts.has(nextRepository);
      }
      state.loaded = true;
      render();
    };
    categoryStore
      .load(nextRepository)
      .then((stored) => {
        const draft = drafts.get(nextRepository);
        showStored(draft ?? stored, !!draft);
        // Data migrated from V1 is re-saved once so later loads use the V2 record.
        if (stored?.legacy && !draft && revision === loadRevision) save(false);
      })
      .catch((error) => {
        console.warn("Could not load workflow categories", error);
        if (drafts.has(nextRepository)) {
          if (/Extension context invalidated/i.test(String(error)))
            invalidatedDrafts.add(nextRepository);
          showStored(drafts.get(nextRepository), true);
        }
      });
  }
  state.sidebar = nextSidebar;
  state.workflows = nextWorkflows;
  state.query = nextQuery;
  state.workflowPath = nextWorkflowPath;
  nativeVisibility();
  render();
}

// Close open menus on any outside click or Escape; a menu cannot see clicks outside itself.
document.addEventListener("click", (event) => {
  for (const menu of document.querySelectorAll<HTMLDetailsElement>(
    ".gha-workflow-category-picker[open], .gha-workflow-category-options[open]",
  )) {
    if (!menu.contains(event.target as Element)) menu.open = false;
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const menu = document.activeElement?.closest<HTMLDetailsElement>(
    ".gha-workflow-category-picker[open], .gha-workflow-category-options[open]",
  );
  if (menu) {
    menu.open = false;
    menu.querySelector<HTMLElement>("summary")?.focus();
  }
});
window.addEventListener("resize", syncNativePickers);
// Warn before leaving while a save is unfinished or failed (drafts exist).
window.addEventListener("beforeunload", (event) => {
  if (!state.saveStatus && !drafts.size) return;
  event.preventDefault();
  event.returnValue = "";
});
