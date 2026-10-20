(() => {
  "use strict";

  const modules = globalThis.__ghaRunViewModules;
  const { workflowInfos, expandedSections } = modules.state;
  function moveWorkflowInfo(graph, canvas) {
    const summary = document.querySelector(".actions-workflow-stats > .d-flex");
    const previous = workflowInfos.get(graph);
    const visualGraph = graph.querySelector(
      '[data-target="action-graph.visualGraph"]'
    );
    const header = Array.from(canvas.children).find(
      (element) => !element.contains(visualGraph) && element.querySelector("h2")
    );
    const info = header ?? previous;
    if (!summary || !info) return;
    if (previous && previous !== info) previous.remove();
    workflowInfos.set(graph, info);
    info.classList.add("gha-run-workflow-info");
    if (info.parentElement !== summary) summary.append(info);
  }

  function groupSummaries() {
    const summaries = Array.from(
      document.querySelectorAll("job-summary.actions-job-summary")
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
        ".gha-run-section-header, .gha-run-section-heading"
      ))
        element.classList.remove(
          "gha-run-section-header",
          "gha-run-section-heading"
        );
    }
    let host = summaries[0].parentElement;
    while (!summaries.every((summary) => host.contains(summary)))
      host = host.parentElement;
    const branches = Array.from(
      new Set(
        summaries.map((summary) => {
          let branch = summary;
          while (branch.parentElement !== host) branch = branch.parentElement;
          return branch;
        })
      )
    );
    let group = host;
    if (
      !host.matches(".gha-run-summaries") &&
      Array.from(host.children).some(
        (child) =>
          !branches.includes(child) && !child.matches(".gha-run-section-header")
      )
    ) {
      group = branches.find((branch) =>
        branch.matches(
          ".gha-run-summaries:not([data-url]):not(.js-updatable-content)"
        )
      );
      const contents = branches.flatMap((branch) =>
        branch === group
          ? Array.from(group.children).filter(
              (child) => !child.matches(".gha-run-section-header")
            )
          : [branch]
      );
      if (!group) {
        group = document.createElement("div");
        host.insertBefore(group, branches[0]);
      }
      let next =
        group.querySelector(":scope > .gha-run-section-header")
          ?.nextElementSibling ?? group.firstElementChild;
      for (const branch of contents) {
        if (branch !== next) group.insertBefore(branch, next);
        next = branch.nextElementSibling;
      }
    }
    for (const branch of branches) {
      if (branch === group || !branch.matches(".gha-run-summaries")) continue;
      branch.querySelector(":scope > .gha-run-section-header")?.remove();
      branch.classList.remove("gha-run-summaries", "gha-run-section");
      branch.removeAttribute("data-gha-collapsed");
    }
    group.classList.add(
      "gha-run-summaries",
      "actions-fullwidth-module",
      "color-bg-default",
      "color-shadow-small",
      "border",
      "rounded"
    );
    if (!group.querySelector(":scope > .gha-run-section-header")) {
      const header = document.createElement("div");
      header.className = "gha-run-section-header";
      const heading = document.createElement("h2");
      heading.className = "h4";
      heading.textContent = "Summaries";
      header.append(heading);
      group.prepend(header);
    }
    const header = group.querySelector(":scope > .gha-run-section-header");
    let count = header.querySelector(":scope > .gha-run-summary-count");
    if (!count) {
      count = document.createElement("div");
      count.className = "gha-run-summary-count text-small color-fg-muted";
      header.append(count);
    }
    const label = `${summaries.length} job ${
      summaries.length === 1 ? "summary" : "summaries"
    }`;
    if (count.textContent !== label) count.textContent = label;
  }

  function collapseRunSections() {
    for (const section of document.querySelectorAll(
      '.gha-run-summaries, [data-url*="/annotations_partial"] > .actions-fullwidth-module, [data-url*="/artifacts_partial"] > .actions-fullwidth-module, [data-url*="/approvals_partial"] > .actions-fullwidth-module'
    )) {
      const heading = section.querySelector("h2, h3");
      if (!heading) continue;
      section.classList.add("color-shadow-small");
      let button = heading.querySelector(".gha-run-section-toggle");
      if (!button) {
        let header = heading;
        while (header.parentElement !== section) header = header.parentElement;
        header.classList.add("gha-run-section-header");
        section.classList.add("gha-run-section");
        button = document.createElement("button");
        button.type = "button";
        button.className = "gha-run-section-toggle";
        button.dataset.sectionKey = section.matches(".gha-run-summaries")
          ? "summaries"
          : section.closest("[data-url]")?.getAttribute("data-url") ||
            heading.textContent.trim();
        button.append(...heading.childNodes);
        heading.append(button);
      }
      const expanded = expandedSections.has(button.dataset.sectionKey);
      button.setAttribute("aria-expanded", String(expanded));
      section.toggleAttribute("data-gha-collapsed", !expanded);
    }
  }


  Object.assign(modules, { moveWorkflowInfo, groupSummaries, collapseRunSections });
})();
