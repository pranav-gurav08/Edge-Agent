import { Command, MemorySaver } from "@langchain/langgraph";
import { compileAgent } from "../src/graph/index.js";
import { HashingEmbedder } from "../src/embeddings.js";
import { createMemoryStore, type MemoryStore } from "../src/db/pglite.js";
import { createLLM } from "../src/llm.js";
import { discoverTarget } from "../src/tools/target_discovery.js";
import { hasBinary } from "../src/tools/exec.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, isAbsolute, join } from "node:path";

interface HarnessOpts {
  target: string;
  llm: "mock" | "llama";
  dataDir: string;
  reportDir: string;
  threadId: string;
  inMemory: boolean;
}

function parseOpts(argv: string[]): { command: string; opts: Partial<HarnessOpts>; flags: Set<string> } {
  const command = argv[0] ?? "help";
  const opts: Partial<HarnessOpts> & Record<string, string | boolean | undefined> = {};
  const flags = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        opts[key] = true;
        flags.add(key);
      } else {
        opts[key] = next;
        i++;
      }
    }
  }
  if (typeof opts.target === "string" && !isAbsolute(opts.target)) {
    opts.target = resolve(process.cwd(), opts.target);
  }
  opts.dataDir = opts.dataDir ? (isAbsolute(opts.dataDir as string) ? opts.dataDir : resolve(process.cwd(), opts.dataDir as string)) as string : "./agent_memory_data";
  opts.reportDir = opts.reportDir ? (isAbsolute(opts.reportDir as string) ? opts.reportDir : resolve(process.cwd(), opts.reportDir as string)) as string : "./reports";
  opts.llm = (opts.llm === "llama" ? "llama" : "mock") as "mock" | "llama";
  opts.threadId = (opts.threadId as string) ?? `harness-${Date.now()}`;
  return { command, opts: opts as HarnessOpts, flags };
}

async function ensureStore(opts: HarnessOpts, reset = false): Promise<{ store: MemoryStore; embedder: HashingEmbedder }> {
  const embedder = new HashingEmbedder(1536);
  if (reset) await rm(opts.dataDir, { recursive: true, force: true });
  const store = await createMemoryStore({ dataDir: opts.dataDir, embedder });
  await store.init();
  return { store, embedder };
}

async function statusCommand(): Promise<void> {
  const bins = ["gitleaks", "trivy", "sonar-scanner"];
  console.log("== binary availability ==");
  for (const b of bins) {
    console.log(`  ${b.padEnd(15)} ${(await hasBinary(b)) ? "available" : "missing"}`);
  }
  console.log("== runtime ==");
  console.log(`  node           ${process.version}`);
  console.log(`  platform       ${process.platform}/${process.arch}`);
}

async function inspectCommand(opts: HarnessOpts): Promise<void> {
  if (!opts.target) throw new Error("--target required for inspect");
  const r = await discoverTarget(opts.target);
  console.log(JSON.stringify(r, null, 2));
}

async function buildApp(opts: HarnessOpts, reset = false) {
  const { store, embedder } = await ensureStore(opts, reset);
  const llm = createLLM(opts.llm);
  const app = compileAgent(
    { llm, embedder, store, reportDir: opts.reportDir },
    new MemorySaver(),
  );
  return { app, store, embedder, llm };
}

async function runCommand(opts: HarnessOpts, flags: Set<string>): Promise<void> {
  if (!opts.target) throw new Error("--target required for run");
  await mkdir(opts.reportDir, { recursive: true });
  const { app, store } = await buildApp(opts, !flags.has("keep-state"));
  const config = { configurable: { thread_id: opts.threadId } };
  const result = await app.invoke({ targetDirectory: opts.target }, config);
  printSummary(result);
  await store.close();
}

async function traceCommand(opts: HarnessOpts, flags: Set<string>): Promise<void> {
  if (!opts.target) throw new Error("--target required for trace");
  await mkdir(opts.reportDir, { recursive: true });
  const { app, store } = await buildApp(opts, !flags.has("keep-state"));
  const config = { configurable: { thread_id: opts.threadId } };
  let result: any = await app.invoke({ targetDirectory: opts.target }, config);
  while (result && Array.isArray(result.__interrupt__) && result.__interrupt__.length > 0) {
    result = await app.invoke(new Command({ resume: "approve" }), config);
  }
  const explicitOut = (opts as any).out;
  const tracePath = typeof explicitOut === "string" && explicitOut.length > 0
    ? explicitOut
    : join(opts.reportDir, `trace-${opts.threadId}.json`);
  await mkdir(resolve(tracePath, ".."), { recursive: true });
  await writeFile(tracePath, JSON.stringify(result, null, 2), "utf8");
  console.log(`trace written: ${tracePath}`);
  await store.close();
}

async function hitlCommand(opts: HarnessOpts, flags: Set<string>): Promise<void> {
  if (!opts.target) throw new Error("--target required for hitl");
  await mkdir(opts.reportDir, { recursive: true });
  const { app, store } = await buildApp(opts, !flags.has("keep-state"));
  const config = { configurable: { thread_id: opts.threadId } };
  let result: any = await app.invoke({ targetDirectory: opts.target }, config);

  let resumes = 0;
  while (result && Array.isArray(result.__interrupt__) && result.__interrupt__.length > 0 && resumes < 5) {
    console.log(`\n[interrupt #${resumes + 1}] ${result.__interrupt__.length} pending`);
    const decision = (opts as any).decision === "reject" || flags.has("reject") ? "reject" : "approve";
    console.log(`[harness] auto-decision: ${decision}`);
    result = await app.invoke(new Command({ resume: decision }), config);
    resumes++;
  }
  printSummary(result);
  await store.close();
}

async function stepCommand(opts: HarnessOpts, flags: Set<string>): Promise<void> {
  if (!opts.target) throw new Error("--target required for step");
  await mkdir(opts.reportDir, { recursive: true });
  const { app, store } = await buildApp(opts, !flags.has("keep-state"));
  const config = { configurable: { thread_id: opts.threadId } };

  const stages: Array<{ name: string; input: any }> = [
    { name: "orchestrator", input: { targetDirectory: opts.target } },
    { name: "gitleaks", input: { targetDirectory: opts.target } },
    { name: "trivy", input: { targetDirectory: opts.target } },
    { name: "sonarqube", input: { targetDirectory: opts.target } },
    { name: "triage", input: { targetDirectory: opts.target } },
    { name: "report", input: { targetDirectory: opts.target } },
  ];

  for (const s of stages) {
    const stream = await app.stream(s.input, { ...config, streamMode: "values" });
    let last: any;
    for await (const chunk of stream) last = chunk;
    console.log(`\n[step:${s.name}] final state keys: ${last ? Object.keys(last).join(",") : "(none)"}`);
    if (last?.rawFindings) console.log(`  findings=${last.rawFindings.length}`);
    if (last?.scanTrace) console.log(`  trace=${JSON.stringify(last.scanTrace)}`);
    if (last?.__interrupt__) console.log(`  interrupts=${last.__interrupt__.length}`);
  }

  await store.close();
}

function printSummary(result: any): void {
  console.log("\n=== SUMMARY ===");
  console.log(`target:           ${result.targetDirectory}`);
  console.log(`plan:             ${result.plan?.rationale ?? "n/a"}`);
  console.log(`findings:         ${result.rawFindings.length}`);
  console.log(`wiki hits:        ${result.wikiContext.length}`);
  console.log(`injection halt:   ${result.injectionHalt}`);
  console.log(`report path:      ${result.finalReportPath || "(not produced)"}`);
  if (Array.isArray(result.__interrupt__) && result.__interrupt__.length > 0) {
    console.log(`interrupts:       ${result.__interrupt__.length} pending`);
  }
  if (result.scanTrace?.length > 0) {
    console.log(`\ntrace:`);
    for (const t of result.scanTrace) console.log(`  - ${t}`);
  }
}

function helpCommand(): void {
  console.log(`edge harness — graph engineering loop harness

commands:
  status                          Check scanner binary availability
  inspect --target <dir>          Run target_discovery only
  run     --target <dir>          Run the full graph end-to-end
  trace   --target <dir> --out <file>   Run and write JSON trace
  hitl    --target <dir> [--reject]     Run with HITL auto-resume (approve | reject)
  step    --target <dir>          Run each node individually, stream-mode

options:
  --llm mock|llama               (default: mock)
  --data-dir <path>              (default: ./agent_memory_data)
  --report-dir <path>            (default: ./reports)
  --thread-id <id>               (default: harness-<ts>)
  --keep-state                   Don't reset the data dir before running
`);
}

async function main(): Promise<void> {
  const { command, opts, flags } = parseOpts(process.argv.slice(2));
  switch (command) {
    case "status":
      await statusCommand();
      break;
    case "inspect":
      await inspectCommand(opts as HarnessOpts);
      break;
    case "run":
      await runCommand(opts as HarnessOpts, flags);
      break;
    case "trace":
      await traceCommand(opts as HarnessOpts, flags);
      break;
    case "hitl":
      await hitlCommand(opts as HarnessOpts, flags);
      break;
    case "step":
      await stepCommand(opts as HarnessOpts, flags);
      break;
    case "help":
    case "--help":
    case "-h":
    default:
      helpCommand();
  }
}

main().catch((err) => {
  console.error(`harness failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
