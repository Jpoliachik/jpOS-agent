/**
 * Inline CSS for rendered pages. Single dark-mode-friendly stylesheet,
 * mobile-first. Kept as a string so the renderer can embed it without a
 * separate static-file route.
 */
export const PAGE_CSS = `
  :root {
    --bg: #0f1115;
    --surface: #171a20;
    --surface-2: #1e222b;
    --border: #262b36;
    --text: #e6e8ee;
    --muted: #8a93a6;
    --accent: #7aa2ff;
    --accent-soft: #1f2a44;
    --quote: #c5cdd9;
    --max-width: 720px;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f7f8fa;
      --surface: #ffffff;
      --surface-2: #f0f2f6;
      --border: #e3e6ec;
      --text: #1a1d23;
      --muted: #5e6776;
      --accent: #2f6bff;
      --accent-soft: #e6eeff;
      --quote: #3a414d;
    }
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text",
      "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  main {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 32px 20px 96px;
  }
  header.page-header { margin-bottom: 28px; }
  header.page-header h1 {
    font-size: 28px;
    line-height: 1.2;
    margin: 0 0 6px;
    letter-spacing: -0.01em;
  }
  header.page-header .subtitle {
    color: var(--muted);
    font-size: 14px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 18px 20px;
    margin: 12px 0;
  }
  .card.flush { background: transparent; border: 0; padding: 8px 0; margin: 8px 0; }
  .card h2, .card h3, .card h4 {
    margin: 0 0 8px;
    letter-spacing: -0.01em;
  }
  .card h2 { font-size: 22px; }
  .card h3 { font-size: 18px; }
  .card h4 { font-size: 16px; color: var(--muted); text-transform: uppercase;
    font-weight: 600; letter-spacing: 0.04em; }
  .card p { margin: 0 0 10px; }
  .card p:last-child { margin-bottom: 0; }
  .card ul, .card ol { margin: 0; padding-left: 22px; }
  .card li { margin: 4px 0; }
  .metric .label {
    color: var(--muted);
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .metric .value {
    font-size: 32px;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin-top: 4px;
  }
  .metric .delta {
    display: inline-block;
    margin-left: 10px;
    font-size: 14px;
    color: var(--accent);
    background: var(--accent-soft);
    padding: 2px 8px;
    border-radius: 999px;
    vertical-align: middle;
  }
  .metric .hint { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .quote {
    border-left: 3px solid var(--accent);
    padding: 4px 0 4px 16px;
    color: var(--quote);
    font-style: italic;
  }
  .quote .source {
    display: block;
    margin-top: 8px;
    font-style: normal;
    font-size: 13px;
    color: var(--muted);
  }
  .quote .source::before { content: "— "; }
  .link-list a {
    display: block;
    padding: 10px 12px;
    margin: 4px 0;
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--text);
    text-decoration: none;
    border: 1px solid transparent;
  }
  .link-list a:hover { border-color: var(--border); }
  .link-list .hint { display: block; color: var(--muted); font-size: 13px; margin-top: 2px; }
  hr.divider {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 20px 0;
  }
  code, pre {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.92em;
  }
  pre {
    background: var(--surface-2);
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
  }
  a { color: var(--accent); }
  footer.page-footer {
    margin-top: 48px;
    color: var(--muted);
    font-size: 12px;
    text-align: center;
  }
`;
