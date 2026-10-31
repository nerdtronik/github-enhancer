/** Pure helpers for the "Needs attention" panel: ordering, labels and relative age. */

export const ATTENTION_VISIBLE = 5;

// Failures first, then runs that need a human decision, then slow ones; ties are newest first.
const RANK: Record<string, number> = {
  Failed: 0,
  "Timed out": 0,
  "Action required": 1,
  "Waiting for approval": 2,
  "Slower than usual": 3,
};

export function sortAttention<T extends { status: string; createdAt: number }>(runs: T[]): T[] {
  const rank = (status: string) => RANK[status] ?? Object.keys(RANK).length;
  return [...runs].sort(
    (a, b) => rank(a.status) - rank(b.status) || b.createdAt - a.createdAt,
  );
}

/** "ci.yml" and ".github/workflows/deploy-prod.yaml" become "ci" and "deploy-prod". */
export function workflowName(path: string): string {
  return (path.split("/").pop() ?? "").replace(/\.ya?ml$/i, "");
}

/** "just now", "5m ago", "3h ago", "2d ago"; empty when the time is unknown or in the future. */
export function formatAge(createdAt: number, now: number): string {
  if (!createdAt || createdAt > now) return "";
  const seconds = Math.floor((now - createdAt) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Keeps only the newest run of each workflow file, so a failure that a later run replaced is not
 * listed. `all` is every run of the current list; runs without a known workflow file are kept.
 * Newest means the highest createdAt, and the first in list order when times are unknown or tie.
 */
export function latestPerWorkflow<T extends { id: string; workflowPath: string; createdAt: number }>(
  all: T[],
  attention: T[],
): T[] {
  const newest = new Map<string, T>();
  for (const run of all) {
    const current = newest.get(run.workflowPath);
    if (!current || run.createdAt > current.createdAt) newest.set(run.workflowPath, run);
  }
  return attention.filter((run) => !run.workflowPath || newest.get(run.workflowPath)?.id === run.id);
}

export const DISMISSED_LIMIT = 200;

/** Reads the stored dismissed ids, ignoring anything that is not a list of non-empty strings. */
export function parseDismissed(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((id): id is string => typeof id === "string" && id !== ""));
}

/** The ids to store: insertion order is kept and only the newest DISMISSED_LIMIT survive. */
export function dismissedToStore(ids: Set<string>): string[] {
  return [...ids].slice(-DISMISSED_LIMIT);
}
