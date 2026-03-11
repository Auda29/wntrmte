import * as vscode from 'vscode';
import { SetupStatus } from '../services/SetupInspector';

export class DashboardPanel {
  private _panel: vscode.WebviewPanel | undefined;

  constructor() {}

  show(status: SetupStatus, column: vscode.ViewColumn = vscode.ViewColumn.Beside): void {
    const panel = this.ensurePanel(column);
    panel.reveal(column, true);
    panel.title = getPanelTitle(status);
    panel.webview.html = getHtml(panel.webview, status);
  }

  update(status: SetupStatus): void {
    if (!this._panel) {
      return;
    }

    this._panel.title = getPanelTitle(status);
    this._panel.webview.html = getHtml(this._panel.webview, status);
  }

  isOpen(): boolean {
    return this._panel !== undefined;
  }

  hide(): void {
    this._panel?.dispose();
    this._panel = undefined;
  }

  toggle(status: SetupStatus, column: vscode.ViewColumn = vscode.ViewColumn.Beside): void {
    if (this._panel) {
      this.hide();
      return;
    }

    this.show(status, column);
  }

  dispose(): void {
    this._panel?.dispose();
    this._panel = undefined;
  }

  private ensurePanel(column: vscode.ViewColumn): vscode.WebviewPanel {
    if (this._panel) {
      return this._panel;
    }

    const panel = vscode.window.createWebviewPanel(
      'patchbayDashboard',
      'Patchbay Setup',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      const command = (message as { command?: unknown })?.command;
      const args = (message as { args?: unknown[] })?.args;
      if (typeof command !== 'string') {
        return;
      }

      await vscode.commands.executeCommand(command, ...(Array.isArray(args) ? args : []));
    });

    panel.onDidDispose(() => {
      this._panel = undefined;
    });

    this._panel = panel;
    return panel;
  }
}

function getHtml(webview: vscode.Webview, status: SetupStatus): string {
  const nonce = getNonce();
  const title = escapeHtml(getPanelTitle(status));
  const dashboardUrl = escapeHtml(status.dashboard.url);
  const cliDetail = status.cli.available
    ? status.cli.version ?? 'available'
    : status.cli.error ?? 'not installed';
  const dashboardDetail = status.dashboard.reachable
    ? 'reachable'
    : status.dashboard.error ?? 'unreachable';
  const workspaceBadge = !status.hasWorkspace
    ? 'No workspace'
    : status.workspaceReady
      ? 'Workspace ready'
      : 'Workspace setup needed';
  const cliBadge = status.cli.available ? 'CLI ready' : 'CLI missing';
  const dashboardBadge = status.dashboard.reachable ? 'Dashboard online' : 'Dashboard offline';
  const connected = status.hasWorkspace && status.workspaceReady && status.dashboard.reachable;
  const primaryWorkspaceAction = !status.hasWorkspace
    ? `<button data-command="vscode.openFolder">Open Workspace Folder</button>`
    : !status.workspaceReady
      ? `<button data-command="wntrmte.setupWorkspace">Initialize Patchbay Workspace</button>`
      : `<button data-command="wntrmte.refreshDashboardPanel">Refresh</button>`;
  const nextSteps = getNextSteps(status);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; frame-src ${status.dashboard.url}; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    :root {
      color-scheme: light dark;
    }
    * {
      box-sizing: border-box;
    }
    body, html {
      margin: 0;
      padding: 0;
      width: 100%;
      min-height: 100vh;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
    }
    body {
      display: flex;
      flex-direction: column;
    }
    .shell {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    .header {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-textLink-foreground)) 0%, var(--vscode-editor-background) 100%);
    }
    .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    h1 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 9px;
      border-radius: 999px;
      border: 1px solid var(--vscode-widget-border);
      background: var(--vscode-editorWidget-background);
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1;
    }
    .badge.ok {
      color: var(--vscode-testing-iconPassed);
      border-color: color-mix(in srgb, var(--vscode-testing-iconPassed) 50%, transparent);
    }
    .badge.warn {
      color: var(--vscode-testing-iconQueued);
      border-color: color-mix(in srgb, var(--vscode-testing-iconQueued) 50%, transparent);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 8px;
      padding: 7px 10px;
      cursor: pointer;
      font: inherit;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .setup {
      display: grid;
      gap: 12px;
      padding: 16px;
    }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      padding: 14px;
      background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-sideBar-background));
    }
    .card h2 {
      margin: 0 0 8px;
      font-size: 13px;
    }
    .card p {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      line-height: 1.45;
      word-break: break-word;
    }
    .list {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .step {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
    }
    .step-index {
      flex: none;
      width: 20px;
      height: 20px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .hero {
      padding: 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }
    iframe {
      flex: 1;
      width: 100%;
      min-height: 520px;
      border: none;
      background: var(--vscode-editor-background);
    }
    code {
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <div class="title-row">
        <h1>${title}</h1>
        <span class="badge ${connected ? 'ok' : 'warn'}">${connected ? 'Connected' : 'Setup needed'}</span>
      </div>
      <div class="meta">
        ${renderBadge(status.hasWorkspace && status.workspaceReady, workspaceBadge)}
        ${renderBadge(status.cli.available, cliBadge)}
        ${renderBadge(status.dashboard.reachable, dashboardBadge)}
        <span class="badge">Mode ${escapeHtml(status.configuredMode)} -> ${escapeHtml(status.effectiveMode)}</span>
        <span class="badge">Runner ${escapeHtml(status.defaultRunner)}</span>
      </div>
      <div class="actions">
        ${primaryWorkspaceAction}
        <button class="secondary" data-command="wntrmte.refreshDashboardPanel">Refresh</button>
        <button class="secondary" data-command="wntrmte.openPatchbayDashboardExternal">Open in Browser</button>
        <button class="secondary" data-command="wntrmte.checkPatchbayCli">Check Patchbay CLI</button>
        <button class="secondary" data-command="wntrmte.showPatchbayCliInstall">CLI Install</button>
        <button class="secondary" data-command="wntrmte.switchMode">Switch Mode</button>
        <button class="secondary" data-command="wntrmte.setDefaultRunner">Set Default Runner</button>
      </div>
    </div>
    <div class="content">
      ${connected ? `
      <div class="hero">
        Embedded Patchbay dashboard from <code>${dashboardUrl}</code>.
      </div>
      <iframe src="${dashboardUrl}" title="Patchbay Dashboard"></iframe>
      ` : `
      <div class="hero">
        ${status.hasWorkspace
          ? 'Wintermute found a workspace, but the embedded dashboard is not reachable yet. The local setup below makes the missing piece explicit instead of showing a broken iframe.'
          : 'Open a folder to work on a project, or start by creating a Patchbay-ready workspace. Wintermute keeps the setup actions here so the editor does not drop you into an empty start screen.'}
      </div>
      <div class="setup">
        <div class="card">
          <h2>Workspace</h2>
          <p>${!status.hasWorkspace
            ? 'No workspace is currently open. Open a project folder first, then initialize Patchbay metadata for that folder.'
            : status.workspaceReady
            ? status.workspaceComplete
              ? `The workspace contains <code>${escapeHtml(status.agentsDirName)}</code> with all directories and can use the local file-backed store.`
              : `The workspace contains <code>${escapeHtml(status.agentsDirName)}</code> but is missing some directories (agents/, decisions/, context/). Run <code>patchbay init</code> or re-initialize for a complete setup.`
            : `The workspace is missing <code>${escapeHtml(status.agentsDirName)}</code>, so Patchbay features stay in setup mode.`}</p>
        </div>
        <div class="card">
          <h2>Patchbay CLI</h2>
          <p>${status.cli.available
            ? `CLI detected as <code>${escapeHtml(cliDetail)}</code>. Dispatch can use the configured runner once tasks are available.`
            : `Patchbay CLI is not available yet. Current check result: <code>${escapeHtml(cliDetail)}</code>. Use the install hint to bootstrap <code>patchbay</code> locally.`}</p>
        </div>
        <div class="card">
          <h2>Dashboard</h2>
          <p>${status.dashboard.reachable
            ? `Dashboard is reachable at <code>${dashboardUrl}</code>.`
            : `Dashboard is currently offline at <code>${dashboardUrl}</code>${status.dashboard.error ? `. Last probe: <code>${escapeHtml(dashboardDetail)}</code>` : ''}. Start Patchbay or open it in a browser to verify.`}</p>
        </div>
        <div class="card">
          <h2>Mode</h2>
          <p>Configured mode is <code>${escapeHtml(status.configuredMode)}</code>, which currently resolves to <code>${escapeHtml(status.effectiveMode)}</code>. You can switch modes without reloading the window.</p>
        </div>
        <div class="card">
          <h2>Recommended Next Steps</h2>
          <div class="list">
            ${nextSteps.map((step, index) => `
              <div class="step">
                <span class="step-index">${index + 1}</span>
                <span>${escapeHtml(step)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      `}
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    for (const button of document.querySelectorAll('[data-command]')) {
      button.addEventListener('click', () => {
        vscode.postMessage({
          command: button.getAttribute('data-command')
        });
      });
    }
  </script>
</body>
</html>`;
}

function renderBadge(ok: boolean, label: string): string {
  return `<span class="badge ${ok ? 'ok' : 'warn'}">${escapeHtml(label)}</span>`;
}

function getPanelTitle(status: SetupStatus): string {
  if (!status.hasWorkspace) {
    return 'Patchbay Start';
  }

  return status.dashboard.reachable ? 'Patchbay Dashboard' : 'Patchbay Setup';
}

function getNextSteps(status: SetupStatus): string[] {
  const steps: string[] = [];

  if (!status.hasWorkspace) {
    steps.push('Open the project folder you want to work on.');
    steps.push('Initialize a Patchbay workspace for that folder.');
  } else if (!status.workspaceReady) {
    steps.push(`Create ${status.agentsDirName} for this workspace.`);
  } else if (!status.workspaceComplete) {
    steps.push('Run patchbay init or re-initialize to add missing directories (agents/, decisions/, context/).');
  }

  if (!status.cli.available) {
    steps.push('Install the Patchbay CLI so task dispatch can run locally.');
  }

  if (!status.dashboard.reachable) {
    steps.push('Start the Patchbay dashboard or verify the configured dashboard URL.');
  }

  steps.push('Confirm the default runner you want Wintermute to use.');

  return steps.slice(0, 4);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}
