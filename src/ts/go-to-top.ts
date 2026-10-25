/**
 * @module go-to-top
 * @description "Go to top" button that hides near the top of the page
 */

"use strict";

// @ts-ignore
import  "./definitions";
// @ts-ignore
import { loadSVG } from "./definitions";

(function () {
  let active = false;
  let scheduled = false;
  let button: HTMLButtonElement | null = null;

  function update(): void {
    if (!button) return;
    scheduled = false;
    document.body?.append(button);
    const scrollTop = document.scrollingElement?.scrollTop ?? window.scrollY;
    const shouldHide = scrollTop <= window.innerHeight;
    if (button.hidden !== shouldHide) button.hidden = shouldHide;
  }

  function scheduleUpdate(): void {
    if (!active || scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }

  function activate(): void {
    active = true;
    update();
  }

  async function goToTop(): Promise<void> {
    button = document.createElement("button");
    button.type = "button";
    button.className = "gha-go-to-top";
    button.setAttribute("aria-label", "Go to top");
    button.hidden = true;
    let svg = await loadSVG(
      browser.runtime.getURL("assets/extension/go_to_top.svg"),
    );
    button.appendChild(svg);
    button.addEventListener("click", () => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches
        ? "auto"
        : "smooth";
      window.scrollTo({ top: 0, behavior });
    });

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("popstate", scheduleUpdate);
    window.addEventListener("pageshow", scheduleUpdate);
    document.addEventListener("turbo:load", scheduleUpdate);
    const scheduleInitialUpdate = () => {
      if (window.requestIdleCallback)
        window.requestIdleCallback(() => activate(), { timeout: 2000 });
      else setTimeout(() => activate(), 0);
    };
    if (document.readyState === "complete") scheduleInitialUpdate();
    else window.addEventListener("load", scheduleInitialUpdate, { once: true });
  }

  goToTop();
})();
