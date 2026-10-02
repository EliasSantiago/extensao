// Renderizador Markdown pequeno e seguro (todo HTML de entrada é escapado).
// Suporta: blocos de código, código inline, títulos, listas, citações,
// tabelas simples, linhas horizontais, negrito, itálico, tachado e links.

import { icon } from './icons.js';

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

function renderTable(rows) {
  const split = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = split(rows[0]);
  const body = rows.slice(2).map(split);
  return (
    '<div class="table-wrap"><table><thead><tr>' +
    head.map((h) => `<th>${inline(h)}</th>`).join('') +
    '</tr></thead><tbody>' +
    body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
    '</tbody></table></div>'
  );
}

export function renderMarkdown(src) {
  const lines = (src || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const isBlockStart = (l) =>
    /^```/.test(l) || /^#{1,6}\s/.test(l) || /^\s*([-*+]|\d+[.)])\s+/.test(l) || /^>\s?/.test(l) || /^(\s*[-*_]){3,}\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    // Bloco de código (também renderiza bloco ainda aberto durante streaming)
    const fence = line.match(/^```\s*([\w+#.-]*)/);
    if (fence) {
      const lang = fence[1] || '';
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(
        `<div class="code-block"><div class="code-head"><span>${escapeHtml(lang || 'código')}</span>` +
          `<button class="copy-code" type="button">${icon('clipboard-document')}Copiar</button></div>` +
          `<pre><code>${escapeHtml(code.join('\n'))}</code></pre></div>`
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      out.push(renderTable(rows));
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+/);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const tag = ordered ? 'ol' : 'ul';
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m && /\d/.test(m[2]) === ordered && m[1].length < 2) {
          items.push([m[3]]);
          i++;
        } else if (items.length && l.trim() && (/^\s{2,}/.test(l) || !isBlockStart(l))) {
          items[items.length - 1].push(l.replace(/^\s{2,4}/, ''));
          i++;
        } else if (!l.trim() && i + 1 < lines.length && /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i + 1])) {
          i++;
        } else {
          break;
        }
      }
      const start = ordered ? parseInt(listMatch[2], 10) : 1;
      out.push(
        `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>` +
          items
            .map((parts) => {
              const [first, ...rest] = parts;
              return `<li>${inline(first)}${rest.length ? renderMarkdown(rest.join('\n')) : ''}</li>`;
            })
            .join('') +
          `</${tag}>`
      );
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }

  return out.join('');
}
