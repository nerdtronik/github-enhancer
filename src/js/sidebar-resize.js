(() => {
  "use strict";

  const MIN_WIDTH = 240;
  const MAX_WIDTH = 800;
  const MIN_CONTENT_WIDTH = 360;
  const widths = new Map();
  let current;
  let scheduled = false;
  let writes = Promise.resolve();
  let invalidated = false;

  const pageType = () => {
    const path = location.pathname.replace(/^\/[^/]+\/[^/]+\//, "");
    if (/^actions\/runs\/[^/]+(?:\/|$)/.test(path)) return "actions-run";
    if (/^actions(?:\/|$)/.test(path)) return "actions";
    if (/^pull\/\d+\/(?:files|changes)(?:\/|$)/.test(path)) return "pull-files";
    return null;
  };

  const findSidebar = (type) => {
    if (type === "actions") {
      const target = document.querySelector(
        'aside[aria-label="Actions"][data-expanded="true"]:has(nav[aria-label="Actions workflows"])',
      );
      return target && { target, pane: target };
    }
    const selector =
      type === "actions-run"
        ? 'split-page-layout:has(react-partial[partial-name="actions-run-jobs-list"])'
        : "split-page-layout";
    const target = document.querySelector(selector);
    const pane = target?.querySelector(".PageLayout-pane");
    return pane && { target, pane };
  };

  const maxWidth = () =>
    Math.max(
      MIN_WIDTH,
      Math.min(MAX_WIDTH, window.innerWidth - MIN_CONTENT_WIDTH),
    );
  const clamp = (width) =>
    Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(width)));
  const storageKey = (type) => `ghaSidebarWidthV1:${type}`;

  function position(binding, rect = binding.pane.getBoundingClientRect()) {
    binding.rect = rect;
    const top = binding.type === "actions" ? Math.max(0, rect.top) : 0;
    const bottom =
      binding.type === "actions"
        ? Math.min(window.innerHeight, rect.bottom)
        : 0;
    binding.handle.hidden =
      rect.width === 0 || (binding.type === "actions" && bottom <= top);
    if (!binding.handle.hidden)
      binding.handle.style.left = `${rect.right - 5}px`;
    if (binding.type === "actions") {
      binding.handle.style.top = `${top}px`;
      binding.handle.style.height = `${Math.max(0, bottom - top)}px`;
    }
    binding.handle.setAttribute("aria-valuemax", String(maxWidth()));
    binding.handle.setAttribute(
      "aria-valuenow",
      String(Math.round(rect.width)),
    );
  }

  function applyWidth(binding, width) {
    binding.width = clamp(width);
    binding.target.style.setProperty(
      "--gha-sidebar-width",
      `${binding.width}px`,
    );
    binding.target.setAttribute("data-gha-sidebar-sized", "");
    const rect = binding.rect;
    if (rect)
      position(binding, {
        left: rect.left,
        right: rect.left + binding.width,
        width: binding.width,
        top: rect.top,
        bottom: rect.bottom,
      });
  }

  function save(binding) {
    widths.set(binding.type, binding.width);
    const key = storageKey(binding.type);
    const width = binding.width;
    writes = writes
      .then(() => chrome.storage.local.set({ [key]: width }))
      .catch((error) => storageFailure("save", error));
  }

  function storageFailure(action, error) {
    if (error?.message?.includes("Extension context invalidated")) {
      invalidated = true;
      detach();
      return;
    }
    console.warn(`Could not ${action} sidebar width`, error);
  }

  function detach() {
    if (!current) return;
    current.target.style.removeProperty("--gha-sidebar-width");
    current.target.removeAttribute("data-gha-sidebar-sized");
    current.handle.remove();
    current.observer.disconnect();
    window.removeEventListener("resize", current.resize);
    window.removeEventListener("scroll", current.position);
    document.documentElement.classList.remove("gha-sidebar-resizing");
    current = undefined;
  }

  function attach(type, target, pane) {
    const handle = document.createElement("div");
    handle.className = "gha-sidebar-resize-handle";
    if (type === "actions") handle.classList.add("gha-sidebar-resize-line");
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", "Resize left sidebar");
    handle.setAttribute("aria-valuemin", String(MIN_WIDTH));
    handle.tabIndex = 0;
    handle.hidden = true;
    document.body.append(handle);
    const binding = { type, target, pane, handle };
    binding.position = () => position(binding);
    binding.resize = () => {
      const width = widths.get(type) ?? binding.width;
      if (width === undefined) position(binding);
      else {
        applyWidth(binding, width);
        position(binding);
      }
    };
    binding.observer = new ResizeObserver(binding.position);
    binding.observer.observe(pane);
    window.addEventListener("resize", binding.resize);
    window.addEventListener("scroll", binding.position, { passive: true });
    current = binding;

    let drag;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const rect = pane.getBoundingClientRect();
      position(binding, rect);
      drag = {
        id: event.pointerId,
        x: event.clientX,
        width: rect.width,
      };
      handle.setPointerCapture?.(event.pointerId);
      document.documentElement.classList.add("gha-sidebar-resizing");
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      applyWidth(binding, drag.width + event.clientX - drag.x);
    });
    const finish = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = undefined;
      document.documentElement.classList.remove("gha-sidebar-resizing");
      if (binding.width !== undefined) save(binding);
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      position(binding);
      const width = binding.width ?? binding.rect.width;
      applyWidth(binding, width + (event.key === "ArrowRight" ? 20 : -20));
      save(binding);
      event.preventDefault();
    });

    const cached = widths.get(type);
    if (cached !== undefined) applyWidth(binding, cached);
    else
      Promise.resolve()
        .then(() => chrome.storage.local.get(storageKey(type)))
        .then((stored) => {
          const width = stored[storageKey(type)];
          if (
            !Number.isSafeInteger(width) ||
            width < MIN_WIDTH ||
            width > MAX_WIDTH
          )
            return;
          if (widths.has(type)) return;
          widths.set(type, width);
          if (current === binding && binding.width === undefined)
            applyWidth(binding, width);
        })
        .catch((error) => storageFailure("load", error));
  }

  function update() {
    if (invalidated) return;
    const type = window.innerWidth >= 800 && pageType();
    const sidebar = type && findSidebar(type);
    if (
      current &&
      (current.type !== type ||
        current.target !== sidebar?.target ||
        current.pane !== sidebar?.pane ||
        !current.handle.isConnected)
    )
      detach();
    for (const handle of document.querySelectorAll(
      ".gha-sidebar-resize-handle",
    ))
      if (handle !== current?.handle) handle.remove();
    if (sidebar && !current) attach(type, sidebar.target, sidebar.pane);
  }

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      update();
    });
  }

  new MutationObserver(() => {
    if (current || pageType()) scheduleUpdate();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-expanded"],
  });
  document.addEventListener("turbo:load", scheduleUpdate);
  window.addEventListener("popstate", scheduleUpdate);
  window.addEventListener("resize", scheduleUpdate);
  update();
})();
