"""Central configuration for the EdgeSec Agent backend.

All values are overridable via environment variables so the same agent runs
unmodified on the edge host, in CI, or in a container. No secrets are stored.
"""
from __future__ import annotations

import os

APP_NAME = "EdgeSec Agent"
VERSION = "1.0.0"

API_PREFIX = "/api/v1"

HOST = os.environ.get("EDGE_HOST", "0.0.0.0")
PORT = int(os.environ.get("EDGE_PORT", "8000"))

# Scanner binaries
GITLEAKS_BIN = os.environ.get("EDGE_GITLEAKS_BIN", "gitleaks")
TRIVY_BIN = os.environ.get("EDGE_TRIVY_BIN", "trivy")
SONARQUBE_BIN = os.environ.get("EDGE_SONARQUBE_BIN", "sonar-scanner")

# Local LLM: Ollama-compatible generate API by default; set EDGE_LLM_API_KEY to
# switch to the OpenAI-compatible /v1/chat/completions endpoint.
LLM_ENDPOINT = os.environ.get("EDGE_LLM_ENDPOINT", "http://localhost:11434")
LLM_MODEL = os.environ.get("EDGE_LLM_MODEL", "qwen2.5:7b")
LLM_API_KEY = os.environ.get("EDGE_LLM_API_KEY", "")

# Workflow tuning
SCAN_TIMEOUT_SEC = int(os.environ.get("EDGE_SCAN_TIMEOUT_SEC", "600"))
MAX_REPO_PATH_LEN = int(os.environ.get("EDGE_MAX_REPO_PATH_LEN", "4096"))
MAX_FINDINGS_IN_LLM = int(os.environ.get("EDGE_MAX_FINDINGS_IN_LLM", "200"))

# Path of the built Angular PWA (served by this same process so service-worker
# caching works same-origin). Falls back gracefully when absent.
DIST_DIR = os.environ.get(
    "EDGE_DIST_DIR",
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),  # backend/app
        "..", "..",                                  # → project root
        "edgesec-agent-pwa",
        "dist", "edgesec-agent-pwa", "browser",
    ),
)

# Static scan state lives in memory: an edge tool, so persistence is intentionally
# provided by the PWA side (IndexedDB) rather than a server database.