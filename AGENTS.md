# Wintermute — Agent Context

## What is this project?

Wintermute (`wntrmte`) is a minimalist VS Code distribution built via patches (VSCodium-style). It is **not** a hard fork — it clones a pinned VS Code commit and applies curated patches at build time.

## Companion: Patchbay

Wintermute is the native, first-class client for **Patchbay** — a lightweight orchestration dashboard for AI-assisted development. The two projects live in separate repos but share a common schema.

- Patchbay repo: `../patchbay/`
- Shared vision: `../VISION.md`
- Patchbay plan: `../patchbay/PLAN.md`

### Key rule

The extension (`extensions/wntrmte-workflow/`) is a **Patchbay client**, not a standalone orchestrator. Patchbay owns the orchestration logic and the `.project-agents/` schema. The extension consumes that schema.

## Project structure

- `build.sh` — Main build orchestration
- `get_repo.sh` — Clone pinned VS Code version
- `prepare_vscode.sh` — Apply patches, merge product.json, npm ci, build extension
- `utils.sh` — Shared utilities (APP_NAME, BINARY_NAME, apply_patch)
- `patches/` — Curated diffs applied at build time
- `product.json` — Branding, Open VSX marketplace, Windows metadata
- `upstream/stable.json` — Pinned VS Code version (tag + commit)
- `extensions/wntrmte-workflow/` — Patchbay client extension (built-in bundled)
  - `src/store/` — FileStore (offline, `.project-agents/`-based) + ApiStore (connected, SSE + polling)
  - `src/store/StoreFactory.ts` — Auto-detect offline/connected mode
  - `src/providers/` — TaskTreeProvider, RunLogProvider, StatusBarItem, DashboardPanel
  - `src/agent/` — AgentRunner (vscode.lm loop), ToolRegistry (4 builtin tools), ApprovalGate

## Build

```bash
fnm use          # Node 22
bash build.sh    # auto-detects OS/arch
```

## Conventions

- Patches use `!!PLACEHOLDER!!` tokens replaced at build time via `utils.sh`
- `vscode/` is never committed — cloned fresh each build
- All branding uses APP_NAME=Wintermute, BINARY_NAME=wntrmte
- The `.project-agents/` schema is defined in the Patchbay repo (`../patchbay/schema/`)

## Current status

Phases 1–3 complete. The IDE builds on Linux/macOS/Windows with full branding, minimalist UI defaults, and the Patchbay client extension bundled as a built-in. See `PLAN.md` for details.
