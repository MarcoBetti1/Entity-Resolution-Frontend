"""FastAPI application factory."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .api import router
from .config import get_config


def create_app() -> FastAPI:
    config = get_config()
    app = FastAPI(title=config.settings.title)
    app.include_router(router)

    static_root = config.paths.base_dir / "frontend"
    assets_dir = static_root / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    config_dir = config.paths.base_dir / "config"
    if config_dir.exists():
        app.mount("/config", StaticFiles(directory=config_dir), name="config")

    index_path = static_root / "index.html"

    @app.get("/", include_in_schema=False)
    async def root() -> Response:
        if index_path.exists():
            return FileResponse(index_path)
        return RedirectResponse(url="/docs")

    @app.get("/ui", include_in_schema=False)
    async def ui_entrypoint() -> Response:
        if not index_path.exists():
            raise FileNotFoundError("UI assets not built")
        return FileResponse(index_path)

    return app


app = create_app()
