import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { MemoryStore } from "../db/pglite.js";
import type { Embedder } from "../embeddings.js";

export const QueryWikiSchema = z.object({
  query: z.string().describe("Free-text query describing the vulnerability or pattern"),
  limit: z.number().int().min(1).max(20).default(5),
});

export const UpdateWikiSchema = z.object({
  entitySlug: z.string().describe("Stable slug for the finding or pattern, e.g. 'gitleaks:aws-access-token'"),
  content: z.string().describe("Markdown content describing the finding and its resolution"),
});

export function makeWikiTools(store: MemoryStore, embedder: Embedder) {
  const queryWiki = tool(
    async (input) => {
      const embedding = embedder.embed(input.query);
      const hits = await store.searchWiki(embedding, input.limit);
      return JSON.stringify(hits);
    },
    {
      name: "query_knowledge_wiki",
      description: "Queries the local PGlite vector wiki for previously seen findings or remediation patterns similar to the given query. Returns top-k with similarity scores.",
      schema: QueryWikiSchema,
    },
  );

  const updateWiki = tool(
    async (input) => {
      const embedding = embedder.embed(`${input.entitySlug} ${input.content}`);
      const id = await store.upsertWiki(input.entitySlug, input.content, embedding);
      return JSON.stringify({ ok: true, id });
    },
    {
      name: "update_knowledge_wiki",
      description: "Appends a new entry to the local PGlite vector wiki. Knowledge accumulates; prior entries are not overwritten.",
      schema: UpdateWikiSchema,
    },
  );

  return { queryWiki, updateWiki };
}
