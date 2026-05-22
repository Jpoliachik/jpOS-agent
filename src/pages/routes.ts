/**
 * Fastify plugin: read-only page routes.
 *
 *   GET /page/:slug?t=<signed-token>   -> rendered HTML
 *
 * Listing pages is intentionally not exposed publicly — index lives behind
 * the bearer-token API in `interfaces/api.ts`.
 */

import type { FastifyInstance } from "fastify";
import { loadPage } from "./store.js";
import { renderPage } from "./render.js";
import { verifyToken } from "./sign.js";

export async function pagesPlugin(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string }; Querystring: { t?: string } }>(
    "/page/:slug",
    async (request, reply) => {
      const { slug } = request.params;
      const { t } = request.query;

      if (!t) {
        return reply.status(401).type("text/plain").send("Missing token");
      }

      const verify = verifyToken(t, slug);
      if (!verify.ok) {
        const msg =
          verify.reason === "expired"
            ? "Link expired. Ask jpOS for a new one."
            : "Invalid link";
        return reply.status(401).type("text/plain").send(msg);
      }

      const page = loadPage(slug);
      if (!page) {
        return reply.status(404).type("text/plain").send("Page not found");
      }

      return reply
        .header("Cache-Control", "private, max-age=300")
        .type("text/html; charset=utf-8")
        .send(renderPage(page));
    },
  );
}
