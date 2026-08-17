import { describe, expect, it } from "vitest";
import { HashingEmbedder, vectorToSql } from "./embeddings.js";

describe("HashingEmbedder", () => {
  it("returns unit-normalized vectors", () => {
    const e = new HashingEmbedder(128);
    const v = e.embed("AWS access key detected in production code");
    expect(v).toHaveLength(128);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it("is deterministic", () => {
    const e = new HashingEmbedder(256);
    const a = e.embed("lodash prototype pollution CVE-2021-23337");
    const b = e.embed("lodash prototype pollution CVE-2021-23337");
    expect(a).toEqual(b);
  });

  it("different texts have non-zero distance", () => {
    const e = new HashingEmbedder(256);
    const a = e.embed("aws access key leaked");
    const b = e.embed("lodash prototype pollution");
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
    expect(dot).toBeLessThan(1);
  });

  it("rejects non-positive or odd dimensions", () => {
    expect(() => new HashingEmbedder(0)).toThrow();
    expect(() => new HashingEmbedder(-1)).toThrow();
    expect(() => new HashingEmbedder(3)).toThrow();
  });

  it("vectorToSql formats pgvector literal", () => {
    expect(vectorToSql([1, 2, 3])).toBe("[1.00000000,2.00000000,3.00000000]");
    expect(vectorToSql([0.123456789])).toBe("[0.12345679]");
  });

  it("vectorToSql rejects non-finite values", () => {
    expect(() => vectorToSql([NaN])).toThrow();
    expect(() => vectorToSql([Infinity])).toThrow();
  });
});
