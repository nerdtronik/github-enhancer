/** Run-level page sections: workflow info placement, grouped job summaries, collapsible panels. */
import { state } from "./shared";

const { workflowInfos, expandedSections } = state;

/** Moves a workflow info element from the graph to the run summary area. */
export function moveWorkflowInfo(graph: HTMLElement, canvas: HTMLElement): void {
  const summary = document.querySelector(".actions-workflow-stats > .d-flex")!;
  const previous = workflowInfos.get(graph);
  const visualGraph = graph.querySelector(
    '[data-target="action-graph.visualGraph"]',
  )!;
  const header: HTMLElement | null = Array.from(canvas.children).find(
    (element) =>
      !element?.contains(visualGraph) && element?.querySelector("h2"),
  ) as HTMLElement | null;
  const info: HTMLElement | null = (header ?? previous) as HTMLElement | null;
  if (!summary || !info) return;
  if (previous && previous !== info) previous.remove();
  workflowInfos.set(graph, info);
  info.classList.add("gha-run-workflow-info");
  if (info.parentElement !== summary) summary.append(info);
}

/** Groups job summaries into a single collapsible section. */
export function groupSummaries() {
  const summaries = Array.from(
    document.querySelectorAll("job-summary.actions-job-summary"),
  );
  if (!summaries.length) return;
  for (const summary of summaries) {
    // Remove individual disclosures restored from an older Turbo snapshot.
    if (!summary.classList.contains("gha-run-section")) continue;
    for (const button of summary.querySelectorAll(".gha-run-section-toggle"))
      button.replaceWith(...button.childNodes);
    summary.classList.remove("gha-run-section");
    summary.removeAttribute("data-gha-collapsed");
    for (const element of summary.querySelectorAll(
      ".gha-run-section-header, .gha-run-section-heading",
    ))
      element.classList.remove(
        "gha-run-section-header",
        "gha-run-section-heading",
      );
  }
  // Find the closest common ancestor of all summaries, then the child of it holding each summary
  // (`branches`), so they can be gathered under one container without breaking GitHub's markup.
  let host: HTMLElement | null = summaries[0].parentElement;
  while (
    !summaries.every((summary) => {
      const h = host;
      return !!h && h.contains(summary);
    })
  )
    host = (host as HTMLElement)?.parentElement ?? null;
  const branches = Array.from(
    new Set(
      summaries.map((summary) => {
        let branch = summary;
        while (branch.parentElement !== host)
          branch = (branch as HTMLElement).parentElement!;
        return branch;
      }),
    ),
  );
  // If the common host also holds unrelated content, it cannot be the section itself. Reuse our
  // own previous container (not a GitHub-updatable one) or create one, and move the summaries in.
  let group: HTMLElement | null = host;
  if (
    host &&
    !host.matches(".gha-run-summaries") &&
    Array.from(host.children).some(
      (child) =>
        !branches.includes(child as HTMLElement) &&
        !(child as HTMLElement).matches(".gha-run-section-header"),
    )
  ) {
    group = branches.find((branch) =>
      branch.matches(
        ".gha-run-summaries:not([data-url]):not(.js-updatable-content)",
      ),
    ) as HTMLElement | null;
    const contents = branches.flatMap((branch) =>
      branch === (group as HTMLElement)
        ? Array.from(group!.children).filter(
            (child) =>
              !(child as HTMLElement).matches(".gha-run-section-header"),
          )
        : [branch],
    );
    if (!group) {
      group = document.createElement("div");
      host?.insertBefore(group, branches[0]);
    }
    let next: ChildNode | null =
      (group as HTMLElement).querySelector(":scope > .gha-run-section-header")
        ?.nextElementSibling ?? (group as HTMLElement).firstElementChild;
    for (const branch of contents) {
      if ((branch as HTMLElement) !== next && group)
        group.insertBefore(branch as HTMLElement, next as ChildNode);
      next = (branch as HTMLElement).nextElementSibling;
    }
  }
  // Remove section markup from other branches, left over from an earlier grouping or a snapshot.
  for (const branch of branches) {
    if (
      branch === group ||
      !(branch as HTMLElement).matches(".gha-run-summaries")
    )
      continue;
    (
      branch.querySelector(":scope > .gha-run-section-header") ?? null
    )?.remove();
    branch.classList.remove("gha-run-summaries", "gha-run-section");
    branch.removeAttribute("data-gha-collapsed");
  }

  group?.classList.add(
    "gha-run-summaries",
    "actions-fullwidth-module",
    "color-bg-default",
    "color-shadow-small",
    "border",
    "rounded",
  );
  if (
    !(group as HTMLElement).querySelector(":scope > .gha-run-section-header")
  ) {
    const header = document.createElement("div");
    header.className = "gha-run-section-header";
    const heading = document.createElement("h2");
    heading.className = "h4";
    heading.textContent = "Summaries";
    header.append(heading);
    group?.prepend(header);
  }
  const header: HTMLElement | null = (group as HTMLElement).querySelector(
    ":scope > .gha-run-section-header",
  )!;
  if (!header) return;
  let count: HTMLElement | null = header.querySelector(
    ":scope > .gha-run-summary-count",
  );
  if (!count) {
    count = document.createElement("div");
    count.className = "gha-run-summary-count text-small color-fg-muted";
    header.append(count);
  }
  // Compare before writing so the mutation observer does not retrigger an update loop.
  const label = `${summaries.length} job ${summaries.length === 1 ? "summary" : "summaries"}`;
  if (count.textContent !== label) count.textContent = label;
}

/** Collapsibles run-level sections (summaries, annotations, artifacts, approvals). */
export function collapseRunSections() {
  for (const section of document.querySelectorAll(
    '.gha-run-summaries, [data-url*="/annotations_partial"] > .actions-fullwidth-module, [data-url*="/artifacts_partial"] > .actions-fullwidth-module, [data-url*="/approvals_partial"] > .actions-fullwidth-module',
  )) {
    const heading = section.querySelector("h2, h3");
    if (!heading) continue;
    section.classList.add("color-shadow-small");
    let button: HTMLButtonElement | null = heading.querySelector(
      ".gha-run-section-toggle",
    );
    if (!button) {
      let header: HTMLElement | null = heading as HTMLElement;
      while (header && header.parentElement !== section)
        header = (header as HTMLElement).parentElement!;
      if (!header) continue;
      header.classList.add("gha-run-section-header");
      section.classList.add("gha-run-section");
      button = document.createElement("button");
      button.type = "button";
      button.className = "gha-run-section-toggle";
      button.dataset.sectionKey = section.matches(".gha-run-summaries")
        ? "summaries"
        : (section.closest("[data-url]") as HTMLElement | null)?.getAttribute(
            "data-url",
          ) || heading.textContent.trim();
      button.append(...heading.childNodes);
      heading.append(button);
    }
    // Collapsed by default; the state lives in `expandedSections` so it survives DOM re-creation.
    const expanded = expandedSections.has(button?.dataset.sectionKey ?? "");
    button.setAttribute("aria-expanded", String(expanded));
    section.toggleAttribute("data-gha-collapsed", !expanded);
  }
}
