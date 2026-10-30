/** Floating "go to top" button, shown once the page is scrolled past one viewport. */
import { createPageScheduler } from "../../core/scheduler";
import { createIcon, shared } from "../../core/settings";

class GoToTop {
  private readonly button = this.createButton();
  private readonly scheduler = createPageScheduler({
    update: () => this.update(),
    // idle: the scheduler waits for load plus an idle callback before the first update.
    idle: true,
    events: ["scroll", "resize", "popstate", "pageshow", "turbo:load"],
  });

  init(): void {
    this.button.append(createIcon("go_to_top"));
    this.scheduler.start();
  }

  private createButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gha-go-to-top";
    button.setAttribute("aria-label", "Go to top");
    button.hidden = true;
    button.addEventListener("click", () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    });
    return button;
  }

  private update(): void {
    const { button } = this;
    if (!button.isConnected) document.body?.append(button);
    const scrollTop = document.scrollingElement?.scrollTop ?? window.scrollY;
    // Threshold is one viewport height: below that the top of the page is still on screen.
    const shouldHide = scrollTop <= window.innerHeight;
    if (button.hidden !== shouldHide) button.hidden = shouldHide;
  }
}

shared("goToTop", () => {
  const goToTop = new GoToTop();
  goToTop.init();
  return goToTop;
});
