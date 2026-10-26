if (typeof browser === "undefined" && typeof chrome !== "undefined") {
  // @ts-ignore
  declare const browser: typeof chrome;
}

const JOBS_VIEW_MIN_HEIGHT = 250;
const JOBS_VIEW_DEFAULT_HEIGHT = 450;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_DEFAULT_WIDTH = 400;
const SIDEBAR_MAX_WIDTH = 800;
const SIDEBAR_MIN_CONTENT_WIDTH = 360;

/////////////
export const DEFAULTS = {
  JOBS_VIEW_MIN_HEIGHT,
  JOBS_VIEW_DEFAULT_HEIGHT,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_CONTENT_WIDTH,
};
