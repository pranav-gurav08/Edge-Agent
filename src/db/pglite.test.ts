import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./pglite.js";
import { HashingEmbedder } from "../embeddings.js";

describe("PGlite memory store", () => {
  it("initialises schema and indexes", async () => {
    const e = new HashingEmbedder(64);
    const store = await createMemoryStore({ inMemory: true, embedder: e });
    await store.init();
    const count = await store.countWiki();
    expect(count).toBe(0);
    await store.close();
  });

  it("upsert appends (does not overwrite) and supports similarity search", async () => {
    const e = new HashingEmbedder(64);
    const store = await createMemoryStore({ inMemory: true, embedder: e });
    await store.init();
    const v1 = e.embed("AWS access key found in production");
    const v2 = e.embed("lodash prototype pollution cve");
    const v3 = e.embed("sql injection in user input");
    await store.upsertWiki("aws", "AWS keys leak in env file", v1);
    await store.upsertWiki("aws", "Additional AWS context (run 2)", v1);
    await store.upsertWiki("lodash", "Prototype pollution in lodash 4.17.20", v2);
    await store.upsertWiki("sqli", "SQL injection risk in search endpoint", v3);

    expect(await store.countWiki()).toBe(4);

    const hits = await store.searchWiki(e.embed("AWS secret key exposure"), 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.entitySlug.startsWith("aws")).toBe(true);

    await store.close();
  });
});
