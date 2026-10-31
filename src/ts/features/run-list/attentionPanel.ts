/**
 * DOM for the "Needs attention" panel. The panel element is created once; `render` patches it so
 * focus, the open tooltip and untouched items survive the frequent page updates.
 */
import { createIcon } from "../../core/settings";
import { ATTENTION_VISIBLE } from "./attention";

export interface PanelItem {
  id: string;
  url: string;
  title: string;
  status: string;
  tone: string;
  branch: string;
  meta: string;
  detail: string;
}

export interface PanelModel {
  items: PanelItem[];
  collapsed: boolean;
  showAll: boolean;
  dismissed: number;
}

export interface PanelActions {
  toggleCollapsed(): void;
  toggleShowAll(): void;
  dismiss(id: string): void;
  restore(): void;
}

function button(className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.addEventListener("click", onClick);
  return element;
}

function buildItem(item: PanelItem, actions: PanelActions): HTMLLIElement {
  const li = document.createElement("li");
  li.dataset.key = item.id;
  li.dataset.signature = JSON.stringify(item);
  const pill = document.createElement("span");
  pill.className = "gha-run-card-status gha-run-attention-pill";
  pill.dataset.tone = item.tone;
  pill.textContent = item.status;
  const link = document.createElement("a");
  link.href = item.url;
  link.textContent = item.title;
  li.append(pill, link);
  if (item.branch) {
    const branch = document.createElement("span");
    branch.className = "gha-run-attention-branch";
    branch.textContent = item.branch;
    branch.title = item.branch;
    li.append(branch);
  }
  for (const text of [item.meta, item.detail]) {
    if (!text) continue;
    const info = document.createElement("span");
    info.className = "gha-run-attention-meta";
    info.textContent = text;
    li.append(info);
  }
  const dismiss = button("gha-run-attention-dismiss", () => actions.dismiss(item.id));
  dismiss.textContent = "×";
  dismiss.setAttribute("aria-label", `Dismiss ${item.title}`);
  dismiss.setAttribute("data-gha-tooltip", "Dismiss");
  li.append(dismiss);
  return li;
}

// Moves/creates only what changed: nodes whose signature is unchanged are reused as they are.
function reconcile(list: HTMLElement, items: PanelItem[], actions: PanelActions): void {
  const existing = new Map<string, HTMLElement>();
  for (const child of list.children) existing.set((child as HTMLElement).dataset.key ?? "", child as HTMLElement);
  const wanted = items.map((item) => {
    const node = existing.get(item.id);
    return node && node.dataset.signature === JSON.stringify(item) ? node : buildItem(item, actions);
  });
  let cursor = list.firstElementChild;
  for (const node of wanted) {
    if (node === cursor) cursor = cursor.nextElementSibling;
    else list.insertBefore(node, cursor);
  }
  for (const child of [...list.children]) if (!wanted.includes(child as HTMLElement)) child.remove();
}

export function createAttentionPanel(actions: PanelActions): {
  element: HTMLElement;
  render(model: PanelModel): void;
} {
  const element = document.createElement("section");
  element.className = "gha-run-attention";
  element.setAttribute("aria-label", "Needs attention");

  const header = document.createElement("div");
  header.className = "gha-run-attention-header";
  const toggle = button("gha-run-attention-toggle-panel", actions.toggleCollapsed);
  const icon = document.createElement("span");
  icon.className = "gha-run-attention-chevron";
  const title = document.createElement("h2");
  title.textContent = "Needs attention";
  const badge = document.createElement("span");
  badge.className = "gha-run-attention-count";
  const scope = document.createElement("span");
  scope.className = "gha-run-attention-scope";
  scope.textContent = "Current list";
  toggle.append(icon, title, badge, scope);
  header.append(toggle);

  const empty = document.createElement("p");
  empty.textContent = "No runs need attention in the current list.";
  const list = document.createElement("ul");
  const more = button("gha-run-attention-more", actions.toggleShowAll);
  const restore = button("gha-run-attention-more", actions.restore);
  element.append(header, empty, list, more, restore);

  let iconState: boolean | undefined;
  return {
    element,
    render(model) {
      const total = model.items.length;
      toggle.setAttribute("aria-expanded", String(!model.collapsed));
      if (iconState !== model.collapsed) {
        iconState = model.collapsed;
        icon.replaceChildren(createIcon(model.collapsed ? "chevron-right" : "chevron-down"));
      }
      badge.hidden = total === 0;
      badge.textContent = String(total);
      empty.hidden = total > 0 || model.collapsed;
      list.hidden = model.collapsed || total === 0;
      reconcile(list, model.collapsed ? [] : model.showAll ? model.items : model.items.slice(0, ATTENTION_VISIBLE), actions);
      more.hidden = model.collapsed || total <= ATTENTION_VISIBLE;
      more.textContent = model.showAll ? "Show fewer" : `Show ${total - ATTENTION_VISIBLE} more`;
      restore.hidden = model.collapsed || model.dismissed === 0;
      restore.textContent = `Restore dismissed (${model.dismissed})`;
    },
  };
}
