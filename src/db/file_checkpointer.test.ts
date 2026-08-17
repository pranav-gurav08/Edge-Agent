import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateGraph, Annotation, START, END, Command, interrupt } from "@langchain/langgraph";
import { FileCheckpointSaver } from "./file_checkpointer.js";

describe("FileCheckpointSaver", () => {
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "edge-fcs-"));
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("persists checkpoints across instances for cross-process resume", async () => {
    const State = Annotation.Root({
      count: Annotation<number>({ reducer: (x, y) => (x ?? 0) + (y ?? 0), default: () => 0 }),
    });
    const g = new StateGraph(State)
      .addNode("inc", (s: any) => ({ count: s.count + 1 }))
      .addNode("check", (s: any) => {
        interrupt({ when: "check", count: s.count });
        return { count: s.count + 1 };
      })
      .addEdge(START, "inc")
      .addEdge("inc", "check")
      .addConditionalEdges("check", (s: any) => (s.count >= 3 ? END : "inc"));

    const fcs1 = new FileCheckpointSaver({ dataDir: workDir });
    const app1 = g.compile({ checkpointer: fcs1 });
    const r1: any = await app1.invoke({ count: 0 }, { configurable: { thread_id: "x1" } });
    expect(r1.__interrupt__?.length).toBe(1);

    const fcs2 = new FileCheckpointSaver({ dataDir: workDir });
    const app2 = g.compile({ checkpointer: fcs2 });
    const r2: any = await app2.invoke(new Command({ resume: "approve" }), { configurable: { thread_id: "x1" } });
    expect(r2.count).toBe(3);
  });

  it("deleteThread removes stored checkpoints", async () => {
    const fcs = new FileCheckpointSaver({ dataDir: workDir });
    await fcs.deleteThread("x1");
    const list: string[] = [];
    for await (const cp of fcs.list({ configurable: { thread_id: "x1" } })) list.push(cp.checkpoint.id);
    expect(list).toEqual([]);
  });
});
