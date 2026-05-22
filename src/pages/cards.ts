/**
 * Card primitives for the read-only page rendering layer.
 *
 * The agent produces a Page (envelope + array of cards). The renderer
 * (`render.ts`) turns it into HTML. New card types should be added here
 * AND in render.ts — keep them in sync.
 */

export type Card =
  | { type: "heading"; text: string; level?: 1 | 2 | 3 }
  | { type: "text"; body: string }
  | { type: "markdown"; body: string }
  | { type: "bullets"; items: string[]; ordered?: boolean }
  | {
      type: "metric";
      label: string;
      value: string | number;
      delta?: string;
      hint?: string;
    }
  | { type: "quote"; text: string; source?: string }
  | {
      type: "link-list";
      links: { label: string; href: string; hint?: string }[];
    }
  | { type: "divider" };

export interface Page {
  slug: string;
  title: string;
  subtitle?: string;
  cards: Card[];
}

const CARD_TYPES = new Set([
  "heading",
  "text",
  "markdown",
  "bullets",
  "metric",
  "quote",
  "link-list",
  "divider",
]);

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
  if (!Array.isArray(p.cards)) {
    throw new PageValidationError("cards must be an array");
  }

  const cards = p.cards.map((c, i) => validateCard(c, i));

  return {
    slug: p.slug,
    title: p.title,
    subtitle: typeof p.subtitle === "string" ? p.subtitle : undefined,
    cards,
  };
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

  switch (c.type) {
    case "heading": {
      if (typeof c.text !== "string") throw new PageValidationError(`${ctx}.text required`);
      const level = c.level === 1 || c.level === 2 || c.level === 3 ? c.level : undefined;
      return { type: "heading", text: c.text, level };
    }
    case "text": {
      if (typeof c.body !== "string") throw new PageValidationError(`${ctx}.body required`);
      return { type: "text", body: c.body };
    }
    case "markdown": {
      if (typeof c.body !== "string") throw new PageValidationError(`${ctx}.body required`);
      return { type: "markdown", body: c.body };
    }
    case "bullets": {
      if (!Array.isArray(c.items) || !c.items.every((x) => typeof x === "string")) {
        throw new PageValidationError(`${ctx}.items must be string[]`);
      }
      return {
        type: "bullets",
        items: c.items as string[],
        ordered: c.ordered === true ? true : undefined,
      };
    }
    case "metric": {
      if (typeof c.label !== "string") throw new PageValidationError(`${ctx}.label required`);
      if (typeof c.value !== "string" && typeof c.value !== "number") {
        throw new PageValidationError(`${ctx}.value must be string or number`);
      }
      return {
        type: "metric",
        label: c.label,
        value: c.value as string | number,
        delta: typeof c.delta === "string" ? c.delta : undefined,
        hint: typeof c.hint === "string" ? c.hint : undefined,
      };
    }
    case "quote": {
      if (typeof c.text !== "string") throw new PageValidationError(`${ctx}.text required`);
      return {
        type: "quote",
        text: c.text,
        source: typeof c.source === "string" ? c.source : undefined,
      };
    }
    case "link-list": {
      if (!Array.isArray(c.links)) throw new PageValidationError(`${ctx}.links must be array`);
      const links = c.links.map((l, j) => {
        if (!l || typeof l !== "object") {
          throw new PageValidationError(`${ctx}.links[${j}] must be object`);
        }
        const link = l as Record<string, unknown>;
        if (typeof link.label !== "string" || typeof link.href !== "string") {
          throw new PageValidationError(`${ctx}.links[${j}] needs label and href strings`);
        }
        return {
          label: link.label,
          href: link.href,
          hint: typeof link.hint === "string" ? link.hint : undefined,
        };
      });
      return { type: "link-list", links };
    }
    case "divider":
      return { type: "divider" };
  }

  throw new PageValidationError(`${ctx}: unhandled card type`);
}
