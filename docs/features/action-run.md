# Action Run features

These features apply to the summary page of a workflow run (`https://github.com/<owner>/<repo>/actions/runs/<id>`). Job logs and other sub-pages of a run are not changed, except for the resizable sidebar.

## Resizable sidebar

The jobs list on the left of a run page has a drag handle on its right edge. Drag it, or focus it and use the left and right arrow keys (20 px per step). The width is limited to 240 px at minimum and 800 px at maximum, and never leaves less than 360 px for the page content. The handle is not available on windows narrower than 800 px.

The width is saved in the extension storage (one value for run pages, shared by all repositories). See [Quality of Life](./quality-of-life.md#resizable-sidebars) for the same feature on other pages.

## Collapsible information

Setting: the **Collapsible sections** switch, added to GitHub's own "more" menu of the run page (right after "Create status badge"). On by default. Changing it reloads the page. It only has effect while **Enhanced view** (see below) is on.

When on, the run-level sections are collapsed by default and open with a click on their title:

- **Summaries:** all job summaries are gathered into a single section titled **Summaries**, with a count ("N job summaries").
- **Annotations**, **Artifacts** and **Approvals** sections, when the run has them.

Which sections you opened is remembered while you stay on the same run and reset when you open another run. A link to a job summary (a `#` link to it) opens the Summaries section and scrolls to it. When the switch is off, these sections are left as GitHub renders them.

The workflow information that GitHub shows with the graph is also moved up to the run summary area.

## Enhanced Jobs view

Setting: the **Enhanced view** switch, added to GitHub's own "more" menu of the run page (right after "Create status badge"). On by default. Changing it reloads the page. When off, the run page is left as GitHub renders it, including the Collapsible sections feature.

GitHub draws the jobs as absolutely positioned cards joined by connector lines. This feature shows them instead as a scrollable list of stages, which works better for big workflows. It adds:

- **Stages:** each stage column has a **Stage N** badge. Stage numbers stay stable while jobs update.
- **Scrolling:** a bar above the jobs with a horizontal slider and left and right arrows (they move one stage at a time). You can also use the mouse wheel horizontally, or the left and right arrow keys when the jobs area is focused.
- **Drag to pan:** press the primary mouse button on the jobs area and drag to pan in both directions; on release it glides a little (unless your system prefers reduced motion). Small movements still count as clicks, and form controls are not affected. Touch pans horizontally only.
- **Resize height:** a handle under the jobs area changes its height by dragging or with the arrow keys (180 px minimum). The height is saved.
- **Search jobs:** a **Search jobs** box matches the text of job names (including names of jobs inside a matrix) and hides the rest. Typing is applied after a short delay.
- **Filter jobs:** a **Filter jobs** menu with a checkbox per status, with job counts: Completed, Failed, Waiting, In progress, Action required, Cancelled, Skipped, Timed out. Several can be selected; **Show all jobs** clears them. Jobs waiting for review count as Action required, and when the run has finished, jobs still waiting count as Skipped. A failed count shown with a `+` is a lower bound, because a collapsed matrix only reports that it has failures. Search and filters reset when you open another run.
- **Relationships and scope:** hovering a job highlights the jobs it depends on and the jobs that depend on it (the full chain upstream and downstream). Each job card also has a scope button (**Show dependency flow for <job>**): clicking it hides every job not related to it, until you click it again or use **Exit scoped view**. The relations are read from the connector lines that GitHub itself draws.
- **Group by status:** optional, groups the jobs of each stage under collapsible headings: **Completed**, **Active / pending**, **Skipped**, **Cancelled**. The state of the headings is remembered while you stay on the same run.

Settings in the gear button of the bar (**Job view settings**), saved in the extension storage and shared by all repositories:

| Name | Default |
| --- | --- |
| Highlight related jobs on hover | on |
| Group by status | off |
| Search and filter (Left, Right) | Right |
| Scroll arrows (Left, Right, Both) | Left |

The jobs area height starts automatic and is saved once you resize it.

## Where settings are stored

All the settings above are saved in the browser extension storage, local to your browser, and apply to every repository. Nothing is sent anywhere.

## Limits

This is best-effort: GitHub's run page is rendered by custom elements and its markup can change. The Enhanced Jobs view replaces some layout methods of GitHub's job graph, so a change in GitHub's code can break it; turn **Enhanced view** off to get the original page back, and report the problem in a [new issue](https://github.com/nerdtronik/github-enhancer/issues). Status detection depends on GitHub's English status labels.
