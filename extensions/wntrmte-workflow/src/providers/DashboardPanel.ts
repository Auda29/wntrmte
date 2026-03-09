import * as vscode from 'vscode';

export class DashboardPanel {
  private static _panel: vscode.WebviewPanel | undefined;

  static show(extensionUri: vscode.Uri, dashboardUrl: string): void {
    if (DashboardPanel._panel) {
      DashboardPanel._panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'patchbayDashboard',
      'Patchbay Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = getHtml(dashboardUrl);

    panel.onDidDispose(() => {
      DashboardPanel._panel = undefined;
    });

    DashboardPanel._panel = panel;
  }
}

function getHtml(dashboardUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; frame-src ${dashboardUrl}; style-src 'unsafe-inline';">
  <style>
    body, html { margin: 0; padding: 0; width: 100%; height: 100vh; overflow: hidden; background: transparent; }
    iframe { width: 100%; height: 100%; border: none; }
    .fallback { display: none; padding: 2rem; text-align: center; color: var(--vscode-descriptionForeground); font-family: var(--vscode-font-family); }
    iframe:not([src]) ~ .fallback { display: block; }
  </style>
</head>
<body>
  <iframe src="${dashboardUrl}" id="dashboard"></iframe>
  <div class="fallback">
    <p>Could not load Patchbay Dashboard at <code>${dashboardUrl}</code>.</p>
    <p>Start the dashboard with <code>npm run dev</code> in the patchbay directory.</p>
  </div>
</body>
</html>`;
}
