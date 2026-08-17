import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MemorySaver, Command } from "@langchain/langgraph";
import { compileAgent } from "./index.js";
import { HashingEmbedder } from "../embeddings.js";
import { createMemoryStore } from "../db/pglite.js";
import { MockLLM } from "../llm.js";

const FIXTURE = resolve("test/fixtures/target-repo");
const FAKE_SCANS = resolve("test/fixtures/scans");

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "edge-agent-flow-"));
  process.env.EDGE_FAKE_SCAN_DIR = FAKE_SCANS;
  process.env.EDGE_FORCE_FIXTURES = "1";
});

afterAll(() => {
  delete process.env.EDGE_FAKE_SCAN_DIR;
  delete process.env.EDGE_FORCE_FIXTURES;
  rmSync(workDir, { recursive: true, force: true });
});

async function buildEnv(threadId: string) {
  const embedder = new HashingEmbedder(64);
  const store = await createMemoryStore({ inMemory: true, embedder });
  await store.init();
  const llm = new MockLLM();
  const app = compileAgent(
    { llm, embedder, store, reportDir: join(workDir, threadId, "reports") },
    new MemorySaver(),
  );
  return { app, store, embedder, llm };
}

describe("graph end-to-end flow", () => {
  it("orchestrator -> scanners -> triage -> report produces markdown + wiki entries", async () => {
    const { app, store } = await buildEnv("flow-1");
    const config = { configurable: { thread_id: "flow-1" } };
    const result = await app.invoke({ targetDirectory: FIXTURE }, config);
    expect(result.injectionHalt).toBe(false);
    expect(result.rawFindings.length).toBeGreaterThan(0);
    expect(result.triage).toBeTruthy();
    expect(result.plan).toBeTruthy();
    expect(result.plan!.tools).toEqual(expect.arrayContaining(["gitleaks", "trivy", "sonarqube"]));
    expect(result.scanTrace.length).toBeGreaterThan(0);
    expect(result.synthesisComplete).toBe(true);
    await store.close();
  });

  it("report path is set when graph reaches report node (no remediation candidates)", async () => {
    const cleanDir = mkdtempSync(join(tmpdir(), "edge-clean-"));
    try {
      process.env.EDGE_FAKE_SCAN_DIR = FAKE_SCANS;
      process.env.EDGE_FORCE_FIXTURES = "1";
      const embedder = new HashingEmbedder(64);
      const store = await createMemoryStore({ inMemory: true, embedder });
      await store.init();
      const llm = new MockLLM();
      const app = compileAgent(
        { llm, embedder, store, reportDir: join(cleanDir, "reports") },
        new MemorySaver(),
      );

      const empty = mkdtempSync(join(tmpdir(), "edge-empty-"));
      const result = await app.invoke({ targetDirectory: empty }, { configurable: { thread_id: "clean-1" } });
      expect(result.injectionHalt).toBe(false);
      expect(result.scanTrace.some((t: string) => t.startsWith("orchestrator:plan=none"))).toBe(true);
      expect(result.scanTrace.some((t: string) => t.startsWith("report:path="))).toBe(true);
      expect(result.synthesisComplete).toBe(true);

      await store.close();
      rmSync(empty, { recursive: true, force: true });
    } finally {
      delete process.env.EDGE_FAKE_SCAN_DIR;
      delete process.env.EDGE_FORCE_FIXTURES;
      rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  it("HITL interrupt/resume approves remediation when triage lists candidates", async () => {
    process.env.EDGE_FAKE_SCAN_DIR = FAKE_SCANS;
    process.env.EDGE_FORCE_FIXTURES = "1";
    const work = mkdtempSync(join(tmpdir(), "edge-hitl-"));
    try {
      const embedder = new HashingEmbedder(64);
      const store = await createMemoryStore({ inMemory: true, embedder });
      await store.init();
      const llm = new MockLLM();
      const app = compileAgent(
        { llm, embedder, store, reportDir: join(work, "reports") },
        new MemorySaver(),
      );
      const config = { configurable: { thread_id: "hitl-1" } };

      const cleanDir = mkdtempSync(join(tmpdir(), "edge-clean-"));
      const cleanRepo = join(cleanDir, "pkg-only");
      mkdirSync(cleanRepo, { recursive: true });
      writeFileSync(join(cleanRepo, "package.json"), '{"name":"x","version":"1.0.0","dependencies":{"lodash":"4.17.20"}}');

      let result: any = await app.invoke({ targetDirectory: cleanRepo }, config);
      if (Array.isArray(result.__interrupt__) && result.__interrupt__.length > 0) {
        result = await app.invoke(new Command({ resume: "approve" }), config);
      }
      expect(result.synthesisComplete).toBe(true);
      expect(result.scanTrace.some((t: string) => t.startsWith("remediation:decision="))).toBe(true);

      await store.close();
      rmSync(cleanDir, { recursive: true, force: true });
    } finally {
      delete process.env.EDGE_FAKE_SCAN_DIR;
      delete process.env.EDGE_FORCE_FIXTURES;
      rmSync(work, { recursive: true, force: true });
    }
  });

  it("rejects remediation on interrupt resume", async () => {
    process.env.EDGE_FAKE_SCAN_DIR = FAKE_SCANS;
    process.env.EDGE_FORCE_FIXTURES = "1";
    const work = mkdtempSync(join(tmpdir(), "edge-hitl-rej-"));
    try {
      const embedder = new HashingEmbedder(64);
      const store = await createMemoryStore({ inMemory: true, embedder });
      await store.init();
      const llm = new MockLLM();
      const app = compileAgent(
        { llm, embedder, store, reportDir: join(work, "reports") },
        new MemorySaver(),
      );
      const config = { configurable: { thread_id: "hitl-rej" } };

      const cleanDir = mkdtempSync(join(tmpdir(), "edge-clean-rej-"));
      const cleanRepo = join(cleanDir, "pkg-only");
      mkdirSync(cleanRepo, { recursive: true });
      writeFileSync(join(cleanRepo, "package.json"), '{"name":"x","version":"1.0.0","dependencies":{"axios":"0.18.0"}}');

      let result: any = await app.invoke({ targetDirectory: cleanRepo }, config);
      if (Array.isArray(result.__interrupt__) && result.__interrupt__.length > 0) {
        result = await app.invoke(new Command({ resume: "reject" }), config);
      }
      expect(result.scanTrace.some((t: string) => t === "remediation:decision=reject")).toBe(true);
      await store.close();
      rmSync(cleanDir, { recursive: true, force: true });
    } finally {
      delete process.env.EDGE_FAKE_SCAN_DIR;
      delete process.env.EDGE_FORCE_FIXTURES;
      rmSync(work, { recursive: true, force: true });
    }
  });

  it("halts when indirect prompt injection is detected in finding content", async () => {
    process.env.EDGE_FAKE_SCAN_DIR = resolve("test/fixtures/scans-injection");
    process.env.EDGE_FORCE_FIXTURES = "1";
    const work = mkdtempSync(join(tmpdir(), "edge-injection-"));
    try {
      const embedder = new HashingEmbedder(64);
      const store = await createMemoryStore({ inMemory: true, embedder });
      await store.init();
      const llm = new MockLLM();
      const app = compileAgent(
        { llm, embedder, store, reportDir: join(work, "reports") },
        new MemorySaver(),
      );
      const config = { configurable: { thread_id: "injection-1" } };

      const result: any = await app.invoke({ targetDirectory: FIXTURE }, config);
      expect(result.injectionHalt).toBe(true);
      expect(result.triage?.injectionIncidents.length).toBeGreaterThan(0);
      expect(result.scanTrace.some((t: string) => t === "triage:halt=true")).toBe(true);
      expect(result.scanTrace.some((t: string) => t.startsWith("halt:"))).toBe(true);
      await store.close();
    } finally {
      delete process.env.EDGE_FAKE_SCAN_DIR;
      delete process.env.EDGE_FORCE_FIXTURES;
      rmSync(work, { recursive: true, force: true });
    }
  });
});
