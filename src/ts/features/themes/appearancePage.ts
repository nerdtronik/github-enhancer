/**
 * Appearance page glue: detects the page and decides when the Custom themes section must be mounted
 * again.
 */
import { GITHUB_RADIO, mountThemesSection, SECTION, type ActiveIds, type SectionHandlers } from "./themesSection";
import type { Theme } from "./theme";

export interface AppearancePageDeps {
  getThemes: () => readonly Theme[];
  getActive: () => ActiveIds;
  handlers: SectionHandlers;
}

export const APPEARANCE_PATH = "/settings/appearance";

// Exact path only: sub-pages of /settings are not the Appearance page.
export const isAppearancePage = () =>
  location.pathname === APPEARANCE_PATH || location.pathname === `${APPEARANCE_PATH}/`;

const has = (node: Node, selector: string) =>
  node instanceof Element && (node.matches(selector) || !!node.querySelector(selector));

const lostSection = (node: Node) => !node.isConnected && has(node, SECTION);

// Remount when GitHub (re)renders its theme radios, since our section is anchored to them, or when
// our section was removed rather than moved.
export const shouldRemount = (records: MutationRecord[]) =>
  records.some(
    (record) =>
      [...record.addedNodes].some((node) => has(node, GITHUB_RADIO)) || [...record.removedNodes].some(lostSection),
  );

export function startAndMount(scheduler: { start(): void; schedule(): void }): void {
  scheduler.start();
  scheduler.schedule();
}

export function createAppearanceMount({ getThemes, getActive, handlers }: AppearancePageDeps) {
  return {
    mount() {
      mountThemesSection(document, getThemes(), getActive(), handlers);
    },
  };
}
