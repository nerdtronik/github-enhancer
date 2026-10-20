(() => {
  "use strict";

  const categories = ["people", "bots", "reviews", "commits", "checks", "deployments", "activity"];
  const labels = ["Human comments", "Bot comments", "Review decisions", "Commits and pushes", "Checks", "Deployment statuses", "Other activity"];
  const rowSelector = ".js-timeline-item, .TimelineItem, .timeline-comment, .discussion-item";
  const filterStorageKey = "ghaPrConversationFiltersV1";
  const commentStorageKey = "ghaPrCollapsedCommentsV1";
  let path = "";
  let selected = new Set(categories);
  let unresolvedOnly = false;
  let includeUnresolved = true;
  let rememberFilters = false;
  let collapsedByPr = {};
  let collapsedIds = new Set();
  let loaded = false;
  let writes = Promise.resolve();
  let controls;
  let placeholder;
  let scheduled = false;
  let observedStickyHeader;
  let stickyHeaderObserver;
  let stickyActions;
  let stickyActionsHome;
  let stickyActionsNext;
  let stickyTitle;

  function conversationPath() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(location.pathname)
      ? location.pathname.replace(/\/$/, "")
      : "";
  }

  function findReviewers() {
    const sidebar = document.querySelector("#partial-discussion-sidebar");
    const marker = sidebar?.querySelector(
      '[data-channel-event-name="reviewers_updated"], [aria-label="Select reviewers"]'
    );
    const item = marker?.closest(".discussion-sidebar-item");
    if (item) return item;
    const heading = [...(sidebar ?? document).querySelectorAll(
      ".discussion-sidebar-heading, h2, h3, h4"
    )].find(
      (element) => element.textContent.trim() === "Reviewers"
    );
    return heading?.closest(".discussion-sidebar-item, section") ??
      heading?.parentElement ??
      [...(sidebar?.children ?? [])].find((element) =>
        !element.classList.contains("gha-pr-filters") &&
        !element.classList.contains("gha-pr-filter-placeholder"));
  }

  function resetFixedPosition() {
    controls?.classList.remove("gha-pr-filters-fixed");
    controls?.style.removeProperty("left");
    controls?.style.removeProperty("top");
    controls?.style.removeProperty("width");
    placeholder?.remove();
    placeholder = undefined;
  }

  function syncFixedPosition() {
    if (!controls?.isConnected || !path) return;
    const headerBottom = observedStickyHeader?.className.includes("is-stuck")
      ? observedStickyHeader.getBoundingClientRect().bottom : 0;
    const fixedTop = headerBottom > 0 ? Math.floor(headerBottom) : 64;
    const rect = (placeholder ?? controls).getBoundingClientRect();
    if (!rect.width) {
      resetFixedPosition();
      return;
    }
    if (rect.top >= fixedTop) {
      resetFixedPosition();
      return;
    }
    if (!placeholder) {
      placeholder = document.createElement("div");
      placeholder.className = "gha-pr-filter-placeholder";
      placeholder.style.height = `${rect.height + parseFloat(getComputedStyle(controls).marginBottom || 0)}px`;
      controls.before(placeholder);
    }
    controls.style.left = `${rect.left}px`;
    controls.style.top = `${fixedTop}px`;
    controls.style.width = `${rect.width}px`;
    controls.classList.add("gha-pr-filters-fixed");
  }

  function clearStickyActions() {
    if (stickyActionsHome?.isConnected && stickyActions)
      stickyActionsHome.insertBefore(stickyActions,
        stickyActionsNext?.parentNode === stickyActionsHome ? stickyActionsNext : null);
    else if (stickyActionsHome) stickyActions?.remove();
    stickyActions?.classList.remove("gha-pr-sticky-actions");
    stickyActions?.style.removeProperty("position");
    stickyActions?.style.removeProperty("left");
    stickyActions?.style.removeProperty("top");
    stickyTitle?.classList.remove("gha-pr-title-with-actions");
    stickyTitle?.style.removeProperty("--gha-pr-title-padding");
    stickyTitle?.style.removeProperty("--gha-pr-actions-reserve");
    stickyActions = undefined;
    stickyActionsHome = undefined;
    stickyActionsNext = undefined;
    stickyTitle = undefined;
  }

  function syncStickyActions() {
    const sticky = observedStickyHeader;
    const header = sticky?.closest('header[data-component="SplitPageLayout.Header"]');
    if (stickyActionsHome && !stickyActionsHome.isConnected) clearStickyActions();
    const actions = stickyActions ?? header?.querySelector('[data-component="PH_Actions"]');
    const title = sticky?.querySelector('[data-component="TitleArea"]');
    if (!path || !sticky?.className.includes("is-stuck") || !actions || !title) {
      clearStickyActions();
      return;
    }
    if (actions !== stickyActions || title !== stickyTitle) {
      clearStickyActions();
      stickyActions = actions;
      stickyActionsHome = actions.parentNode;
      stickyActionsNext = actions.nextSibling;
      stickyTitle = title;
      sticky.append(actions);
      title.style.setProperty("--gha-pr-title-padding", getComputedStyle(title).paddingRight);
    }
    const titleRect = title.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const padding = parseFloat(title.style.getPropertyValue("--gha-pr-title-padding")) || 0;
    if (!titleRect.width || !actionsRect.width) {
      clearStickyActions();
      return;
    }
    const right = Math.min(titleRect.right - padding, window.innerWidth - 16);
    actions.style.setProperty("position", "fixed", "important");
    actions.style.left = `${Math.max(16, Math.round(right - actionsRect.width))}px`;
    const top = Math.round(titleRect.y + (titleRect.height - actionsRect.height) / 2);
    actions.style.top = `${Math.max(8, Math.min(top, window.innerHeight - actionsRect.height - 8))}px`;
    title.style.setProperty("--gha-pr-actions-reserve", `${Math.ceil(actionsRect.width + 8)}px`);
    title.classList.add("gha-pr-title-with-actions");
    actions.classList.add("gha-pr-sticky-actions");
  }

  function watchStickyHeader(sticky) {
    if (observedStickyHeader === sticky) return;
    stickyHeaderObserver?.disconnect();
    clearStickyActions();
    observedStickyHeader = sticky;
    if (sticky) {
      stickyHeaderObserver = new MutationObserver(() => {
        syncStickyActions();
        syncFixedPosition();
      });
      stickyHeaderObserver.observe(sticky, { attributes: true, attributeFilter: ["class"] });
    }
  }

  function timelineRows(root) {
    return [...root.querySelectorAll(rowSelector)].filter((row) => {
      const parentRow = row.parentElement?.closest(rowSelector);
      return !parentRow || !root.contains(parentRow);
    });
  }

  function category(row, description) {
    if (row.contains(description)) return null;
    if (row.matches(".discussion-item-deployed, .discussion-item-deployment"))
      return "deployments";
    if (row.matches(".discussion-item-reviewed, .discussion-item-review"))
      return "reviews";
    if (row.matches(".discussion-item-committed, .discussion-item-force-pushed, .discussion-item-pushed"))
      return "commits";
    if (row.matches(".discussion-item-status, .discussion-item-check"))
      return "checks";
    const comment = row.matches(".timeline-comment") ||
      !!row.querySelector(".timeline-comment, .comment-body, .js-comment-body");
    if (!comment && [...row.querySelectorAll("button")].some((button) =>
      /^(?:load|show) more/i.test(button.textContent.trim())))
      return null;
    if (comment) {
      const author = row.querySelector(".timeline-comment a.author, a.author");
      const bot = author?.getAttribute("href")?.startsWith("/apps/") ||
        /\[bot\]/i.test(author?.textContent ?? "") ||
        !!row.querySelector('.timeline-comment-header img[alt*="[bot]"]');
      return bot ? "bots" : "people";
    }
    if (row.querySelector('[data-testid*="deploy"], .octicon-rocket') ||
        /deployed to|deployment (?:succeeded|failed)|was deployed/i.test(row.textContent))
      return "deployments";
    if (/approved these changes|requested changes|submitted a review/i.test(row.textContent))
      return "reviews";
    if (/force-pushed|pushed \d+ commits?/i.test(row.textContent))
      return "commits";
    if (/checks? (?:passed|failed|completed)/i.test(row.textContent))
      return "checks";
    return "activity";
  }

  function sameSelection(values) {
    return selected.size === values.length && values.every((value) => selected.has(value));
  }

  function persistFilters() {
    const snapshot = rememberFilters ? {
      selected: [...selected], unresolvedOnly, includeUnresolved,
    } : undefined;
    writes = writes.then(() => snapshot
      ? chrome.storage.local.set({ [filterStorageKey]: snapshot })
      : chrome.storage.local.remove(filterStorageKey))
      .catch((error) => console.warn("Could not save conversation filters", error));
  }

  function persistComments() {
    if (collapsedIds.size) collapsedByPr[path] = [...collapsedIds];
    else delete collapsedByPr[path];
    const snapshot = { ...collapsedByPr };
    writes = writes.then(() => chrome.storage.local.set({ [commentStorageKey]: snapshot }))
      .catch((error) => console.warn("Could not save collapsed comments", error));
  }

  function commentId(card) {
    return card.id || card.closest(".js-comment[id]")?.id ||
      card.closest("[data-gid]")?.getAttribute("data-gid");
  }

  function isUnresolvedThread(row) {
    return !!row.querySelector('review-thread-collapsible[data-resolved="false"]');
  }

  function setCommentCollapsed(card, header, collapsed) {
    card.toggleAttribute("data-gha-pr-comment-collapsed", collapsed);
    for (let node = header; node !== card; node = node.parentElement)
      for (const sibling of node.parentElement.children)
        if (sibling !== node) sibling.toggleAttribute("data-gha-pr-comment-hidden", collapsed);
    const button = header.querySelector(".gha-pr-comment-toggle");
    button?.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} comment`);
    button?.setAttribute("aria-expanded", String(!collapsed));
    const id = commentId(card);
    if (id) {
      if (collapsed) collapsedIds.add(id);
      else collapsedIds.delete(id);
    }
  }

  function syncAllCommentsButton() {
    const all = controls?.querySelector(".gha-pr-comment-toggle-all");
    if (!all) return;
    const buttons = [...document.querySelectorAll(".pull-discussion-timeline .gha-pr-comment-toggle")];
    const action = !buttons.length || buttons.some((button) => button.getAttribute("aria-expanded") === "true")
      ? "Collapse" : "Expand";
    all.disabled = !buttons.length;
    if (all.textContent !== `${action} all`) all.textContent = `${action} all`;
    all.setAttribute("aria-label", `${action} all comments`);
  }

  function enhanceComments() {
    for (const card of document.querySelectorAll(".pull-discussion-timeline .timeline-comment")) {
      const header = [...card.querySelectorAll(".timeline-comment-header")]
        .find((element) => element.closest(".timeline-comment") === card);
      if (!header) continue;
      if (collapsedIds.has(commentId(card))) setCommentCollapsed(card, header, true);
      if (!header.querySelector(".gha-pr-comment-toggle")) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "gha-pr-comment-toggle";
        button.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12.78 5.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.28a.75.75 0 0 1 1.06-1.06L8 8.94l3.72-3.72a.75.75 0 0 1 1.06 0Z"></path></svg>';
        const collapsed = card.hasAttribute("data-gha-pr-comment-collapsed");
        button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} comment`);
        button.setAttribute("aria-expanded", String(!collapsed));
        button.addEventListener("click", () => {
          const collapsed = !card.hasAttribute("data-gha-pr-comment-collapsed");
          setCommentCollapsed(card, header, collapsed);
          if (commentId(card)) persistComments();
          syncAllCommentsButton();
        });
        header.prepend(button);
      }
      if (card.hasAttribute("data-gha-pr-comment-collapsed"))
        setCommentCollapsed(card, header, true);
    }
  }

  function render() {
    if (!controls?.isConnected) return;
    const root = document.querySelector(".pull-discussion-timeline .js-discussion");
    if (!root) return;
    const description = root.querySelector(".js-comment-container");
    let shown = 0;
    let total = 0;
    const counts = new Map(["unresolved", ...categories].map((value) => [value, 0]));
    for (const row of timelineRows(root)) {
      const kind = category(row, description);
      const unresolved = !!kind && isUnresolvedThread(row);
      const visible = !!kind && (unresolvedOnly ? unresolved :
        selected.has(kind) && (includeUnresolved || !unresolved));
      row.toggleAttribute("data-gha-pr-hidden", !!kind && !visible);
      if (kind) {
        total++;
        counts.set(kind, counts.get(kind) + 1);
        if (unresolved) counts.set("unresolved", counts.get("unresolved") + 1);
        if (visible) shown++;
      }
    }
    const count = controls.querySelector(".gha-pr-filter-count");
    const message = `${shown} of ${total} loaded shown`;
    if (count.textContent !== message) count.textContent = message;
    for (const button of controls.querySelectorAll("[data-gha-pr-view]")) {
      if (button.dataset.ghaPrView === "unresolved") {
        button.setAttribute("aria-pressed", String(unresolvedOnly));
        continue;
      }
      const values = button.dataset.ghaPrView === "all" ? categories :
        button.dataset.ghaPrView === "comments" ? ["people", "bots"] :
        [button.dataset.ghaPrView];
      button.setAttribute("aria-pressed", String(!unresolvedOnly && includeUnresolved && sameSelection(values)));
    }
    for (const input of controls.querySelectorAll('input[data-gha-pr-category]'))
      input.checked = input.value === "unresolved" ? includeUnresolved : selected.has(input.value);
    controls.querySelector(".gha-pr-filter-remember input").checked = rememberFilters;
    controls.querySelector(".gha-pr-filter-menu").dataset.active =
      String(unresolvedOnly || !includeUnresolved || !sameSelection(categories));
    for (const badge of controls.querySelectorAll("[data-gha-pr-count]")) {
      const value = String(counts.get(badge.dataset.ghaPrCount));
      if (badge.textContent !== value) badge.textContent = value;
    }
    syncAllCommentsButton();
  }

  function makeControls() {
    const panel = document.createElement("section");
    panel.className = "gha-pr-filters";
    panel.setAttribute("aria-label", "Conversation filters");
    const heading = document.createElement("div");
    heading.className = "gha-pr-filter-heading";
    heading.textContent = "Conversation filters";
    const count = document.createElement("div");
    count.className = "gha-pr-filter-count";
    count.setAttribute("role", "status");
    const header = document.createElement("div");
    header.className = "gha-pr-filter-header";
    header.append(heading, count);
    const views = document.createElement("div");
    views.className = "gha-pr-filter-views";
    for (const [value, label] of [
      ["all", "All"], ["unresolved", "Unresolved"],
      ["people", "People"], ["bots", "Bots"], ["comments", "Comments only"],
    ]) {
      if (views.childNodes.length) {
        const separator = document.createElement("span");
        separator.className = "gha-pr-filter-separator";
        separator.setAttribute("aria-hidden", "true");
        separator.textContent = "·";
        views.append(" ", separator, " ");
      }
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.ghaPrView = value;
      button.textContent = label;
      button.addEventListener("click", () => {
        unresolvedOnly = value === "unresolved";
        includeUnresolved = true;
        selected = new Set(value === "all" ? categories :
          value === "unresolved" ? [] :
          value === "comments" ? ["people", "bots"] : [value]);
        render();
        if (rememberFilters) persistFilters();
      });
      views.append(button);
    }
    const filter = document.createElement("details");
    filter.className = "gha-pr-filter-menu";
    const trigger = document.createElement("summary");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("width", "16");
    icon.setAttribute("height", "16");
    icon.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.setAttribute("fill", "currentColor");
    shape.setAttribute("d", "M.75 3h14.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1 0-1.5ZM3 7.75A.75.75 0 0 1 3.75 7h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 7.75Zm3 4a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z");
    icon.append(shape);
    trigger.append(icon, "Filter activity");
    const options = document.createElement("div");
    options.className = "gha-pr-filter-options";
    const title = document.createElement("div");
    title.className = "gha-pr-filter-options-heading";
    title.textContent = "Show in timeline";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Show all";
    clear.addEventListener("click", () => {
      selected = new Set(categories);
      unresolvedOnly = false;
      includeUnresolved = true;
      render();
      if (rememberFilters) persistFilters();
    });
    title.append(clear);
    options.append(title);
    [["unresolved", "Unresolved review threads"],
      ...categories.map((value, index) => [value, labels[index]])].forEach(([value, text]) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = value;
      input.dataset.ghaPrCategory = "";
      input.checked = true;
      input.addEventListener("change", () => {
        if (value === "unresolved") {
          includeUnresolved = input.checked;
          if (unresolvedOnly && !includeUnresolved) {
            unresolvedOnly = false;
            selected = new Set(categories);
          }
        } else {
          if (unresolvedOnly) {
            unresolvedOnly = false;
            selected.clear();
          }
          if (input.checked) selected.add(value);
          else selected.delete(value);
        }
        render();
        if (rememberFilters) persistFilters();
      });
      const count = document.createElement("span");
      count.className = "gha-pr-filter-option-count";
      count.dataset.ghaPrCount = value;
      label.append(input, text, count);
      options.append(label);
    });
    const remember = document.createElement("label");
    remember.className = "gha-pr-filter-remember";
    const rememberInput = document.createElement("input");
    rememberInput.type = "checkbox";
    rememberInput.checked = rememberFilters;
    rememberInput.addEventListener("change", () => {
      rememberFilters = rememberInput.checked;
      persistFilters();
    });
    remember.append(rememberInput, "Remember filters");
    options.append(remember);
    filter.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      filter.open = false;
      trigger.focus();
      event.preventDefault();
    });
    filter.append(trigger, options);
    const allComments = document.createElement("button");
    allComments.type = "button";
    allComments.className = "gha-pr-comment-toggle-all";
    allComments.addEventListener("click", () => {
      const buttons = [...document.querySelectorAll(".pull-discussion-timeline .gha-pr-comment-toggle")];
      const collapse = buttons.some((button) => button.getAttribute("aria-expanded") === "true");
      for (const button of buttons) {
        const card = button.closest(".timeline-comment");
        if (card.hasAttribute("data-gha-pr-comment-collapsed") !== collapse)
          setCommentCollapsed(card, button.closest(".timeline-comment-header"), collapse);
      }
      if (buttons.length) persistComments();
      syncAllCommentsButton();
    });
    panel.append(header, views, filter, allComments);
    return panel;
  }

  function update() {
    if (!loaded) return;
    const nextPath = conversationPath();
    if (!nextPath && !path) return;
    if (path !== nextPath) {
      resetFixedPosition();
      watchStickyHeader(undefined);
      for (const button of document.querySelectorAll(".gha-pr-comment-toggle")) button.remove();
      for (const element of document.querySelectorAll(
        "[data-gha-pr-comment-collapsed], [data-gha-pr-comment-hidden]"
      )) {
        element.removeAttribute("data-gha-pr-comment-collapsed");
        element.removeAttribute("data-gha-pr-comment-hidden");
      }
      path = nextPath;
      collapsedIds = new Set(collapsedByPr[path] ?? []);
      if (!rememberFilters) {
        selected = new Set(categories);
        unresolvedOnly = false;
        includeUnresolved = true;
      }
      controls?.remove();
      controls = undefined;
      document.querySelectorAll("[data-gha-pr-hidden]").forEach((row) =>
        row.removeAttribute("data-gha-pr-hidden"));
    }
    for (const stale of document.querySelectorAll(".gha-pr-filters"))
      if (stale !== controls) stale.remove();
    if (!path) return;
    watchStickyHeader(document.querySelector(
      'header[data-component="SplitPageLayout.Header"] [data-component="PageHeader"][class*="stickyHeader"]'
    ));
    syncStickyActions();
    enhanceComments();
    const reviewers = findReviewers();
    if (!reviewers || !document.querySelector(".pull-discussion-timeline .js-discussion"))
      return;
    if (!controls) controls = makeControls();
    if (controls.nextElementSibling !== reviewers) {
      resetFixedPosition();
      reviewers.before(controls);
    }
    render();
    syncFixedPosition();
  }

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      update();
    });
  }

  document.addEventListener("click", (event) => {
    const menu = controls?.querySelector(".gha-pr-filter-menu");
    if (menu && !menu.contains(event.target)) menu.open = false;
  });
  new MutationObserver(() => {
    if (path || conversationPath()) scheduleUpdate();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-resolved"],
  });
  document.addEventListener("turbo:load", scheduleUpdate);
  window.addEventListener("popstate", scheduleUpdate);
  window.addEventListener("scroll", syncFixedPosition, { passive: true });
  window.addEventListener("resize", () => {
    syncFixedPosition();
    syncStickyActions();
  });
  chrome.storage.local.get([filterStorageKey, commentStorageKey])
    .then((stored) => {
      const filters = stored[filterStorageKey];
      if (filters && Array.isArray(filters.selected)) {
        rememberFilters = true;
        selected = new Set(filters.selected.filter((value) => categories.includes(value)));
        unresolvedOnly = filters.unresolvedOnly === true;
        includeUnresolved = filters.includeUnresolved !== false;
      }
      const comments = stored[commentStorageKey];
      if (comments && typeof comments === "object" && !Array.isArray(comments))
        collapsedByPr = comments;
    })
    .catch((error) => console.warn("Could not load conversation view", error))
    .finally(() => {
      loaded = true;
      update();
    });
})();
