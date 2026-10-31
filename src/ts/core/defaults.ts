/**
 * Shared constants (size bounds, storage keys, telemetry URLs) and the default Preferences.
 * Seam: DEFAULTS and PREFERENCES; nothing here touches the DOM or storage.
 */
import type { Preferences } from "./definitions";

const JOBS_VIEW_MIN_HEIGHT = 250;
const JOBS_VIEW_DEFAULT_HEIGHT = 450;
// Sidebar bounds used by sidebar-resize (actions, run and PR files sidebars); the min content width
// keeps the main column usable when a sidebar is dragged wide.
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_DEFAULT_WIDTH = 400;
const SIDEBAR_MAX_WIDTH = 800;
const SIDEBAR_MIN_CONTENT_WIDTH = 360;
// GitHub's own beacon endpoints; collector-suppress blocks exactly these (exact match, no prefix).
const TELEMETRY_URLS = new Set([
  "https://collector.github.com/github/collect",
  "https://api.github.com/_private/browser/stats",
]);

// Never change these values: they are the keys of data already saved in users' browsers, and a
// rename silently orphans it. Keys ending in ":" are prefixes that Store.key() completes with an
// id (usually owner/repo). The V1/V2 suffix is a schema version; bump it only with a migration.
const STORAGE_KEYS = {
  prFilters: "ghaPrConversationFiltersV1",
  prComments: "ghaPrCollapsedCommentsV1",
  categories: "ghaWorkflowCategoriesV2:",
  legacyCategories: "ghaWorkflowCategoriesV1:",
  sidebarWidth: "ghaSidebarWidthV1:",
  workflowIndex: "ghaWorkflowIndexV1:",
  runHistory: "ghaRunAttentionHistoryV1:",
  attentionDismissed: "ghaRunAttentionDismissedV1:",
  themes: "ghaThemesV1",
} as const;

// Relative to the extension root; icons are served through web_accessible_resources.
const ICONS_PATH = "dist/icons";

export const DEFAULTS = {
  JOBS_VIEW_MIN_HEIGHT,
  JOBS_VIEW_DEFAULT_HEIGHT,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_CONTENT_WIDTH,
  TELEMETRY_URLS,
  ICONS_PATH,
  STORAGE_KEYS,
};

/**
 * Used until storage has loaded and for any key that is missing or fails validation. null means
 * "not chosen yet" (auto height, GitHub's own theme).
 */
export const PREFERENCES: Preferences = {
  actionRun_enhancedViewEnabled: true,
  actionRun_jobsViewHeight: null,
  actionRun_hoverFocusEnabled: true,
  actionRun_collapsibleSectionsEnabled: true,
  actionRun_statusGroupingEnabled: false,
  actionRun_searchPosition: "right",
  actionRun_arrowPlacement: "left",
  runList_enabled: true,
  runList_enhancedViewEnabled: true,
  runList_attentionCollapsed: false,
  runList_attentionLatestOnly: true,
  appearance_lightTheme: null,
  appearance_darkTheme: null,
};
