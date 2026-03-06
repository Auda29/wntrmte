# Wintermute

A minimalist AI-agent IDE built on VS Code. Inspired by Zed's clean aesthetics, with deep agent/subagent workflow integration à la Cursor.

> *"Wintermute was hive mind, decision maker, effecting change in the world outside."*
> — William Gibson, Neuromancer

## What is this?

Wintermute is a custom VS Code distribution (VSCodium-style: build scripts + patches, no hard fork) that ships with:

- **Minimalist UI** — no activity bar, no tabs, no minimap, no breadcrumbs by default
- **Built-in agent workflow** — visual subagent orchestrator as a first-class feature
- **Open VSX** marketplace instead of Microsoft's proprietary extension gallery
- **Zero telemetry**

Binary: `wntrmte` | Data folder: `.wntrmte`

## Architecture

Wintermute never forks VS Code directly. Instead, it clones a pinned upstream commit at build time and applies a curated set of patches. This keeps upstream updates cheap — bump a version tag, check patches, rebuild.

```
wintermute/
├── upstream/stable.json       # Pinned VS Code commit + tag
├── patches/                   # Curated diffs applied at build time
├── extensions/wntrmte-workflow/  # Agent workflow extension
├── product.json               # Branding + Open VSX marketplace
├── build.sh                   # Full build orchestration
└── .github/workflows/         # CI: Linux + Windows + macOS
```

`vscode/` is never committed — it is cloned fresh on every build.

## Build

```bash
OS_NAME=linux VSCODE_ARCH=x64 bash build.sh
```

## Roadmap

- [x] Project plan
- [ ] Phase 1: Build pipeline (clone → patch → compile → binary)
- [ ] Phase 2: Branding + minimalist UI defaults
- [ ] Phase 3: Agent workflow extension (MVP)
- [ ] Phase 4: Source-level polish

## License

[MIT](LICENSE)
