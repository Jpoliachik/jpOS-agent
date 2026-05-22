/**
 * Inline CSS for rendered pages. Single cream/editorial theme — no dark mode.
 *
 * Layout: 2-column grid, half cards take 1 col, full cards span both.
 * Typography: serif headlines (prose title, page title, quote),
 * mono small-caps eyebrows, system sans for body text.
 */
export const PAGE_CSS = `
  :root {
    --bg: #f3eee2;
    --surface: #faf6ec;
    --border: #d9d2bf;
    --rule: #c9c2ad;
    --text: #1a1814;
    --muted: #6f6a5d;
    --muted-soft: #8a8576;
    --max-width: 960px;
    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua",
      Georgia, serif;
    --sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font: 16px/1.55 var(--sans);
    -webkit-text-size-adjust: 100%;
  }
  main {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 40px 24px 96px;
  }

  /* Page header */
  header.page-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 24px;
    margin-bottom: 28px;
  }
  header.page-header h1 {
    font-family: var(--serif);
    font-style: italic;
    font-weight: 500;
    font-size: 34px;
    line-height: 1.1;
    margin: 0;
    letter-spacing: -0.01em;
  }
  header.page-header .subtitle {
    color: var(--muted);
    font-family: var(--serif);
    font-style: italic;
    font-size: 16px;
    margin-top: 4px;
  }
  header.page-header .page-meta {
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
  }

  /* Grid */
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 20px 22px;
  }
  .card.full { grid-column: 1 / -1; }
  .card.half { grid-column: span 1; }
  hr.divider {
    grid-column: 1 / -1;
    border: 0;
    border-top: 1px solid var(--rule);
    margin: 8px 0;
  }
  @media (max-width: 640px) {
    .grid { grid-template-columns: 1fr; }
    .card.half { grid-column: 1 / -1; }
  }

  /* Eyebrow */
  .eyebrow {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }
  .eyebrow-left {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
  }
  .eyebrow-icon {
    font-size: 13px;
    line-height: 1;
    color: var(--muted-soft);
  }
  .eyebrow-label,
  .eyebrow-meta {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted);
  }

  /* Prose card */
  .prose-title {
    font-family: var(--serif);
    font-weight: 500;
    font-size: 28px;
    line-height: 1.2;
    letter-spacing: -0.01em;
    margin: 0 0 8px;
  }
  .prose-body {
    font-family: var(--serif);
    font-style: italic;
    color: var(--muted);
    font-size: 17px;
    line-height: 1.5;
    margin: 0;
  }

  /* List card */
  .list { display: flex; flex-direction: column; }
  .list-row {
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 16px;
    align-items: baseline;
    padding: 10px 0;
    border-top: 1px solid var(--rule);
  }
  .list-row:first-child { border-top: 0; padding-top: 4px; }
  .list-lead {
    font-family: var(--mono);
    font-size: 13px;
    color: var(--muted);
    white-space: nowrap;
  }
  .list-bullets .list-row,
  .list-numbered .list-row {
    grid-template-columns: 20px 1fr;
    border-top: 0;
    padding: 4px 0;
  }
  .list-text { font-size: 15px; line-height: 1.45; }
  .list-text a { color: var(--text); text-decoration: underline; text-decoration-color: var(--rule); }
  .list-trail {
    font-family: var(--serif);
    font-style: italic;
    color: var(--muted);
    margin-left: 6px;
  }

  /* Weather card */
  .weather-temp {
    font-family: var(--serif);
    font-weight: 500;
    font-size: 56px;
    line-height: 1;
    letter-spacing: -0.02em;
    margin-bottom: 4px;
  }
  .weather-unit {
    font-size: 18px;
    color: var(--muted);
    margin-left: 4px;
    vertical-align: top;
    font-style: italic;
  }
  .weather-condition {
    font-family: var(--serif);
    font-style: italic;
    color: var(--muted);
    font-size: 17px;
    margin-top: 8px;
  }
  .weather-hilo {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    letter-spacing: 0.08em;
    margin-top: 8px;
  }

  /* Quote card */
  .quote {
    font-family: var(--serif);
    font-style: italic;
    font-size: 19px;
    line-height: 1.4;
    color: var(--text);
    margin: 0;
    padding: 0;
    border: 0;
  }
  .quote-source {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted);
    margin-top: 12px;
  }
  .quote-source::before { content: "— "; }

  /* Metric card */
  .metric-value {
    font-family: var(--serif);
    font-weight: 500;
    font-size: 40px;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .metric-delta {
    display: inline-block;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    margin-left: 10px;
    vertical-align: middle;
  }
  .metric-label {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted);
    margin-top: 8px;
  }
  .metric-hint {
    color: var(--muted);
    font-size: 13px;
    font-family: var(--serif);
    font-style: italic;
    margin-top: 4px;
  }

  /* Footer */
  footer.page-footer {
    margin-top: 48px;
    color: var(--muted-soft);
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    text-align: center;
  }
`;
