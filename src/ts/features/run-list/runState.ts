/**
 * Maps a run to a display label. The row's native status text (aria-label) is checked first; the
 * embedded run data (WORKFLOW_RUN_* values) is the fallback when that text is not recognised.
 * `attention` is non-empty only for runs that need a person to look at them.
 */
export function runState(
  nativeStatus: string,
  data: any,
): { label: string; active: boolean; attention: string } {
  const nativeKnown =
    /^(?:currently running|in progress|completed successfully|failed|failure|timed out|requires action|cancelled|canceled|queued|waiting|pending|requested|skipped):?/i.test(
      nativeStatus ?? "",
    );
  let label = "";
  if (nativeKnown) {
    if (/^(?:currently running|in progress)/i.test(nativeStatus))
      label = "Running";
    else if (/^completed successfully/i.test(nativeStatus)) label = "Completed";
    else if (/^(?:failed|failure)/i.test(nativeStatus)) label = "Failed";
    else if (/^timed out/i.test(nativeStatus)) label = "Timed out";
    else if (/^requires action/i.test(nativeStatus)) label = "Action required";
    else if (/^(?:cancelled|canceled)/i.test(nativeStatus)) label = "Cancelled";
    else if (/^skipped/i.test(nativeStatus)) label = "Skipped";
    // "waiting" is the only native status mapped to the approval label; the data fallback below
    // does the same for WORKFLOW_RUN_STATUS_WAITING.
    else if (/^waiting/i.test(nativeStatus)) label = "Waiting for approval";
    else label = "Queued";
  } else {
    const conclusion = data?.state?.conclusion ?? "";
    const status = data?.state?.status ?? "";
    if (conclusion === "WORKFLOW_RUN_CONCLUSION_SUCCESS") label = "Completed";
    else if (conclusion === "WORKFLOW_RUN_CONCLUSION_FAILURE") label = "Failed";
    else if (conclusion === "WORKFLOW_RUN_CONCLUSION_TIMED_OUT")
      label = "Timed out";
    else if (conclusion === "WORKFLOW_RUN_CONCLUSION_ACTION_REQUIRED")
      label = "Action required";
    else if (conclusion === "WORKFLOW_RUN_CONCLUSION_CANCELLED")
      label = "Cancelled";
    else if (conclusion === "WORKFLOW_RUN_CONCLUSION_SKIPPED")
      label = "Skipped";
    else if (conclusion === "WORKFLOW_RUN_CONCLUSION_NEUTRAL")
      label = "Completed";
    else if (status === "WORKFLOW_RUN_STATUS_IN_PROGRESS") label = "Running";
    else if (status === "WORKFLOW_RUN_STATUS_WAITING")
      label = "Waiting for approval";
    else if (/WORKFLOW_RUN_STATUS_(?:QUEUED|PENDING|REQUESTED)/.test(status))
      label = "Queued";
  }
  return {
    label,
    active: label === "Running",
    attention: ["Failed", "Timed out", "Action required"].includes(label)
      ? label
      : "",
  };
}

/** Maps a label from runState to the tone name used by the run-list pill CSS. */
export function statusTone(label: string): string {
  if (label === "Completed") return "success";
  if (label === "Failed" || label === "Timed out") return "danger";
  if (label === "Action required") return "severe";
  if (label === "Running") return "accent";
  if (label === "Waiting for approval") return "attention";
  return "neutral";
}

/** Parses GitHub timing text such as "1h 2m 3s"; returns null for anything else. */
export function durationSeconds(value: string | null): number | null {
  if (typeof value !== "string") return null;
  const matches = [...value.matchAll(/(\d+)\s*([dhms])/g)];
  if (!matches.length || value.replace(/(\d+)\s*([dhms])/g, "").trim())
    return null;
  const units = { d: 86400, h: 3600, m: 60, s: 1 };
  return matches.reduce(
    (sum, match) => sum + Number(match[1]) * units[match[2]],
    0,
  );
}

/** Formats seconds as "1h 2m", "5m" or "30s"; seconds are dropped from one minute up. */
export function formatDuration(seconds: number): string {
  if (seconds >= 3600)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${seconds}s`;
}

/** Median of exactly five samples: index 2 of the sorted list is the middle. */
export function median(samples: number[]): number {
  return [...samples].sort((a, b) => a - b)[2];
}
