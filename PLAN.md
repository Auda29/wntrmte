# Plan: Wintermute — Minimalist AI-Agent IDE auf VS Code Basis

## Context

Ziel ist eine eigene IDE, die minimalistisch wie Zed aussieht, aber AI-Agent-Workflows (ähnlich Cursor, mit Subagents) direkt integriert hat. Zwei-Personen-Team → VSCodium-Ansatz (Build-Scripts + Patches, kein echter Fork), um Upstream-Updates einfach nachziehen zu können.

**Name:** Wintermute (Neuromancer-Referenz)
- Anzeigename: **Wintermute**
- Binary/CLI: `wntrmte`
- Datenordner: `.wntrmte`
- Konfigurierbar über `APP_NAME` / `BINARY_NAME` in `utils.sh`

---

## Repo-Struktur (Endstand)

```
wintermute/
├── upstream/stable.json          # Gepinnter VS Code Commit + Tag
├── patches/
│   ├── binary-name.patch         # Binary 'code' → 'wntrmte'
│   ├── brand.patch               # Strings in Source ersetzen
│   ├── ui-defaults.patch         # Minimalistische UI-Defaults
│   ├── disable-copilot.patch     # Copilot UI entfernen (von VSCodium)
│   ├── disable-telemetry.patch   # Telemetrie aus (von VSCodium)
│   └── user/                     # Lokale Patches (gitignored)
├── extensions/
│   └── wntrmte-workflow/         # Agent-Workflow Extension (Phase 3)
├── icons/                        # Eigene App-Icons
├── product.json                  # Wird über VS Codes product.json gemerged
├── utils.sh                      # Placeholder-Tokens + apply_patch()
├── get_repo.sh                   # VS Code klonen am gepinnten Commit
├── prepare_vscode.sh             # Patches + product.json + npm ci
├── build.sh                      # Steuert den gesamten Build
├── update_upstream.sh            # Upstream-Version bumpen
└── .github/workflows/build.yml   # CI: Linux + Windows + macOS
```

`vscode/` wird nie committed — es wird bei jedem Build frisch geklont.

---

## Phase 1: Build-Pipeline aufsetzen

**Ziel:** Repo klont VS Code, baut es unverändert, produziert ein lauffähiges Binary.

### Dateien erstellen:

1. **`upstream/stable.json`** — Pinnt exakten VS Code Commit:
   ```json
   { "tag": "1.110.0", "commit": "0870c2a..." }
   ```

2. **`utils.sh`** — Definiert `APP_NAME=Wintermute`, `BINARY_NAME=wntrmte`, die `apply_patch()` Funktion mit `!!PLACEHOLDER!!`-Ersetzung (exakt wie VSCodium)

3. **`get_repo.sh`** — Shallow-Clone von VS Code am gepinnten Commit (`git fetch --depth 1`)

4. **`prepare_vscode.sh`** — Skeleton: product.json Merge, Patch-Loop, `npm ci`

5. **`build.sh`** — Ruft get_repo → prepare_vscode → gulp compile + minify + package

6. **`product.json`** — Nur extensionsGallery auf Open VSX zeigen

7. **`.github/workflows/build.yml`** — Matrix-Build für 3 Plattformen

### Verifikation:
```bash
OS_NAME=linux VSCODE_ARCH=x64 bash build.sh
./VSCode-linux-x64/code  # Startet ungebrandetes VS Code
```

---

## Phase 2: Branding + Minimale UI

**Ziel:** Binary heißt "wntrmte", UI zeigt "Wintermute", UI startet Zed-ähnlich minimalistisch.

### 2.1 `product.json` (vollständig)
Alle Branding-Felder: `nameShort: "Wintermute"`, `nameLong: "Wintermute"`, `applicationName: "wntrmte"`, `dataFolderName: ".wntrmte"`, `darwinBundleIdentifier`, `win32AppId` (eigene GUIDs generieren), Marketplace → Open VSX.

### 2.2 Patches erstellen

| Patch | Was er tut | Konflikt-Risiko |
|-------|-----------|-----------------|
| `binary-name.patch` | `bin/code` → `bin/wntrmte` in Gulpfile | Sehr niedrig |
| `brand.patch` | Hardcoded "Visual Studio Code" Strings | Niedrig |
| `ui-defaults.patch` | Defaults in `workbench.contribution.ts` ändern | Niedrig |
| `disable-telemetry.patch` | Von VSCodium kopieren | Niedrig |
| `disable-copilot.patch` | Von VSCodium kopieren | Mittel |

**`ui-defaults.patch`** — Das Herzstück der Minimalisierung. Ändert Defaults in `src/vs/workbench/browser/workbench.contribution.ts`:

| Setting | Default → Neu |
|---------|--------------|
| `workbench.activityBar.location` | `"default"` → `"hidden"` |
| `workbench.editor.showTabs` | `"multiple"` → `"none"` |
| `window.commandCenter` | `true` → `false` |
| `editor.minimap.enabled` | `true` → `false` |
| `breadcrumbs.enabled` | `true` → `false` |

Status Bar bleibt sichtbar (zeigt nützliche Infos wie Git-Branch, Sprache).

### 2.3 Icons
Eigene Icons in `icons/` erstellen → `prepare_vscode.sh` kopiert sie in `resources/darwin/`, `resources/win32/`, `resources/linux/`.

### Verifikation:
- Title Bar zeigt "Wintermute"
- Kein Activity Bar, keine Tabs, kein Minimap, keine Breadcrumbs
- Binary heißt `wntrmte`
- Ctrl+Shift+P funktioniert

---

## Phase 3: Agent-Workflow Extension (MVP)

**Ziel:** Integrierte Extension mit visuellem Agent/Subagent-Orchestrator.

### Warum Extension zuerst (nicht Source-Patch):
- Kein Patch-Wartungsaufwand — reiner TypeScript-Code
- Voller Zugriff auf VS Code Extension API (Language Model, Webview, Workspace)
- Kann unabhängig getestet werden
- Später in Phase 4 zu Source-Level promovierbar

### Architektur

```
[Workflow Canvas Webview]          ← React Flow Graph
    ↕ postMessage
[Extension Host]
    SubagentPool                   ← Verwaltet parallele Agents
      → AgentRunner               ← Einzelner Agent-Loop (LLM + Tools)
        → ToolRegistry             ← Tool-Definitionen + Approval Gates
          → TaskState              ← Immutable State Machine
```

### Extension-Struktur: `extensions/wntrmte-workflow/`

```
├── package.json                   # Views, Commands, Configuration
├── src/
│   ├── extension.ts               # Aktivierung, wiring
│   ├── orchestrator/
│   │   ├── TaskState.ts           # Immutable State: pending→running→completed/failed
│   │   ├── AgentRunner.ts         # LLM-Loop pro Agent (vscode.lm API)
│   │   ├── SubagentPool.ts        # Max-Parallel, Spawn, Cancel
│   │   └── ToolRegistry.ts        # Tools + Approval-Liste
│   ├── providers/
│   │   ├── WorkflowTreeProvider.ts # Tree View der aktiven Tasks
│   │   └── AgentStatusBar.ts      # Status Bar: "2 Agents running"
│   └── webview/
│       ├── WorkflowCanvas.tsx     # React Flow Graph
│       └── TaskCard.tsx           # Node-Komponente pro Agent
```

### Kern-Komponenten:

**TaskState** — Immutable State Machine:
- Status: `pending` | `running` | `awaiting_approval` | `delegating` | `completed` | `failed` | `cancelled`
- Tracks: `toolCalls[]`, `subagentIds[]`, `parentId`, `output`

**AgentRunner** — LLM Conversation Loop:
- Nutzt `vscode.lm.selectChatModels()` für Modell-Auswahl
- Iteriert: Request → Stream → Tool Calls → Approval Gate → Execute → Loop
- Emittiert TaskState-Updates via EventEmitter

**ToolRegistry** — Built-in Tools:
- `fs.readFile` — Datei lesen (kein Approval nötig)
- `fs.writeFile` — Datei schreiben (Approval required)
- `shell.execute` — Terminal Command (Approval required)
- `agent.delegate` — Subagent spawnen (das Alleinstellungsmerkmal!)

**SubagentPool** — Parallel-Management:
- Konfigurierbar: `wntrmte.workflow.maxParallelAgents` (default: 3)
- `wntrmte.workflow.requireApprovalForTools` — Liste der Tools die Genehmigung brauchen

**WorkflowCanvas** — React Flow Webview:
- Live-Graph aller Tasks mit Parent→Child Edges
- Farbcodierung nach Status (blau=running, orange=awaiting, grün=done, rot=failed)
- Cancel-Button pro Node

### Integration in Build:
`prepare_vscode.sh` baut die Extension (`npm ci && npm run package`) und kopiert sie nach `vscode/extensions/wntrmte-workflow/` — wird als Built-in Extension gebundlet.

### Verifikation:
1. "Wintermute: New Agent Task" → Prompt eingeben
2. Tree View zeigt Task-Status
3. Workflow Canvas zeigt Graph
4. Bei `shell.execute` erscheint Approval-Dialog
5. `agent.delegate` spawnt sichtbaren Subagent-Node im Graph
6. Task wird grün bei Completion

---

## Phase 4: Source-Level Polish (optional, später)

Nur wenn Phase 1-3 stabil laufen:

- **Title Bar Höhe reduzieren** — `titlebarPart.ts`: 30px → 28px (Patch)
- **Sidebar Header entfernen** — CSS-Patch: `.part.sidebar > .title { display: none; }`
- **Workflow in VS Code Core** — `src/vs/workbench/contrib/wntrmteWorkflow/` (additive Dateien, kein Conflict-Risiko)
- **Custom Font** — Eigene Monospace-Schrift als Default

---

## Monatlicher Upstream-Update Prozess

```bash
bash update_upstream.sh              # stable.json bumpen
bash get_repo.sh                     # Neues VS Code klonen
cd vscode
for p in ../patches/*.patch; do      # Patches testen
  git apply --check "$p" || echo "CONFLICT: $p"
done
# Konflikte fixen, Patches regenerieren
bash build.sh                        # Full Build
# Smoke Test → Commit
```

**Patches mit niedrigem Konflikt-Risiko:** binary-name, CSS-Patches, telemetry
**Patches mit höherem Risiko:** disable-copilot (ändert sich oft bei MS), ui-defaults

---

## Status

### Phase 1: Build-Pipeline ✅
- [x] Git-Repo initialisiert + GitHub Remote
- [x] `upstream/stable.json` — VS Code 1.110.0 gepinnt
- [x] `utils.sh`, `get_repo.sh`, `prepare_vscode.sh`, `build.sh` erstellt
- [x] `product.json` — Open VSX + Branding
- [x] `.github/workflows/build.yml` — CI für Linux, macOS, Windows
- [ ] Ersten Build lokal testen

### Phase 2: Branding + Minimale UI ✅
- [x] `product.json` vollständig (darwinBundleIdentifier, win32AppIds, etc.)
- [x] `patches/binary-name.patch` — Binary `code` → `wntrmte`
- [x] `patches/brand.patch` — "Visual Studio Code" → "Wintermute"
- [x] `patches/ui-defaults.patch` — Activity Bar, Tabs, Minimap, Breadcrumbs, Command Center aus
- [x] `patches/telemetry.patch` — Telemetrie, Diagnostics, Crash Reporting aus
- [x] `patches/disable-copilot.patch` — GitHub Copilot/AI Features aus
- [x] Icons generiert (ico, png) + Copy-Logik in prepare_vscode.sh
- [ ] macOS .icns generieren (braucht iconutil auf macOS)

### Phase 3: Agent-Workflow Extension — TODO
### Phase 4: Source-Level Polish — TODO
