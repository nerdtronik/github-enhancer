(() => {
  "use strict";

  const modules = globalThis.__ghaRunViewModules;

  function createScopeIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M1.25 8C2.6 5.5 4.9 4 8 4s5.4 1.5 6.75 4C13.4 10.5 11.1 12 8 12S2.6 10.5 1.25 8Z M10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"
    );
    svg.append(path);
    return svg;
  }

  function addHoverHighlights(stages, onScopeChange) {
    let connector;
    let incoming = new Map();
    let outgoing = new Map();
    let hovered;
    let scopedId;
    const highlighted = new Set();
    const observer = new MutationObserver(() => {
      rebuild();
      if (scopedId) modules.scheduleUpdate();
    });
    const clear = () => {
      stages.classList.remove("gha-run-hovering");
      for (const card of highlighted)
        card.classList.remove("gha-run-card-hovered", "gha-run-card-connected");
      highlighted.clear();
    };
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
      if (!modules.state.hoverFocusEnabled || !hovered || !stages.contains(hovered)) return;
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
    function rebuild() {
      incoming = new Map();
      outgoing = new Map();
      for (const path of connector?.querySelectorAll(
        "path[data-from][data-to]"
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
      const cards = stages.querySelectorAll(".WorkflowStage > .WorkflowCard");
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
                card.hasAttribute("data-gha-scope-hidden")
              )
          )
        );
      }
    };
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
        ".WorkflowStage > .WorkflowCard[id]"
      )) {
        let button = card.querySelector(".gha-run-scope-button");
        if (!button) {
          button = document.createElement("button");
          button.type = "button";
          button.className = "gha-run-scope-button";
          button.append(createScopeIcon());
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
      const current = stages.querySelector(
        ':scope > svg[data-targets~="action-graph.connectorLines"]:not([data-target="action-graph.connectorLineHighlights"])'
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


  modules.addHoverHighlights = addHoverHighlights;
})();
