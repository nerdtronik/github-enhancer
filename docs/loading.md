# Content script loading

| Group | Match | Entry | World | run_at | Bundles | CSS |
| --- | --- | --- | --- | --- | --- | --- |
| global | `https://github.com/*` | 1 | MAIN | `document_start` | `collector-suppress.js` | none |
| global | `https://github.com/*` | 2 | isolated | `document_start` | `settings.js`, `navigation-guard.js`, `themes.js` | `themes.css` |
| global | `https://github.com/*` | 3 | isolated | `document_idle` | `go-to-top.js`, `enterprise-header.js` | `go-to-top.css`, `enterprise-header.css` |
| actions | `https://github.com/*/*/actions*` | 4 | isolated | `document_idle` | `workflow-filter.js`, `run-list.js`, `sidebar-resize.js`, `refresh-now.js` | `content.css`, `run-list.css`, `sidebar-resize.css`, `refresh-now.css` |
| actions | `https://github.com/*/*/actions*` | 5 | MAIN | `document_idle` | `run-view.js` | `run-view/{sections,graph,toolbar}.css` |
| pull | `https://github.com/*/*/pull/*` | 6 | isolated | `document_idle` | `pr-conversation.js`, `sidebar-resize.js` | `pr-conversation.css`, `sidebar-resize.css` |

Paths are under `dist/`; CSS paths are under `dist/css/`. Bundles that share a match pattern, world and `run_at` are grouped in one entry (Chrome applies `world` and `run_at` per entry, so entries that differ in either cannot be merged); bundles run in the listed order. `sidebar-resize.js` and its CSS appear in two entries whose patterns never match the same page. `collector-suppress.js` must run in MAIN to patch page globals before GitHub scripts; `run-view.js` needs the page's `action-graph` element, so it is MAIN in its own entry. `themes.js` runs on every page at `document_start` because its stylesheet must exist before first paint. Built-in Active themes are applied as soon as settings load, which can cost a one-frame flash of GitHub's default look; a Custom Active theme is applied only after custom themes are read from storage, so it appears a short moment later.

## Turbo and full page loads

Manifest `matches` are evaluated only on full page loads, but GitHub navigates without them: Turbo swaps page content, and some pages use React soft navigation through `history.pushState`. Bundles are therefore loaded by route family, and `navigation-guard.js` makes sure the right family is present.

The guard records the route group of the page it was loaded on (`routeGroup()`: `actions`, `pull` or none). It then forces a full page load when a navigation would enter a different group:

- `click` (capture phase, plain left click, same-origin link, no `target` other than `_self`, no `download`, different pathname): `preventDefault`, `stopImmediatePropagation`, `location.assign(href)`.
- `turbo:before-visit`: `preventDefault`, then `location.assign(url)`.
- `popstate`: `location.reload()`.
- Programmatic soft navigation (`history.pushState`, React routers): after the navigation completes, if the new pathname enters a different group, `location.reload()`. Completion is detected by the Navigation API `navigatesuccess` event alone where it exists (Chromium). Elsewhere (Firefox) a `MutationObserver` watches `document.head` (title and meta changes) and acts only when the pathname changed; if the head does not exist yet at `document_start`, a shallow observer on `<html>` waits for it and then hands over to the head observer. The page briefly shows the soft-navigated content before reloading.

Not covered: a soft navigation that changes the URL without any `<head>` mutation in a browser lacking the Navigation API; form submissions are left to the browser.

Navigation within the loaded group, and to pages outside any group, is left alone. Features still check `route()` at runtime for sub-pages within their group.

Trade-off: entering Actions or a pull request from another kind of page (or from the other group) is a full page load instead of a soft navigation. To revert, widen the repo-scoped patterns to `https://github.com/*/*` and remove the `navigation-guard.js` entry.

## Future option

A tiny loader could be the only bundle registered broadly. On each route change it would dynamically `import()` the feature modules needed for the new route. This needs ES-module bundles and the feature files listed in `web_accessible_resources`. Not built.
