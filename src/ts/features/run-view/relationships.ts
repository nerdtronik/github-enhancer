/**
 * Hover highlight and scoped view for the job graph. Relations come from GitHub's own connector
 * path elements (`data-from`/`data-to`), so they follow whatever dependency graph it drew.
 */
import { createIcon, settings } from "../../core/settings";
import { scheduleUpdate } from "./shared";

export function addHoverHighlights(
  stages: HTMLElement,
  onScopeChange: (scoped: boolean) => void,
) {
  let connector;
  let incoming = new Map();
  let outgoing = new Map();
  let hovered;
  let scopedId;
  const highlighted = new Set<HTMLElement>();
  // Rebuild the maps whenever the connector paths change (we rely on GitHub redrawing them as
  // the graph updates). A scoped view also needs an update because the visible cards depend on
  // the relations.
  const observer = new MutationObserver(() => {
    rebuild();
    if (scopedId) scheduleUpdate();
  });
  const clear = () => {
    stages.classList.remove("gha-run-hovering");
    for (const card of highlighted)
      card.classList.remove("gha-run-card-hovered", "gha-run-card-connected");
    highlighted.clear();
  };
  // Cards related to `id`: its full upstream chain and full downstream chain (transitive), walked
  // separately so siblings sharing an ancestor are not included.
  const relatedTo = (id) => {
    const related = new Set([id]);
    for (const links of [incoming, outgoing]) {
      const visited = new Set([id]);
      const pending = [id];
      while (pending.length) {
        for (const next of links.get(pending.pop()) || []) {
          if (visited.has(next)) continue;
          visited.add(next);
          related.add(next);
          pending.push(next);
        }
      }
    }
    return related;
  };
  const paint = () => {
    clear();
    if (
      !settings.get("actionRun_hoverFocusEnabled") ||
      !hovered ||
      !stages.contains(hovered)
    )
      return;
    stages.classList.add("gha-run-hovering");
    hovered.classList.add("gha-run-card-hovered");
    highlighted.add(hovered);
    for (const id of relatedTo(hovered.id)) {
      if (id === hovered.id) continue;
      const card = document.getElementById(id);
      if (!card || !stages.contains(card)) continue;
      card.classList.add("gha-run-card-connected");
      highlighted.add(card);
    }
  };
  // incoming/outgoing maps from `data-from`/`data-to`.
  function rebuild() {
    incoming = new Map();
    outgoing = new Map();
    for (const path of connector?.querySelectorAll(
      "path[data-from][data-to]",
    ) || []) {
      const from = path.dataset.from;
      const to = path.dataset.to;
      if (!outgoing.has(from)) outgoing.set(from, new Set());
      if (!incoming.has(to)) incoming.set(to, new Set());
      outgoing.get(from).add(to);
      incoming.get(to).add(from);
    }
    paint();
    applyScope();
  }
  const applyScope = () => {
    const cards = stages.querySelectorAll(
      ".WorkflowStage > .WorkflowCard",
    ) as unknown as HTMLElement[];
    if (scopedId && !Array.from(cards).some((card) => card.id === scopedId)) {
      scopedId = undefined;
      onScopeChange(false);
    }
    const related = scopedId ? relatedTo(scopedId) : new Set();
    for (const card of cards) {
      const hidden = Boolean(scopedId && !related.has(card.id));
      if (card.hasAttribute("data-gha-scope-hidden") !== hidden)
        card.toggleAttribute("data-gha-scope-hidden", hidden);
      card.classList.toggle("gha-run-card-scoped", card.id === scopedId);
      const button = card.querySelector(".gha-run-scope-button");
      const pressed = String(card.id === scopedId);
      if (button && button.getAttribute("aria-pressed") !== pressed)
        button.setAttribute("aria-pressed", pressed);
    }
    for (const stage of stages.querySelectorAll(":scope > .WorkflowStage")) {
      const stageCards = stage.querySelectorAll(":scope > .WorkflowCard");
      stage.toggleAttribute(
        "data-gha-scope-hidden",
        Boolean(
          scopedId &&
          stageCards.length &&
          Array.from(stageCards).every((card) =>
            card.hasAttribute("data-gha-scope-hidden"),
          ),
        ),
      );
    }
  };
  // stopPropagation keeps handlers on ancestors of `stages` (GitHub's graph) from also reacting
  // to the scope button.
  const scopeClick = (event) => {
    const button = event.target.closest?.(".gha-run-scope-button");
    if (!button || !stages.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    const cardId = button.closest(".WorkflowCard").id;
    scopedId = scopedId === cardId ? undefined : cardId;
    hovered = undefined;
    clear();
    applyScope();
    onScopeChange(Boolean(scopedId));
  };
  const refresh = () => {
    for (const card of stages.querySelectorAll(
      ".WorkflowStage > .WorkflowCard[id]",
    )) {
      let button = card.querySelector(
        ".gha-run-scope-button",
      ) as HTMLButtonElement | null;
      if (!button) {
        button = document.createElement("button") as HTMLButtonElement;
        button.type = "button";
        button.className = "gha-run-scope-button";
        button.append(createIcon("scope"));
      }
      if (button.parentElement !== card) card.append(button);
      const rawName =
        card.querySelector(":scope > .WorkflowCard-heading")?.textContent ||
        card.querySelector("tool-tip")?.textContent ||
        card.querySelector(".WorkflowJob-title")?.textContent ||
        "this job";
      const name = rawName.trim().replace(/\s+/g, " ") || "this job";
      const label = `Show dependency flow for ${name}`;
      if (button.getAttribute("aria-label") !== label)
        button.setAttribute("aria-label", label);
      if (button.title !== label) button.title = label;
    }
    // The real connector layer, not the highlight overlay (`connectorLineHighlights`). Observe it
    // again whenever GitHub replaces the element.
    const current = stages.querySelector(
      ':scope > svg[data-targets~="action-graph.connectorLines"]:not([data-target="action-graph.connectorLineHighlights"])',
    );
    if (current !== connector) {
      observer.disconnect();
      connector = current;
      if (connector) {
        observer.observe(connector, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["data-from", "data-to"],
        });
        rebuild();
      } else {
        rebuild();
      }
    } else if (hovered && !stages.contains(hovered)) {
      hovered = undefined;
      clear();
    }
    applyScope();
  };
  const enter = (event) => {
    const card = event.target.closest?.(".WorkflowCard");
    if (!card || !stages.contains(card) || card === hovered) return;
    hovered = card;
    paint();
  };
  // Ignore mouseout between children of the same card.
  const leave = (event) => {
    const card = event.target.closest?.(".WorkflowCard");
    if (card !== hovered || card.contains(event.relatedTarget)) return;
    hovered = undefined;
    clear();
  };
  stages.addEventListener("mouseover", enter);
  stages.addEventListener("mouseout", leave);
  stages.addEventListener("click", scopeClick);
  refresh();
  return {
    refresh,
    paint,
    clearScope() {
      scopedId = undefined;
      applyScope();
      onScopeChange(false);
    },
    remove() {
      observer.disconnect();
      stages.removeEventListener("mouseover", enter);
      stages.removeEventListener("mouseout", leave);
      stages.removeEventListener("click", scopeClick);
      for (const button of stages.querySelectorAll(".gha-run-scope-button"))
        button.remove();
      for (const card of stages.querySelectorAll("[data-gha-scope-hidden]"))
        card.removeAttribute("data-gha-scope-hidden");
      for (const card of stages.querySelectorAll(".gha-run-card-scoped"))
        card.classList.remove("gha-run-card-scoped");
      clear();
    },
  };
}
