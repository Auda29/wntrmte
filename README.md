# Wintermute

A minimalist AI-agent IDE built on VS Code. Inspired by Zed's clean aesthetics, with deep agent/subagent workflow integration à la Cursor.

> *"Wintermute was hive mind, decision maker, effecting change in the world outside."*
> — William Gibson, Neuromancer

## What is this?

Wintermute is a custom VS Code distribution (VSCodium-style: build scripts + patches, no hard fork) that ships with:

- **Minimalist UI** — no activity bar, no tabs, no minimap, no breadcrumbs by default
- **Built-in agent workflow** — visual subagent orchestrator as a first-class feature
- **Open VSX** marketplace instead of Microsoft's proprietary extension gallery
- **Zero telemetry** — all data collection disabled by default
- **No Copilot** — GitHub Copilot AI features hidden by default

Binary: `wntrmte` | Data folder: `.wntrmte`

## Architecture

Wintermute never forks VS Code directly. Instead, it clones a pinned upstream commit at build time and applies a curated set of patches. This keeps upstream updates cheap — bump a version tag, check patches, rebuild.

```
wntrmte/
├── upstream/stable.json          # Pinned VS Code commit + tag
├── patches/                      # Curated diffs applied at build time
│   ├── binary-name.patch         # Binary 'code' → 'wntrmte'
│   ├── brand.patch               # "Visual Studio Code" → "Wintermute"
│   ├── ui-defaults.patch         # Minimalist UI defaults
│   ├── telemetry.patch           # Disable all telemetry
│   └── disable-copilot.patch     # Hide GitHub Copilot features
├── icons/                        # App icons (ico, png)
├── extensions/wntrmte-workflow/  # Agent workflow extension (Phase 3)
├── product.json                  # Branding + Open VSX marketplace
├── utils.sh                      # Shared functions (apply_patch, replace)
├── get_repo.sh                   # Shallow clone by pinned commit
├── prepare_vscode.sh             # product.json merge, icons, patches, npm ci
├── build.sh                      # Full build orchestration
└── .github/workflows/            # CI: Linux + Windows + macOS
```

`vscode/` is never committed — it is cloned fresh on every build.

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- Python 3.11+
- [jq](https://jqlang.github.io/jq/)
- Git
- Linux: `libkrb5-dev`

## Build

The build auto-detects your OS and architecture:

```bash
bash build.sh
```

Or specify explicitly:

```bash
OS_NAME=linux VSCODE_ARCH=x64 bash build.sh
```

Output will be in `VSCode-{platform}-{arch}/`.

## Upstream Updates

```bash
# Edit upstream/stable.json with new tag + commit
bash get_repo.sh
cd vscode
for p in ../patches/*.patch; do
  git apply --check "$p" || echo "CONFLICT: $p"
done
cd ..
bash build.sh
```

## Roadmap

- [x] Project plan
- [x] Phase 1: Build pipeline (clone → patch → compile → binary)
- [x] Phase 2: Branding + minimalist UI defaults
- [ ] Phase 3: Agent workflow extension (MVP)
- [ ] Phase 4: Source-level polish

## License

[MIT](LICENSE)
