'use strict';
const { esc } = require('./markdown');

// Standalone HTML page used to display a Markdown report inside the sandboxed viewer iframe.
function markdownDoc(title, html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
  :root{color-scheme:light}body{margin:0;background:#fff;color:#1f1e1c;font:16.5px/1.7 "Iowan Old Style","Palatino Linotype",Palatino,Charter,Georgia,serif}
  main{max-width:760px;margin:0 auto;padding:44px 28px 80px}h1,h2,h3,h4{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.25;letter-spacing:-.01em;margin:1.8em 0 .5em}
  h1{font-size:2em;margin-top:0}h2{font-size:1.4em;padding-bottom:.25em;border-bottom:1px solid #e6e2da}h3{font-size:1.15em}
  a{color:#1f5f57}p,ul,ol{margin:.7em 0}li{margin:.25em 0}li.task{list-style:none;margin-left:-1.2em}
  blockquote{margin:1em 0;padding:.2em 1.1em;border-left:3px solid #1f5f57;background:#f3f6f5;color:#3b3a37}
  code{font:.86em ui-monospace,SFMono-Regular,Menlo,monospace;background:#f2efe9;padding:.1em .35em;border-radius:4px}
  pre{background:#f6f4ef;border:1px solid #e6e2da;border-radius:8px;padding:14px 16px;overflow:auto}pre code{background:none;padding:0;font-size:.82em;line-height:1.55}
  .table-wrap{overflow-x:auto;margin:1.2em 0}table{border-collapse:collapse;width:100%;font:14.5px/1.45 ui-sans-serif,system-ui,sans-serif}
  th,td{border-bottom:1px solid #e6e2da;padding:8px 10px;text-align:left;vertical-align:top}th{background:#f6f4ef;font-weight:600}
  img{max-width:100%}hr{border:0;border-top:1px solid #e6e2da;margin:2em 0}
  </style></head><body><main>${html}</main></body></html>`;
}

module.exports = { markdownDoc };
