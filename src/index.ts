import { Command } from "@langchain/langgraph";
import { compileAgent } from "./graph/index.js";
import { HashingEmbedder } from "./embeddings.js";
import { createMemoryStore } from "./db/pglite.js";
import { FileCheckpointSaver } from "./db/file_checkpointer.js";
import { createLLM, type LocalLLM } from "./llm.js";
import { resolve, isAbsolute } from "node:path";
import { mkdir } from "node:fs/promises";

interface CliArgs {
  target: string;
  llm: "mock" | "llama";
  reportDir: string;
  dataDir: string;
  stateDir: string;
  resume: string | null;
  threadId: string;
  decision: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          args[a.slice(2)] = next;
          i++;
        } else {
          args[a.slice(2)] = "true";
        }
      }
    }
  }
  const target = args.target;
  if (!target) {
    throw new Error("--target <path> is required");
  }
  const llmRaw = (args["llm"] ?? "mock").toLowerCase();
  if (llmRaw !== "mock" && llmRaw !== "llama") {
    throw new Error(`--llm must be 'mock' or 'llama', got '${llmRaw}'`);
  }
  return {
    target: isAbsolute(target) ? target : resolve(process.cwd(), target),
    llm: llmRaw,
    reportDir: args["report-dir"] ?? "./reports",
    dataDir: args["data-dir"] ?? "./agent_memory_data",
    stateDir: args["state-dir"] ?? "./.agent_state",
    resume: args.resume ?? null,
    threadId: args["thread-id"] ?? `session-${Date.now()}`,
    decision: args.decision ?? null,
  };
}

function formatInterrupt(i: unknown): string {
  try {
    const obj = typeof i === "string" ? JSON.parse(i) : (i as any)?.value ?? i;
    if (obj && typeof obj === "object" && "kind" in obj) {
      return JSON.stringify(obj, null, 2);
    }
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(i);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.reportDir, { recursive: true });
  await mkdir(args.dataDir, { recursive: true });
  await mkdir(args.stateDir, { recursive: true });

  const embedder = new HashingEmbedder(1536);
  const store = await createMemoryStore({ dataDir: args.dataDir, embedder });
  await store.init();

  const llm: LocalLLM = createLLM(args.llm);
  const checkpointer = new FileCheckpointSaver({ dataDir: args.stateDir });
  const app = compileAgent(
    { llm, embedder, store, reportDir: args.reportDir },
    checkpointer,
  );

  const config = { configurable: { thread_id: args.threadId } };
  let result: any;
  if (args.resume) {
    result = await app.invoke(new Command({ resume: args.resume }), config);
  } else {
    result = await app.invoke({ targetDirectory: args.target }, config);
  }

  if (result && Array.isArray(result.__interrupt__) && result.__interrupt__.length > 0) {
    console.error("\n[INTERRUPT] human approval required:");
    for (const i of result.__interrupt__) {
      console.error(formatInterrupt(i));
    }
    console.error(`\nResume with: edge-agent --target "${args.target}" --resume <approve|reject> --thread-id "${args.threadId}"`);
    process.exit(2);
  }

  console.log("\n=== SUMMARY ===");
  console.log(`target:           ${result.targetDirectory}`);
  console.log(`plan:             ${result.plan?.rationale ?? "n/a"}`);
  console.log(`findings:         ${result.rawFindings.length}`);
  console.log(`wiki hits:        ${result.wikiContext.length}`);
  console.log(`injection halt:   ${result.injectionHalt}`);
  console.log(`report path:      ${result.finalReportPath || "(not produced)"}`);
  if (result.scanTrace.length > 0) {
    console.log(`\ntrace:`);
    for (const t of result.scanTrace) console.log(`  - ${t}`);
  }

  await store.close();
}

main().catch((err) => {
  console.error(`edge-agent failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
