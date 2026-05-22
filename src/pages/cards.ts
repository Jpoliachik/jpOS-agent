/**
 * Card primitives for the read-only page rendering layer.
 *
 * Design goals:
 *   - Every card shares the same shell (eyebrow + icon + optional right meta)
 *   - Closed set of card types — no markdown escape hatch
 *   - Plain text only inside fields (no inline formatting)
 *   - Layout: full-width or half-width cards on a 2-col grid
 *
 * Card types & icons are mirrored in render.ts and styles.ts.
 */

export const ICONS = [
  "star",
  "sun",
  "cloud",
  "moon",
  "diamond",
  "clock",
  "calendar",
  "arrow-right",
  "check",
  "quote",
  "bookmark",
  "bolt",
  "note",
  "heart",
  "flame",
] as const;
export type Icon = (typeof ICONS)[number];

export type CardWidth = "full" | "half";

interface CardShell {
  width?: CardWidth;
  eyebrow?: string;
  icon?: Icon;
  meta?: string;
}

export type ListStyle = "agenda" | "bullets" | "numbered";

export interface ListItem {
  text: string;
  lead?: string;
  trail?: string;
  href?: string;
}

export type Card =
  | (CardShell & { type: "prose"; title: string; body?: string })
  | (CardShell & { type: "list"; items: ListItem[]; style?: ListStyle })
  | (CardShell & {
      type: "weather";
      temp: number | string;
      unit?: "F" | "C";
      condition?: string;
      high?: number | string;
      low?: number | string;
    })
  | (CardShell & { type: "quote"; text: string; source?: string })
  | (CardShell & {
      type: "metric";
      label: string;
      value: string | number;
      delta?: string;
      hint?: string;
    })
  | { type: "divider" };

export interface Page {
  slug: string;
  title: string;
  subtitle?: string;
  meta?: string;
  cards: Card[];
}

const CARD_TYPES = new Set([
  "prose",
  "list",
  "weather",
  "quote",
  "metric",
  "divider",
]);

const LIST_STYLES = new Set(["agenda", "bullets", "numbered"]);
const ICON_SET = new Set<string>(ICONS);
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/;

export class PageValidationError extends Error {}

export function validatePage(input: unknown): Page {
  if (!input || typeof input !== "object") {
    throw new PageValidationError("page must be an object");
  }
  const p = input as Record<string, unknown>;

  if (typeof p.slug !== "string" || !SLUG_RE.test(p.slug)) {
    throw new PageValidationError(
      "slug must be lowercase a-z, 0-9, '-', or '_', 1–128 chars, starting alphanumeric",
    );
  }
  if (typeof p.title !== "string" || p.title.length === 0) {
    throw new PageValidationError("title must be a non-empty string");
  }
  if (p.subtitle !== undefined && typeof p.subtitle !== "string") {
    throw new PageValidationError("subtitle must be a string if present");
  }
  if (p.meta !== undefined && typeof p.meta !== "string") {
    throw new PageValidationError("meta must be a string if present");
  }
  if (!Array.isArray(p.cards)) {
    throw new PageValidationError("cards must be an array");
  }

  const cards = p.cards.map((c, i) => validateCard(c, i));

  return {
    slug: p.slug,
    title: p.title,
    subtitle: typeof p.subtitle === "string" ? p.subtitle : undefined,
    meta: typeof p.meta === "string" ? p.meta : undefined,
    cards,
  };
}

function pickShell(c: Record<string, unknown>, ctx: string): CardShell {
  const shell: CardShell = {};
  if (c.width !== undefined) {
    if (c.width !== "full" && c.width !== "half") {
      throw new PageValidationError(`${ctx}.width must be "full" or "half"`);
    }
    shell.width = c.width;
  }
  if (c.eyebrow !== undefined) {
    if (typeof c.eyebrow !== "string") {
      throw new PageValidationError(`${ctx}.eyebrow must be a string`);
    }
    shell.eyebrow = c.eyebrow;
  }
  if (c.icon !== undefined) {
    if (typeof c.icon !== "string" || !ICON_SET.has(c.icon)) {
      throw new PageValidationError(
        `${ctx}.icon must be one of: ${[...ICONS].join(", ")}`,
      );
    }
    shell.icon = c.icon as Icon;
  }
  if (c.meta !== undefined) {
    if (typeof c.meta !== "string") {
      throw new PageValidationError(`${ctx}.meta must be a string`);
    }
    shell.meta = c.meta;
  }
  return shell;
}

function validateCard(input: unknown, index: number): Card {
  const ctx = `cards[${index}]`;
  if (!input || typeof input !== "object") {
    throw new PageValidationError(`${ctx} must be an object`);
  }
  const c = input as Record<string, unknown>;
  if (typeof c.type !== "string" || !CARD_TYPES.has(c.type)) {
    throw new PageValidationError(
      `${ctx}.type must be one of: ${[...CARD_TYPES].join(", ")}`,
    );
  }

  if (c.type === "divider") return { type: "divider" };

  const shell = pickShell(c, ctx);

  switch (c.type) {
    case "prose": {
      if (typeof c.title !== "string" || c.title.length === 0) {
        throw new PageValidationError(`${ctx}.title required`);
      }
      return {
        ...shell,
        type: "prose",
        title: c.title,
        body: typeof c.body === "string" ? c.body : undefined,
      };
    }
    case "list": {
      if (!Array.isArray(c.items)) {
        throw new PageValidationError(`${ctx}.items must be an array`);
      }
      const items: ListItem[] = c.items.map((it, j) => {
        if (!it || typeof it !== "object") {
          throw new PageValidationError(`${ctx}.items[${j}] must be an object`);
        }
        const item = it as Record<string, unknown>;
        if (typeof item.text !== "string" || item.text.length === 0) {
          throw new PageValidationError(`${ctx}.items[${j}].text required`);
        }
        const out: ListItem = { text: item.text };
        if (item.lead !== undefined) {
          if (typeof item.lead !== "string") {
            throw new PageValidationError(`${ctx}.items[${j}].lead must be string`);
          }
          out.lead = item.lead;
        }
        if (item.trail !== undefined) {
          if (typeof item.trail !== "string") {
            throw new PageValidationError(`${ctx}.items[${j}].trail must be string`);
          }
          out.trail = item.trail;
        }
        if (item.href !== undefined) {
          if (typeof item.href !== "string") {
            throw new PageValidationError(`${ctx}.items[${j}].href must be string`);
          }
          out.href = item.href;
        }
        return out;
      });
      let style: ListStyle | undefined;
      if (c.style !== undefined) {
        if (typeof c.style !== "string" || !LIST_STYLES.has(c.style)) {
          throw new PageValidationError(
            `${ctx}.style must be one of: ${[...LIST_STYLES].join(", ")}`,
          );
        }
        style = c.style as ListStyle;
      }
      return { ...shell, type: "list", items, style };
    }
    case "weather": {
      if (typeof c.temp !== "string" && typeof c.temp !== "number") {
        throw new PageValidationError(`${ctx}.temp must be string or number`);
      }
      let unit: "F" | "C" | undefined;
      if (c.unit !== undefined) {
        if (c.unit !== "F" && c.unit !== "C") {
          throw new PageValidationError(`${ctx}.unit must be "F" or "C"`);
        }
        unit = c.unit;
      }
      for (const k of ["high", "low"] as const) {
        if (c[k] !== undefined && typeof c[k] !== "string" && typeof c[k] !== "number") {
          throw new PageValidationError(`${ctx}.${k} must be string or number`);
        }
      }
      if (c.condition !== undefined && typeof c.condition !== "string") {
        throw new PageValidationError(`${ctx}.condition must be a string`);
      }
      return {
        ...shell,
        type: "weather",
        temp: c.temp as string | number,
        unit,
        condition: typeof c.condition === "string" ? c.condition : undefined,
        high: c.high as string | number | undefined,
        low: c.low as string | number | undefined,
      };
    }
    case "quote": {
      if (typeof c.text !== "string" || c.text.length === 0) {
        throw new PageValidationError(`${ctx}.text required`);
      }
      return {
        ...shell,
        type: "quote",
        text: c.text,
        source: typeof c.source === "string" ? c.source : undefined,
      };
    }
    case "metric": {
      if (typeof c.label !== "string") throw new PageValidationError(`${ctx}.label required`);
      if (typeof c.value !== "string" && typeof c.value !== "number") {
        throw new PageValidationError(`${ctx}.value must be string or number`);
      }
      return {
        ...shell,
        type: "metric",
        label: c.label,
        value: c.value as string | number,
        delta: typeof c.delta === "string" ? c.delta : undefined,
        hint: typeof c.hint === "string" ? c.hint : undefined,
      };
    }
  }

  throw new PageValidationError(`${ctx}: unhandled card type`);
}
