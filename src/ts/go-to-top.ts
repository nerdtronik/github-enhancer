/**
 * @module go-to-top
 * @description "Go to top" button that hides near the top of the page
 */

"use strict";

// @ts-ignore
import { loadSVG, randomString } from "./definitions";
let STATE = globalThis.EXTENSION_STATE as { [key: string | symbol]: any };

STATE.goToTop_active = false;
let scheduled = false;
STATE.goToTop_button = null as HTMLButtonElement | null;
STATE.goToTop_id = `gha-go-to-top-button-${randomString()}`;

function update(): void {
  if (!STATE.goToTop_button) return;
  scheduled = false;
  if (!document.getElementById(STATE.goToTop_id))
    document.body?.append(STATE.goToTop_button);
  const scrollTop = document.scrollingElement?.scrollTop ?? window.scrollY;
  const shouldHide = scrollTop <= window.innerHeight;
  if (STATE.goToTop_button.hidden !== shouldHide)
    STATE.goToTop_button.hidden = shouldHide;
}

function scheduleUpdate(): void {
  if (!STATE.goToTop_active || scheduled) return;
  scheduled = true;
  requestAnimationFrame(update);
}

function activate(): void {
  STATE.goToTop_active = true;
  update();
}

async function goToTop(): Promise<void> {
  STATE.goToTop_button = document.createElement("button");
  STATE.goToTop_button.type = "button";
  STATE.goToTop_button.id = STATE.goToTop_id;
  STATE.goToTop_button.className = "gha-go-to-top";
  STATE.goToTop_button.setAttribute("aria-label", "Go to top");
  STATE.goToTop_button.hidden = true;
  let svg = await loadSVG(browser.runtime.getURL("assets/icons/go_to_top.svg"));
  STATE.goToTop_button.appendChild(svg);
  STATE.goToTop_button.addEventListener("click", () => {
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
