/**
 * Render a validated Page to an HTML string. Pure function, no I/O.
 *
 * Markdown handling: lightweight in-house converter sufficient for the
 * `markdown` card body — headings, bold/italic/code, links, lists, blockquotes,
 * paragraphs. Avoids pulling in a markdown lib for now; swap to `marked`
 * if we outgrow it.
 */

import type { Card, Page } from "./cards.js";
import { PAGE_CSS } from "./styles.js";

export function renderPage(page: Page): string {
  const body = page.cards.map(renderCard).join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(page.title)}</title>`,
    "<style>",
    PAGE_CSS,
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    '<header class="page-header">',
    `<h1>${escapeHtml(page.title)}</h1>`,
    page.subtitle ? `<div class="subtitle">${escapeHtml(page.subtitle)}</div>` : "",
    "</header>",
    body,
    '<footer class="page-footer">jpOS</footer>',
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}

function renderCard(card: Card): string {
  switch (card.type) {
    case "heading": {
      const level = card.level ?? 2;
      const tag = `h${level}`;
      return `<section class="card flush"><${tag}>${escapeHtml(card.text)}</${tag}></section>`;
    }
    case "text":
      return `<section class="card"><p>${escapeHtml(card.body)}</p></section>`;
    case "markdown":
      return `<section class="card">${renderMarkdown(card.body)}</section>`;
    case "bullets": {
      const tag = card.ordered ? "ol" : "ul";
      const items = card.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
      return `<section class="card"><${tag}>${items}</${tag}></section>`;
    }
    case "metric": {
      const delta = card.delta
        ? `<span class="delta">${escapeHtml(card.delta)}</span>`
        : "";
      const hint = card.hint ? `<div class="hint">${escapeHtml(card.hint)}</div>` : "";
      return [
        '<section class="card metric">',
        `<div class="label">${escapeHtml(card.label)}</div>`,
        `<div class="value">${escapeHtml(String(card.value))}${delta}</div>`,
        hint,
        "</section>",
      ].join("");
    }
    case "quote": {
      const source = card.source
        ? `<span class="source">${escapeHtml(card.source)}</span>`
        : "";
      return `<section class="card"><div class="quote">${escapeHtml(card.text)}${source}</div></section>`;
    }
    case "link-list": {
      const links = card.links
        .map((l) => {
          const hint = l.hint ? `<span class="hint">${escapeHtml(l.hint)}</span>` : "";
          return `<a href="${escapeAttr(l.href)}">${escapeHtml(l.label)}${hint}</a>`;
        })
        .join("");
      return `<section class="card link-list">${links}</section>`;
    }
    case "divider":
      return '<hr class="divider">';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

// --- Minimal markdown -----------------------------------------------------
// Supports: # h1–### h3, **bold**, *italic*, `code`, [text](href), unordered
// lists (-/*), ordered lists (1.), > blockquote, blank-line paragraphs.

function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Headings
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level + 1}>${inlineMd(h[2])}</h${level + 1}>`);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        buf.push(lines[i].slice(2));
        i++;
      }
      out.push(`<blockquote>${inlineMd(buf.join(" "))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push(`<ul>${items.map((x) => `<li>${inlineMd(x)}</li>`).join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      out.push(`<ol>${items.map((x) => `<li>${inlineMd(x)}</li>`).join("")}</ol>`);
      continue;
    }

    // Paragraph (consume until blank line or block element)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !lines[i].startsWith("> ") &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inlineMd(para.join(" "))}</p>`);
  }

  return out.join("\n");
}

function inlineMd(s: string): string {
  // Escape first; then apply inline syntax to the *escaped* string. Because
  // our inline tokens use only ASCII punctuation that survives escapeHtml,
  // and we never inject raw user text after this point, this is safe.
  let t = escapeHtml(s);
  // Inline code (do early so its contents aren't re-processed)
  t = t.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  // Links [label](href)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    return `<a href="${href}">${label}</a>`;
  });
  // Bold **x**
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic *x*
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return t;
}
