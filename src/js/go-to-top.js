(() => {
  "use strict";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "gha-go-to-top";
  button.setAttribute("aria-label", "Go to top");
  button.hidden = true;
  button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M3.47 7.78a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0l4.25 4.25a.75.75 0 01-1.06 1.06L9 4.81v7.44a.75.75 0 01-1.5 0V4.81L4.53 7.78a.75.75 0 01-1.06 0z"/></svg>';
  button.addEventListener("click", () => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    window.scrollTo({ top: 0, behavior });
  });

  let active = false;
  let scheduled = false;
  function update() {
    scheduled = false;
    if (!button.isConnected) document.body?.append(button);
    const scrollTop = document.scrollingElement?.scrollTop ?? window.scrollY;
    const shouldHide = scrollTop <= window.innerHeight;
    if (button.hidden !== shouldHide) button.hidden = shouldHide;
  }

  function scheduleUpdate() {
    if (!active || scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }

  function activate() {
    active = true;
    update();
  }

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("popstate", scheduleUpdate);
  window.addEventListener("pageshow", scheduleUpdate);
  document.addEventListener("turbo:load", scheduleUpdate);
  const scheduleInitialUpdate = () => {
    if (window.requestIdleCallback) window.requestIdleCallback(activate, { timeout: 2000 });
    else setTimeout(activate, 0);
  };
  if (document.readyState === "complete") scheduleInitialUpdate();
  else window.addEventListener("load", scheduleInitialUpdate, { once: true });
})();
