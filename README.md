# AML Local UI 

This workspace now exposes the AML entity-resolution artifacts through a lightweight FastAPI backend and a static browser UI. The previous Streamlit single-file application has been retired in favour of a modular service layer and a configurable front end. **The project is currently a work in progress (WIP)**.

## Project layout

```
UI/
├── app.py                 # ASGI entrypoint (uvicorn app:app)
├── aml_ui/                # Backend package
│   ├── __init__.py        # Exported `create_app`
│   ├── api.py             # FastAPI routes
│   ├── config.py          # Settings + path resolution
│   ├── data_access.py     # Filesystem helpers
│   ├── main.py            # FastAPI application factory
│   ├── models.py          # Pydantic response models
│   └── services.py        # Domain logic + caching layer
├── artifacts/             # Supplied entity-resolution data
├── config/app_settings.json # Optional runtime configuration
├── frontend/              # Static web UI (served by FastAPI)
│   ├── index.html
│   └── assets/
│       ├── app.js
│       └── styles.css
└── docs/README.md         # This guide
```

## Backend

* **Framework:** [FastAPI](https://fastapi.tiangolo.com/)
* **Entrypoint:** `uvicorn app:app --reload`
* **Configuration:** `config/app_settings.json` controls the UI title, default toggles, and report check options. Set `AML_UI_BASE_DIR` to point at an alternate workspace if required.
* **Key services:**
  * `GroupService` encapsulates artifact loading, risk computation, filtering, network extraction, and report persistence.
  * Responses are serialised via `pydantic` models located in `aml_ui/models.py`.
* **Caching:** Artifact reads are cached per-process. Hit `/api/actions/refresh` (or the "Refresh Artifacts" button in the UI) to clear caches.

### REST endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/settings` | Load UI defaults/configuration. |
| GET | `/api/summary` | Dataset summary & run metadata. |
| GET | `/api/groups` | Filtered group list (supports risk, amount, date, reported filters). |
| GET | `/api/groups/{group_id}` | Detailed group view, including transactions, members, and snapshots. |
| GET | `/api/network` | Aggregated network view for current filters. |
| GET | `/api/reports` | List recorded suspicious-activity reports. |
| POST | `/api/reports` | Create a new report payload. |
| POST | `/api/actions/refresh` | Clear in-memory caches to pick up new artifacts. |

## Frontend

* Static files served from `frontend/` using the same FastAPI instance.
* Vanilla JavaScript + CSS; no build tooling required.
* Core features:
  * Filter panel (risk/amount/date/reported).
  * Group table with risk badges and reported markers.
  * Detailed entity view (metrics, canonical attributes, members, transactions, snapshots).
  * Inline report submission form using configured checks.
  * Network adjacency table representing the current filter scope.
  * Recent reports list and footer run metadata.

## Getting started

1. **Install dependencies** (run inside a virtual environment):

   ```powershell
   pip install -r requirements.txt
   ```

2. **Run the backend**:

   ```powershell
   uvicorn app:app --reload
   ```

3. **Open the UI:** navigate to `http://localhost:8000/ui` in your browser.

4. **Refresh artifacts:** when new JSON exports are dropped into `artifacts/`, either restart the server or click the "Refresh Artifacts" button to clear caches.

## Extending the system

* Adjust default UI behaviour via `config/app_settings.json` (additional report checks, default toggles, title).
* Add new API routes inside `aml_ui/api.py`, composing the `GroupService` or introducing new service classes where appropriate.
* Frontend logic lives in `frontend/assets/app.js`; because it is a plain ES module you can adopt any additional libraries simply by adding script tags or by serving bundled assets.
