"use strict";

if (typeof chrome === "undefined" && typeof browser !== "undefined") {
  // @ts-ignore
  chrome = browser;
}

export function parseSVG(svgText: string): HTMLElement {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  return doc.documentElement; // The <svg> element
}

export async function loadSVG(url: string): Promise<HTMLElement> {
  const response = await fetch(url);
  const svgText = await response.text();
  return parseSVG(svgText);
}

export function $x(node: Node | Document, expr: string) {
  const xpe = new XPathEvaluator();
  const nsResolver =
    node.ownerDocument === null
      ? (node as Document).documentElement
      : node.ownerDocument.documentElement;
  const result = xpe.evaluate(expr, node, nsResolver, 0, null);
  let found: Node[] = [];
  let res: Node | null;
  while ((res = result.iterateNext())) found.push(res);
  return found;
}

// export function pageType(): "repo" | "issues" | "pulls" | "discussions" | "projects" | "actions" | "action-run" | null {
//   const path = window.location.pathname;
//   if (/^\/[^/]+\/[^/]+\/(issues|pull|discussions|projects|actions)(?:\/|$)/.test(path)) {
//     const match = path.match(/^\/[^/]+\/[^/]+\/([^/]+)(?:\/|$)/);
//     if (match) {
//       const type = match[1];
//       if (type === "issues") return "issues";
//       if (type === "pull") return "pulls";
//       if (type === "discussions") return "discussions";
//       if (type === "projects") return "projects";
//       if (type === "actions") {
//         if (/^\/[^/]+\/[^/]+\/actions\/runs\/[^/]+(?:\/|$)/.test(path)) {
//           return "action-run";
//         }
//         return "actions";
//       }
//     }
//   }


// <div class="text-bold prc-Button-ButtonBase-9n-Xk appHeaderButton__sQ5HIU prc-Button-IconButton-fyge7" style="
//     display: block;
//     z-index: 99;
//     position: absolute;
//     overscroll-behavior: contain;
//     /* left: 158vh; */
//     /* background: var(--bgColor-default) !important; */
//     background-color: var(--bgColor-default);
//     /* border: white; */
//     /* opacity: 100; */
//     /* justify-content: end; */
//     width: max-content;
//     right: 15px;
//     padding-inline: 10px;
//     border-top: 0;
//     border-top-color: var(--bgColor-default);
//     border-top-left-radius: 0;
//     border-top-right-radius: 0;
//     font-size: 80%;
// "><svg data-component="Octicon" aria-hidden="true" focusable="false" class="octicon octicon-globe" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align:text-bottom"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM5.78 8.75a9.64 9.64 0 0 0 1.363 4.177c.255.426.542.832.857 1.215.245-.296.551-.705.857-1.215A9.64 9.64 0 0 0 10.22 8.75Zm4.44-1.5a9.64 9.64 0 0 0-1.363-4.177c-.307-.51-.612-.919-.857-1.215a9.927 9.927 0 0 0-.857 1.215A9.64 9.64 0 0 0 5.78 7.25Zm-5.944 1.5H1.543a6.507 6.507 0 0 0 4.666 5.5c-.123-.181-.24-.365-.352-.552-.715-1.192-1.437-2.874-1.581-4.948Zm-2.733-1.5h2.733c.144-2.074.866-3.756 1.58-4.948.12-.197.237-.381.353-.552a6.507 6.507 0 0 0-4.666 5.5Zm10.181 1.5c-.144 2.074-.866 3.756-1.58 4.948-.12.197-.237.381-.353.552a6.507 6.507 0 0 0 4.666-5.5Zm2.733-1.5a6.507 6.507 0 0 0-4.666-5.5c.123.181.24.365.353.552.714 1.192 1.436 2.874 1.58 4.948Z"></path></svg><span class="ml-1 hide-sm">GitHub Enterprise</span></div>