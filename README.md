# Edge-Native Cybersecurity Agent

Edge-native TypeScript/Node.js security agent orchestrating **Gitleaks**, **Trivy**, and **SonarScanner** via **LangGraph.js** with a **PGlite + pgvector** local knowledge wiki. Zero cloud dependencies. Pure local inference (Llama.cpp / WebLLM).

See `.artifact/Edge Cyber Security Agent Design.md` for the full architectural specification and `AGENTS.md` for agent conventions.

## Quick start

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

## CLI

```bash
npm run dev -- --target /path/to/repo --llm mock
# --llm llama (requires a local llama.cpp OpenAI-compatible server on :8080)

# Cross-process HITL resume:
#   first invocation: produces interrupt + resume command
#   second invocation: --resume approve | reject --thread-id <id>
npm run dev -- --target /path/to/repo --resume approve --thread-id demo
```

CLI flags:
- `--target <path>` — repository root to scan (required)
- `--llm mock|llama` — inference backend (default: mock)
- `--report-dir <path>` — markdown report output (default `./reports`)
- `--data-dir <path>` — PGlite wiki persistence (default `./agent_memory_data`)
- `--state-dir <path>` — checkpoint persistence (default `./.agent_state`)
- `--thread-id <id>` — session id for HITL resume (default: `session-<ts>`)
- `--resume approve|reject` — resume a paused run after HITL interrupt

Environment variables:
- `LANGGRAPH_STRICT_MSGPACK=true` — recommended hardening
- `LLAMA_BASE_URL`, `LLAMA_MODEL` — local llama.cpp endpoint
- `EDGE_FAKE_SCAN_DIR=<dir>` — feed canned scanner JSON (`gitleaks.json`, `trivy.json`, `sonarqube.json`) instead of running real binaries
- `EDGE_FORCE_FIXTURES=1` — force fixture mode even when real binaries are present (used by tests + harness)

## Graph engineering loop harness

`harness/index.ts` provides subcommands for deterministic iteration on graph behavior:

```bash
npm run harness -- status                          # scanner binary availability
npm run harness -- inspect --target <path>         # target_discovery only
npm run harness -- run     --target <path>         # full graph end-to-end (pauses at HITL)
npm run harness -- trace   --target <path> --out <file>   # run + auto-approve + dump JSON trace
npm run harness -- hitl    --target <path> [--reject]     # run + auto-approve/reject interrupts
npm run harness -- step    --target <path>         # stream-mode per-node inspection
```

The harness is the primary tool for **graph engineering**: replay any run deterministically, inspect state at each node, exercise interrupt/resume paths, and persist JSON traces for regression comparison.

## Graph architecture

```
START → orchestrator ──► gitleaks ──┐
                       ─► trivy ────┼─► triage_node ─► remediation (interrupt) ─► report ─► END
                       ─► sonarqube ┘         │
                                            └─► halt ─► END       (if injection)
```

- **State**: `Annotation.Root` with custom reducers (append, last-writer-wins). See `src/state.ts`.
- **Tools**: Zod-validated `@langchain/core/tools`. See `src/tools/`.
- **Vector DB**: PGlite + pgvector, HNSW index, `entity_slug` accumulates (append, never overwrite). See `src/db/pglite.ts`.
- **Embeddings**: deterministic hashing embedder (FNV-1a, bigram buckets, 1536-dim by default). See `src/embeddings.ts`.
- **Checkpointer**: `FileCheckpointSaver` (JSON files under `.agent_state/threads/<thread_id>/`) for durable, cross-process HITL resume.
- **Remediation interrupt**: `interrupt({ kind: "remediation_approval", ... })` — resume via `Command({ resume: "approve" | "reject" })`.

## Security hardening

- **Prompt injection**: scan finding descriptions for indirect-injection patterns; if any match, the agent halts (no LLM call on tainted data). See `src/prompt_injection.ts`.
- **Scanned data wrapped in `<scanned_data>` XML** before being passed to the LLM. System prompt instructs the model to treat it as passive.
- **No raw shell**: scanner tools go through Zod-typed wrappers; only `execAsync` of known binary names with strict args.
- **Checkpointer deserialization**: hardened via `LANGGRAPH_STRICT_MSGPACK=true`; `FileCheckpointSaver` writes plain JSON (no msgpack/pickle surface).
- **Local-only inference**: code never leaves the device; no cloud APIs.

## Test fixture run (no scanners required)

```bash
EDGE_FAKE_SCAN_DIR=$(pwd)/test/fixtures/scans EDGE_FORCE_FIXTURES=1 npm test
EDGE_FAKE_SCAN_DIR=$(pwd)/test/fixtures/scans EDGE_FORCE_FIXTURES=1 \
  npm run harness -- hitl --target test/fixtures/target-repo
```

The fixture repo at `test/fixtures/target-repo/` contains a Node project with vulnerable dependency versions, a Dockerfile, a `.env` with example secrets, and a server.js with a hardcoded JWT secret. The fixture scans under `test/fixtures/scans/` provide canned Gitleaks/Trivy/SonarScanner JSON output.

## WSL delivery

Run `scripts/wsl-bootstrap.sh` inside an Ubuntu WSL distribution to install Node.js 20, npm dependencies, run the full typecheck/lint/test suite, and exercise the harness end-to-end with deterministic fixtures. See `scripts/wsl-bootstrap.sh`.
