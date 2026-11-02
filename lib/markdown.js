'use strict';
// Compact Markdown -> HTML renderer covering what LLM research output uses:
// headings, paragraphs, bold/italic/strike, inline + fenced code, links, images,
// ordered/unordered/task lists (nested), blockquotes, tables, hr, footnote-ish refs.
// Raw HTML is escaped; output is additionally shown inside a script-less sandbox.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u) => (/^\s*(javascript|vbscript|data:text)/i.test(u) ? '#' : u.trim());

function inline(src) {
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, a, u) => `<img alt="${a}" src="${esc(safeUrl(u))}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, t, u) => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\[\^(\w+)\]/g, '<sup>[$1]</sup>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}

const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

function render(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  let i = 0;
  const out = [];
  const isBlockStart = (l) => /^(#{1,6}\s|```|~~~|>|\s*([-*+]|\d+[.)])\s|\s*(-{3,}|\*{3,}|_{3,})\s*$)/.test(l);

  function list(indent) {
    const first = lines[i];
    const ordered = /^\s*\d+[.)]\s/.test(first);
    const startNum = ordered ? parseInt(first.trim(), 10) : 1;
    const items = [];
    while (i < lines.length) {
      const l = lines[i];
      const m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (!m || m[1].length < indent) {
        if (l.trim() === '' && i + 1 < lines.length && /^(\s*)([-*+]|\d+[.)])\s/.test(lines[i + 1]) && lines[i + 1].match(/^\s*/)[0].length >= indent) { i++; continue; }
        break;
      }
      if (m[1].length > indent) { items[items.length - 1].children.push(list(m[1].length)); continue; }
      i++;
      let text = m[3];
      while (i < lines.length && lines[i].trim() !== '' && !/^\s*([-*+]|\d+[.)])\s/.test(lines[i]) && !isBlockStart(lines[i].trimStart())) text += ' ' + lines[i++].trim();
      items.push({ text, children: [] });
    }
    const tag = ordered ? 'ol' : 'ul';
    const body = items.map((it) => {
      let t = it.text, cls = '';
      const task = t.match(/^\[([ xX])\]\s+(.*)$/);
      if (task) { t = `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> ${inline(task[2])}`; cls = ' class="task"'; } else t = inline(t);
      return `<li${cls}>${t}${it.children.join('')}</li>`;
    }).join('');
    return `<${tag}${ordered && startNum !== 1 ? ` start="${startNum}"` : ''}>${body}</${tag}>`;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    let m;
    if ((m = line.match(/^\s*(```|~~~)\s*([\w+-]*)/))) {
      const fence = m[1]; const lang = m[2]; const buf = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const id = m[2].toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
      out.push(`<h${m[1].length} id="${id}">${inline(m[2])}</h${m[1].length}>`); i++; continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && lines[i].trim() !== '' && (/^\s*>/.test(lines[i]) || buf.length)) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`); continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') rows.push(splitRow(lines[i++]));
      const cell = (tag, c, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c)}</${tag}>`;
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => cell('td', c, k)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) { out.push(list(line.match(/^\s*/)[0].length)); continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() !== '' && !(buf.length && isBlockStart(lines[i]))) {
      if (lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) break;
      buf.push(lines[i++]);
    }
    if (!buf.length) { buf.push(lines[i++]); }
    out.push(`<p>${buf.map((l) => inline(l.trim())).join(/  $/.test(buf[0]) ? '<br>' : '\n')}</p>`);
  }
  return out.join('\n');
}

function firstHeading(md) {
  const m = String(md).match(/^#{1,2}\s+(.+)$/m);
  return m ? m[1].replace(/[*_`]/g, '').trim() : '';
}

module.exports = { render, firstHeading, esc };
