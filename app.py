"""ASGI entrypoint for the AML UI FastAPI application."""

from __future__ import annotations

from aml_ui.main import app, create_app

__all__ = ['app', 'create_app']


if __name__ == '__main__':
    import uvicorn

    uvicorn.run('app:app', host='0.0.0.0', port=8000, reload=True)
