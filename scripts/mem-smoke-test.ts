/**
 * End-to-end smoke test for the mem0 + Qdrant memory store.
 *
 * Prereqs:
 *   1. Qdrant running on localhost:6333
 *      docker run -d --name jpos-qdrant-test -p 6333:6333 -p 6334:6334 \
 *        -v $(pwd)/.qdrant-data:/qdrant/storage qdrant/qdrant
 *   2. OPENAI_API_KEY set (in .env or shell env)
 *
 * Run:
 *   npx tsx scripts/mem-smoke-test.ts
 */

import { config } from "dotenv";
import {
  remember,
  recall,
  listMemories,
  forget,
  COLLECTION_NAME,
  JPOS_USER_ID,
} from "../src/memory-store.js";

config();

function divider(title: string) {
  console.log(`\n${"=".repeat(60)}\n${title}\n${"=".repeat(60)}`);
}

async function main() {
  console.log(`Collection: ${COLLECTION_NAME}`);
  console.log(`User ID:    ${JPOS_USER_ID}`);
  console.log(`Qdrant URL: ${process.env.QDRANT_URL || "http://localhost:6333 (default)"}`);
  console.log(`LLM model:  ${process.env.MEM0_LLM_MODEL || "gpt-4.1-nano (default)"}`);

  // --- 1. Write a couple memories ----------------------------------------
  divider("1. remember() — store a few facts");

  const r1 = await remember({
    content: "I prefer dark mode in all my apps. Bright white screens hurt my eyes.",
    source: "smoke-test",
    category: "preference",
  });
  console.log(`Wrote ${r1.length} memories from preference note:`);
  r1.forEach((m) => console.log(`  [${m.id.slice(0, 8)}] ${m.memory}`));

  const r2 = await remember({
    content:
      "Working on jpOS — my personal AI agent on Fly.io with Telegram + HTTP interfaces. " +
      "Currently rebuilding the memory layer around mem0 + Qdrant.",
    source: "smoke-test",
    category: "project",
  });
  console.log(`\nWrote ${r2.length} memories from project note:`);
  r2.forEach((m) => console.log(`  [${m.id.slice(0, 8)}] ${m.memory}`));

  const r3 = await remember({
    content: "I drink black coffee every morning, no sugar, no milk.",
    source: "smoke-test",
    category: "preference",
  });
  console.log(`\nWrote ${r3.length} memories from coffee note:`);
  r3.forEach((m) => console.log(`  [${m.id.slice(0, 8)}] ${m.memory}`));

  // --- 2. Search ----------------------------------------------------------
  divider("2. recall() — semantic search");

  const query1 = "what are my UI preferences?";
  console.log(`Query: "${query1}"`);
  const search1 = await recall({ query: query1, topK: 3 });
  search1.forEach((m) =>
    console.log(`  (score=${m.score?.toFixed(3) ?? "?"}) [${m.id.slice(0, 8)}] ${m.memory}`),
  );

  const query2 = "what am I building right now?";
  console.log(`\nQuery: "${query2}"`);
  const search2 = await recall({ query: query2, topK: 3 });
  search2.forEach((m) =>
    console.log(`  (score=${m.score?.toFixed(3) ?? "?"}) [${m.id.slice(0, 8)}] ${m.memory}`),
  );

  // --- 3. Filter by source/category --------------------------------------
  divider("3. recall() with category filter");

  const query3 = "what do I like?";
  console.log(`Query: "${query3}", filter: category=preference`);
  const search3 = await recall({
    query: query3,
    topK: 5,
    filters: { category: "preference" },
  });
  search3.forEach((m) =>
    console.log(`  (score=${m.score?.toFixed(3) ?? "?"}) [${m.id.slice(0, 8)}] ${m.memory}`),
  );

  // --- 4. List all --------------------------------------------------------
  divider("4. listMemories() — browse all");

  const all = await listMemories({ limit: 20 });
  console.log(`Total: ${all.length} memories`);
  all.forEach((m) =>
    console.log(`  [${m.id.slice(0, 8)}] (${m.metadata?.category ?? "—"}) ${m.memory}`),
  );

  // --- 5. Delete one ------------------------------------------------------
  divider("5. forget() — delete a memory");

  if (all.length > 0) {
    const target = all[0];
    console.log(`Deleting: [${target.id.slice(0, 8)}] ${target.memory}`);
    await forget(target.id);
    const afterDelete = await listMemories({ limit: 20 });
    console.log(`After delete: ${afterDelete.length} memories remaining`);
  }

  divider("Done");
  console.log("All operations completed successfully.\n");
}

main().catch((err) => {
  console.error("\n[FAILED]", err);
  process.exit(1);
});
