/**
 * Classifies GitHub URL paths. Classification is purely positional (/owner/repo/section/...), so
 * it never needs the DOM and works on any pathname, including the destination of a navigation.
 */
export type RouteKind = "actions" | "actionRun" | "pull" | "pullFiles" | "other";

/**
 * `rest` is the unclassified remainder after the part that identified the kind (for a run it
 * follows /runs/<id>[/attempts/<n>], e.g. "/job/123"); "" when the path ends at that point.
 */
export type Route = {
  kind: RouteKind;
  rest: string;
  owner?: string;
  repo?: string;
  runId?: string;
  number?: string;
};

const isNumber = (value: string | undefined): value is string =>
  value !== undefined && /^\d+$/.test(value);

const tail = (segments: string[], from: number) =>
  segments.length > from ? `/${segments.slice(from).join("/")}` : "";

// segments: ["", owner, repo, "actions", "runs", <id>, ["attempts", <n>], ...rest].
function actionsRoute(base: Route, segments: string[]): Route {
  if (segments[4] !== "runs" || !isNumber(segments[5]))
    return { ...base, kind: "actions", rest: tail(segments, 4) };
  const attempt = segments[6] === "attempts" && isNumber(segments[7]);
  return {
    ...base,
    kind: "actionRun",
    runId: segments[5],
    rest: tail(segments, attempt ? 8 : 6),
  };
}

// A non-numeric segment (e.g. /pull/new) is not a pull request, so the base route is kept.
// "changes" is the newer name of the "files" tab.
function pullRoute(base: Route, segments: string[]): Route {
  const number = segments[4];
  if (!isNumber(number)) return base;
  if (segments[5] === "files" || segments[5] === "changes")
    return { ...base, kind: "pullFiles", number, rest: tail(segments, 6) };
  return { ...base, kind: "pull", number, rest: tail(segments, 5) };
}

/**
 * Classifies a pathname; anything that is not /owner/repo/... is "other". A trailing slash is
 * ignored.
 */
export function route(pathname: string = location.pathname): Route {
  const segments = pathname.replace(/\/$/, "").split("/");
  // `lead` is "" for a path with a leading slash; anything else is not a GitHub path.
  const [lead, owner, repo, section] = segments;
  if (lead !== "" || !owner || !repo) return { kind: "other", rest: "" };
  const base: Route = { kind: "other", rest: "", owner, repo };
  if (section === "actions") return actionsRoute(base, segments);
  if (section === "pull") return pullRoute(base, segments);
  return base;
}

/**
 * Groups exist because manifest content_scripts match patterns are only evaluated on full page
 * loads. GitHub navigates with Turbo (no reload), so a bundle matching /actions/* is not injected
 * when the user arrives from a PR page. A group is the set of kinds served by the same bundles.
 */
export type RouteGroup = "actions" | "pull";

/** The group serving `pathname`, or null for a page no bundle group covers. */
export function routeGroup(pathname: string = location.pathname): RouteGroup | null {
  const { kind } = route(pathname);
  if (kind === "actions" || kind === "actionRun") return "actions";
  if (kind === "pull" || kind === "pullFiles") return "pull";
  return null;
}

/**
 * True when navigating to `destination` from a page of group `loaded` needs a real page load so
 * the destination group's bundles get injected. Same group or an unsupported page: false.
 */
export function shouldFullLoad(destination: string, loaded: RouteGroup | null): boolean {
  const group = routeGroup(destination);
  return group !== null && group !== loaded;
}

/**
 * True only for the run summary itself; sub-pages (job logs, usage, workflow file) have a
 * non-empty rest.
 */
export function isRunPage(pathname?: string): boolean {
  const current = route(pathname);
  return current.kind === "actionRun" && current.rest === "";
}

/** "owner/repo" for Actions pages, "" for any other page. */
export function actionsRepository(current: Route): string {
  if (current.kind !== "actions" && current.kind !== "actionRun") return "";
  return `${current.owner}/${current.repo}`;
}

/**
 * Converts a workflow `path` into the URL segment used under /actions/workflows/. The input is
 * untrusted (it comes from GitHub's `_workflows` JSON and page data), so anything else returns "".
 */
export function workflowRoute(path: unknown): string {
  if (typeof path !== "string") return "";
  const prefix = path.startsWith(".github/workflows/")
    ? ".github/workflows/"
    : path.startsWith("dynamic/")
      ? "dynamic/"
      : "";
  return prefix
    ? path.slice(prefix.length).split("/").map(encodeURIComponent).join("/")
    : "";
}
