"""Entry point: `python run.py` starts the EdgeSec Agent backend."""
from __future__ import annotations

import uvicorn

from app.config import HOST, PORT

if __name__ == "__main__":
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False, log_level="info")