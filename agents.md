# AGENTS.md — Edge-Native Cybersecurity Agent

## Project Overview
TypeScript/Node.js edge-native security agent orchestrating Gitleaks, Trivy, SonarScanner via LangGraph.js with PGlite+pgvector local vector DB. Zero cloud dependencies.

## Core Stack
- **Runtime**: Node.js 20+, TypeScript (strict mode), ESM
- **Orchestration**: LangGraph.js 1.x (`@langchain/langgraph`), `Annotation.Root`, `Send` fan-out, `interrupt()` HITL, `FileCheckpointSaver`
- **Inference**: `MockLLM` (deterministic, tests) / `LlamaCppLLM` (OpenAI-compatible, local) — see `src/llm.ts`
- **Vector DB**: PGlite (`@electric-sql/pglite`) + `@electric-sql/pglite-pgvector`; HNSW cosine, `entity_slug` accumulates (no overwrite)
- **Scanners**: Gitleaks (CLI, `--no-git` for non-git dirs), Trivy (CLI, secrets+vulns+misconfigs), SonarScanner (requires SonarQube server)

## Architecture Patterns

### Tool Wrappers (`src/tools/`)
- Each scanner = one `@langchain/core/tools` tool with Zod input/output schemas. See `src/tools/{gitleaks,trivy,sonarqube,target_discovery,wiki}.ts`.
- `execAsync` runs the binary; raw JSON is parsed + compressed by `src/tools/compress.ts` (dedupe by rule+file, severity normalization, secrets/misconfig/vuln flattening).
- Fixture fallback: when the binary is missing OR `EDGE_FORCE_FIXTURES=1`, the tool reads `${EDGE_FAKE_SCAN_DIR}/${tool}.json` and runs it through the same compression path. Used by all tests + the harness for determinism.
- Vector values must be inlined as `'[...]'::vector` literals (pgvector parameter binding with `$1::vector` cast fails in PGlite 0.5). See `vectorToSql` in `src/embeddings.ts`.

### State Management (`src/state.ts`)
```typescript
// Use Annotation.Root with custom reducers. Channel name "triage" is used
// by the TriageOutput channel; the node is therefore named "triage_node".
rawFindings: Annotation<SecurityFinding[]>({
  reducer: (existing, next) => existing.concat(next ?? []),  // append
  default: () => [],
})
plan: Annotation<ScanPlan | null>({ reducer: (x, y) => y ?? x, default: () => null }),
wikiContext: Annotation<WikiHit[]>({ reducer: (a, b) => a.concat(b ?? []), default: () => [] }),
scanTrace: Annotation<string[]>({ reducer: (a, b) => a.concat(b ?? []), default: () => [] }),
```

### Graph Nodes (`src/graph/`)
- `orchestrator` → `target_discovery` + plan
- `gitleaks`, `trivy`, `sonarqube` (parallel via `Send`) → append to `rawFindings`
- `triage_node` → LLM contextualization, prompt-injection scan, wiki context, `triage` channel output
- `remediation` → `interrupt()` for HITL approval (`approve` / `reject`)
- `halt` → injection-detected branch (no LLM call on tainted data)
- `report` → markdown to `reports/`, wiki upsert (append)

### Vector DB (`src/db/pglite.ts`)
- `new PGlite("file://./agent_memory_data" | "memory://", { extensions: { vector } })`
- `vector(${embedder.dim})` column (NOT hardcoded 1536); dim is configured by the embedder instance.
- HNSW: `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)`.
- Search: inlined vector literal in SQL (`ORDER BY embedding <=> '[...]'::vector`).

### Checkpointer (`src/db/file_checkpointer.ts`)
- `FileCheckpointSaver` extends `BaseCheckpointSaver<number>`, writes JSON files under `.agent_state/threads/<thread_id>/<cp_id>.json`.
- Default serde is `JsonPlusSerializer` (auto-created by `BaseCheckpointSaver` super constructor).
- Enables cross-process HITL resume: first CLI invocation pauses at `interrupt()`, second invocation with `--resume approve` reads `.agent_state/` and continues.

### HITL Interrupts (`src/graph/remediation.ts`)
```typescript
const decision = interrupt({ kind: "remediation_approval", action: "apply_code_fix", details: proposal });
// Resume: await app.invoke(new Command({ resume: "approve" }), { configurable: { thread_id } })
// In v1.4+: invoke() returns state with __interrupt__[] rather than throwing.
```

### Security Hardening
- **Prompt injection**: scan finding descriptions in `src/prompt_injection.ts`; if any pattern matches, set `injectionHalt=true` and route to `halt` (no LLM call).
- **Scanned data isolation**: wrap findings in `<scanned_data>` XML tags before LLM call; system prompt treats as passive.
- **No raw shell**: scanner tools only invoke known binary names; arg arrays, not string interpolation.
- **Checkpointer RCE**: hardened via `LANGGRAPH_STRICT_MSGPACK=true`; `FileCheckpointSaver` writes plain JSON only.

## Development Commands

```bash
# Install
npm install

# Typecheck
npm run typecheck        # tsc --noEmit

# Lint (src + harness; test fixtures ignored)
npm run lint             # eslint src harness

# Test (TDD; runs with EDGE_FORCE_FIXTURES=1 implicitly per-test)
npm test                 # vitest run

# Build
npm run build            # tsc -p tsconfig.build.json

# CLI
npm run dev -- --target <path> --llm mock
npm run dev -- --target <path> --resume approve --thread-id <id>

# Graph engineering loop harness
npm run harness -- status
npm run harness -- inspect --target <path>
npm run harness -- run     --target <path>
npm run harness -- trace   --target <path> --out <file>
npm run harness -- hitl    --target <path>
npm run harness -- step    --target <path>

# WSL bootstrap
npm run wsl:setup        # bash scripts/wsl-bootstrap.sh (run inside WSL)
```

## Key Conventions
- **TDD**: each behavior has a `*.test.ts` co-located with the source.
- **Deterministic tests**: set `EDGE_FAKE_SCAN_DIR` + `EDGE_FORCE_FIXTURES=1` so the graph exercises canned scanner JSON instead of real binaries.
- **No raw shell**: OS interaction via typed tools only.
- **Knowledge accumulation**: `update_wiki` always INSERTs a new row (no ON CONFLICT overwrite).
- **Env hardening**: `LANGGRAPH_STRICT_MSGPACK=true` documented in `.env.example`.
- **Vector casts**: inline `'[...]'::vector` literals; do not use `$1::vector` parameter binding.

## File Structure
```
src/
  state.ts                       # AgentState (Annotation.Root) + types
  llm.ts                         # MockLLM + LlamaCppLLM
  embeddings.ts                  # HashingEmbedder (FNV-1a bigram), vectorToSql
  prompt_injection.ts            # pattern scanner
  index.ts                       # CLI entrypoint
  tools/
    exec.ts                      # execAsync, hasBinary, fixture loader
    compress.ts                  # gitleaks/trivy/sonar → SecurityFinding[]
    gitleaks.ts  trivy.ts  sonarqube.ts
    target_discovery.ts          # language/PM/IaC/secret hints
    wiki.ts                      # query_wiki / update_wiki tool factory
  db/
    pglite.ts                    # memory store (WASM Postgres + pgvector)
    file_checkpointer.ts         # JSON-backed BaseCheckpointSaver
  graph/
    nodes.ts                     # orchestrator, scanners, triage
    edges.ts                     # conditional + Send routing
    remediation.ts               # interrupt()/halt()
    report.ts                    # markdown render + wiki append
    index.ts                     # compileAgent, GraphDeps
harness/
  index.ts                       # graph engineering loop harness (run/trace/hitl/step/inspect/status)
test/
  fixtures/
    target-repo/                 # fixture repo (Node + Dockerfile + .env + server.js)
    scans/                       # gitleaks.json / trivy.json / sonarqube.json fixtures
    scans-injection/             # gitleaks.json with injection payload
scripts/
  wsl-bootstrap.sh               # WSL Ubuntu setup + test + harness demo
```

## References
- Spec: `.artifact/Edge Cyber Security Agent Design.md`
- LangGraph.js v1: https://docs.langchain.com/oss/javascript/langgraph/
- PGlite: https://pglite.dev/docs/about
- pgvector: https://github.com/pgvector/pgvector
- OWASP LLM Top 10: https://owasp.org/www-project-top-10-for-large-language-model-applications/
