import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../db/pglite.js";
import { HashingEmbedder } from "../embeddings.js";
import { makeWikiTools } from "./wiki.js";

describe("wiki tools", () => {
  it("upsert appends new rows; query returns similarity-ranked results", async () => {
    const e = new HashingEmbedder(64);
    const store = await createMemoryStore({ inMemory: true, embedder: e });
    await store.init();
    const { queryWiki, updateWiki } = makeWikiTools(store, e);

    await updateWiki.invoke({ entitySlug: "gitleaks:aws", content: "AWS keys leak via env file" });
    await updateWiki.invoke({ entitySlug: "gitleaks:aws", content: "AWS keys also seen in CI yml" });
    await updateWiki.invoke({ entitySlug: "trivy:cve-2020-7598", content: "minimist prototype pollution" });

    const hits = (await queryWiki.invoke({ query: "AWS access key leaked", limit: 3 })) as string;
    const parsed = JSON.parse(hits);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].entitySlug).toBeDefined();
    expect(typeof parsed[0].similarity).toBe("number");

    await store.close();
  });
});
