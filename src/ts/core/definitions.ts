/**
 * Shared types and tiny helpers with no dependencies on the rest of core.
 * Seam: the Preferences shape that settings.ts stores and validates.
 */
"use strict";

/**
 * Parses trusted, extension-packaged SVG text and returns its root element. The result is copied into
 * the page as is, so never pass page or user content.
 */
export function parseSVG(svgText: string): HTMLElement {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  return doc.documentElement; // The <svg> element
}

// Theme ids are stored and arrive in imported JSON (untrusted), so they are restricted to a lowercase slug.
export const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Flat `<area>_<name>` keys, one level deep. Flat keys map 1:1 onto chrome.storage.local keys,
 * so a single storage.onChanged entry is one setting change with no merge or diff of nested
 * objects, and the area prefix groups settings by feature. Add new keys here, in PREFERENCES
 * and in VALID (settings.ts).
 */
export interface Preferences {
  actionRun_enhancedViewEnabled: boolean;
  actionRun_jobsViewHeight: number | null;
  actionRun_hoverFocusEnabled: boolean;
  actionRun_collapsibleSectionsEnabled: boolean;
  actionRun_statusGroupingEnabled: boolean;
  actionRun_searchPosition: "left" | "right";
  actionRun_arrowPlacement: "left" | "right" | "both";
  runList_enabled: boolean;
  runList_enhancedViewEnabled: boolean;
  runList_attentionCollapsed: boolean;
  runList_attentionLatestOnly: boolean;
  appearance_lightTheme: string | null;
  appearance_darkTheme: string | null;
}
