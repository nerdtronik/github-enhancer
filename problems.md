# problems

This document stores some problems found during extension usage:

1. Only fetch keepalive is allowed during onfreeze: https://api.github.com/_private/browser/rum?ddforward=%2Fapi%2Fv2%2Frum%3Fddsource%3Dbrowser%26dd-api-key%3DeyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaEpJaEpoZFhSb1pXNTBhV05oZEdWa0Jqb0dSVlE9IiwiZXhwIjoiMjAyNi0xMC0yMlQxNzo1OTo1My45ODBaIiwicHVyIjoiYnJvd3Nlcl9zdGF0czpjbGllbnRfdG9rZW4ifX0--077559078572ef0314ad79d7219475b5700f9683%26dd-evp-origin-version%3D7.15.0%26dd-evp-origin%3Dbrowser%26dd-request-id%3D90a3ac43-564e-4c67-8d41-c8113dad6c50%26batch_time%3D1792617636899%26_dd.api%3Dfetch
  - Context: https://github.com/wk-dxg/fab/pull/58855/changes
  - Stack Trace:

src/js/collector-suppress.js:15 (window.fetch)
```javascript
const nativeFetch = window.fetch;
  window.fetch = function(input, init) {
    if (suppress(input)) return Promise.resolve(new Response(null, { status: 204 }));
    return nativeFetch.call(this, input, init);    <--- HERE
  };
```