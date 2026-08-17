#!/usr/bin/env bash
# WSL bootstrap for the Edge Security Agent
# Run inside WSL (Ubuntu/Debian default). Idempotent.

set -euo pipefail

echo "==> Edge Security Agent: WSL bootstrap starting"
echo "    host: $(uname -a)"
echo "    user: $(whoami)"
echo "    cwd:  $(pwd)"

# 1. Native deps for PGlite WASM and node-gyp fallback
if command -v apt-get >/dev/null 2>&1; then
  echo "==> apt: installing baseline packages"
  sudo apt-get update -y >/dev/null
  sudo apt-get install -y --no-install-recommends \
    ca-certificates curl git build-essential python3 pkg-config >/dev/null
else
  echo "==> apt not available; assuming base packages already installed"
fi

# 2. Node.js 20+ via NodeSource (idempotent)
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  echo "==> Node.js 20 not detected; installing via NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null
  sudo apt-get install -y nodejs >/dev/null
fi
echo "==> node $(node --version), npm $(npm --version)"

# 3. Project deps
if [[ ! -d node_modules ]]; then
  echo "==> npm install"
  npm install
else
  echo "==> node_modules present; skipping npm install"
fi

# 4. Smoke test: typecheck + lint + tests
echo "==> typecheck"
npm run typecheck

echo "==> lint"
npm run lint

echo "==> tests (deterministic via EDGE_FAKE_SCAN_DIR + EDGE_FORCE_FIXTURES)"
EDGE_FAKE_SCAN_DIR="$(pwd)/test/fixtures/scans" \
  EDGE_FORCE_FIXTURES=1 \
  LANGGRAPH_STRICT_MSGPACK=true \
  npm test

# 5. End-to-end harness demo (deterministic, no scanners required)
echo "==> harness: status"
npx tsx harness/index.ts status

echo "==> harness: inspect fixture"
npx tsx harness/index.ts inspect --target test/fixtures/target-repo

echo "==> harness: run + auto-approve HITL"
EDGE_FAKE_SCAN_DIR="$(pwd)/test/fixtures/scans" \
  EDGE_FORCE_FIXTURES=1 \
  npx tsx harness/index.ts hitl --target test/fixtures/target-repo --thread-id wsl-demo

echo "==> Edge Security Agent: WSL bootstrap complete"
echo "    harness cmds: npm run harness -- <status|inspect|run|trace|hitl|step>"
echo "    cli:          npm run dev -- --target /path/to/repo [--llm mock|llama]"
