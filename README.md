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
├── extensions/wntrmte-workflow/  # Patchbay client extension (Phase 3)
├── product.json                  # Branding + Open VSX marketplace
├── utils.sh                      # Shared functions (apply_patch, replace)
├── get_repo.sh                   # Shallow clone by pinned commit
├── prepare_vscode.sh             # product.json merge, icons, patches, npm ci
├── build.sh                      # Full build orchestration
└── .github/workflows/            # CI: Linux + Windows + macOS
```

`vscode/` is never committed — it is cloned fresh on every build.

## Prerequisites

- Node.js 22 via [fnm](https://github.com/Schniz/fnm) (recommended) or nvm
- Python 3.11+
- [jq](https://jqlang.github.io/jq/)
- Git
- Windows: Git Bash (or another Bash environment that can run the build scripts)
- Linux: `krb5` (`libkrb5-dev` on Debian/Ubuntu)

## Build

Activate Node 22 first, then run the build:

```bash
fnm use        # picks up .nvmrc automatically
bash build.sh
```

Or specify OS/arch explicitly:

```bash
OS_NAME=linux VSCODE_ARCH=x64 bash build.sh
```

Windows example:

```bash
OS_NAME=windows VSCODE_ARCH=x64 bash build.sh
```

Output will be in `VSCode-{platform}-{arch}/`. Build takes ~30–50 minutes (clone + npm ci + Gulp).

Verified local outputs:

- `VSCode-linux-x64/`
- `VSCode-win32-x64/`

For VS Code `1.110`, Windows packaging also requires additional `win32*` product metadata such as `win32ContextMenu`. These values are now provided in `product.json`.

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
- [x] Local Linux build verified
- [x] Local Windows x64 build verified
- [ ] Phase 3: Patchbay client extension (MVP)
- [ ] Phase 4: Source-level polish

## Companion: Patchbay

Wintermute is the native, first-class client for [Patchbay](https://github.com/Auda29/patchbay) — a lightweight orchestration dashboard for AI-assisted development. The Phase 3 extension is designed as a Patchbay client from day one, reading `.project-agents/` file-based state offline and connecting to the Patchbay backend when available. See [VISION.md](../VISION.md) for the shared architecture.

## License

[MIT](LICENSE)
