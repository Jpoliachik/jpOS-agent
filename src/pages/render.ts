/**
 * Render a validated Page to an HTML string. Pure function, no I/O.
 *
 * Every card is rendered with the same shell: an eyebrow row (icon + label
 * on the left, optional meta on the right) above the type-specific body.
 * Cards lay out on a 2-column grid; width="half" sits in one column,
 * width="full" (default) spans both.
 */

import type { Card, Icon, ListItem, Page } from "./cards.js";
import { PAGE_CSS } from "./styles.js";

const ICON_GLYPHS: Record<Icon, string> = {
  star: "✱",
  sun: "☀",
  cloud: "☁",
  moon: "☾",
  diamond: "✦",
  clock: "◷",
  calendar: "▦",
  "arrow-right": "→",
  check: "✓",
  quote: "❝",
  bookmark: "❦",
  bolt: "⚡",
  note: "♪",
  heart: "♥",
  flame: "✺",
};

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
    '<div class="page-header-left">',
    `<h1>${escapeHtml(page.title)}</h1>`,
    page.subtitle ? `<div class="subtitle">${escapeHtml(page.subtitle)}</div>` : "",
    "</div>",
    page.meta ? `<div class="page-meta">${escapeHtml(page.meta)}</div>` : "",
    "</header>",
    '<div class="grid">',
    body,
    "</div>",
    '<footer class="page-footer">jpOS</footer>',
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}

function renderCard(card: Card): string {
  if (card.type === "divider") {
    return '<hr class="divider">';
  }

  const widthClass = card.width === "half" ? "half" : "full";
  const eyebrow = renderEyebrow(card.eyebrow, card.icon, card.meta);

  const body = (() => {
    switch (card.type) {
      case "prose":
        return [
          `<h2 class="prose-title">${escapeHtml(card.title)}</h2>`,
          card.body ? `<p class="prose-body">${escapeHtml(card.body)}</p>` : "",
        ].join("");
      case "list":
        return renderList(card.items, card.style);
      case "weather":
        return renderWeather(card);
      case "quote":
        return [
          `<blockquote class="quote">${escapeHtml(card.text)}</blockquote>`,
          card.source
            ? `<div class="quote-source">${escapeHtml(card.source)}</div>`
            : "",
        ].join("");
      case "metric": {
        const delta = card.delta
          ? `<span class="metric-delta">${escapeHtml(card.delta)}</span>`
          : "";
        const hint = card.hint
          ? `<div class="metric-hint">${escapeHtml(card.hint)}</div>`
          : "";
        return [
          `<div class="metric-value">${escapeHtml(String(card.value))}${delta}</div>`,
          `<div class="metric-label">${escapeHtml(card.label)}</div>`,
          hint,
        ].join("");
      }
    }
  })();

  return `<section class="card ${widthClass}">${eyebrow}${body}</section>`;
}

function renderEyebrow(
  label: string | undefined,
  icon: Icon | undefined,
  meta: string | undefined,
): string {
  if (!label && !icon && !meta) return "";
  const left = label || icon
    ? [
        '<div class="eyebrow-left">',
        icon ? `<span class="eyebrow-icon">${ICON_GLYPHS[icon]}</span>` : "",
        label ? `<span class="eyebrow-label">${escapeHtml(label)}</span>` : "",
        "</div>",
      ].join("")
    : "";
  const right = meta ? `<div class="eyebrow-meta">${escapeHtml(meta)}</div>` : "";
  return `<div class="eyebrow">${left}${right}</div>`;
}

function renderList(items: ListItem[], style: "agenda" | "bullets" | "numbered" | undefined): string {
  const resolved = style ?? "bullets";
  const rows = items.map((item, i) => {
    const lead = (() => {
      if (item.lead) return escapeHtml(item.lead);
      if (resolved === "bullets") return "•";
      if (resolved === "numbered") return `${i + 1}.`;
      return "";
    })();
    const text = item.href
      ? `<a href="${escapeAttr(item.href)}">${escapeHtml(item.text)}</a>`
      : escapeHtml(item.text);
    const trail = item.trail
      ? `<span class="list-trail">${escapeHtml(item.trail)}</span>`
      : "";
    return [
      '<div class="list-row">',
      `<div class="list-lead">${lead}</div>`,
      `<div class="list-text">${text}${trail}</div>`,
      "</div>",
    ].join("");
  });
  return `<div class="list list-${resolved}">${rows.join("")}</div>`;
}

function renderWeather(card: {
  temp: number | string;
  unit?: "F" | "C";
  condition?: string;
  high?: number | string;
  low?: number | string;
}): string {
  const unit = card.unit ? `<span class="weather-unit">°${card.unit}</span>` : "";
  const condition = card.condition
    ? `<div class="weather-condition">${escapeHtml(card.condition)}.</div>`
    : "";
  const hi = card.high !== undefined ? `H ${escapeHtml(String(card.high))}` : "";
  const lo = card.low !== undefined ? `L ${escapeHtml(String(card.low))}` : "";
  const hilo =
    hi || lo
      ? `<div class="weather-hilo">${[hi, lo].filter(Boolean).join(" · ")}</div>`
      : "";
  return [
    `<div class="weather-temp">${escapeHtml(String(card.temp))}${unit}</div>`,
    condition,
    hilo,
  ].join("");
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
