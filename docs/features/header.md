# Header features

## Enterprise header tab

On repositories of an organization that belongs to a GitHub Enterprise, GitHub adds an extra row at the top of the global header (a globe icon, "GitHub Enterprise" and, for example, "Users managed by <Enterprise>"). This feature hides that row and shows the same information as a compact tab hanging from the very top edge of the page at the center, like a notch: the globe, the text and, when the row links to an enterprise page on github.com, that link. The full text is shown as a tooltip. The tab uses the header's own background: it inherits it when the header paints one, otherwise it copies the color the browser computed for the header's first painted element (falling back to the default page background). On narrow screens only the globe is shown.

The row is only hidden when the whole row passes safety checks: it contains no search field, input, form, navigation, button, menu, image, focusable or ARIA-role element, or GitHub logo, it has at most one link and short text (up to 120 characters), it sits directly in the header or next to the main header row, and the header keeps other content. Headers inside the page content (for example in a repository's main area) are never touched. If any check fails, the page is left untouched. When you navigate to a page without the row, the tab is removed and the header is restored.

This is best-effort: GitHub's header is rendered by React and its markup can change. If the row is not collapsed (or something else is hidden), open the developer tools, copy the HTML of the row (from its outer element down to the text) and report it in a [new issue](https://github.com/nerdtronik/github-enhancer/issues). When the row is found but fails a safety check, the console (with the Verbose level enabled) shows one `Enterprise header:` line with the reason; include it in the report.

There is no setting to turn it off.
