import * as vscode from 'vscode';

export class ApprovalGate {
  private readonly _autoApproved = new Set<string>();

  async requestApproval(toolName: string, args: Record<string, unknown>): Promise<boolean> {
    if (this._autoApproved.has(toolName)) {
      return true;
    }

    const argsPreview = JSON.stringify(args, null, 2);
    const detail = `Tool: ${toolName}\n\n${argsPreview.length > 500 ? argsPreview.slice(0, 500) + '...' : argsPreview}`;

    const result = await vscode.window.showWarningMessage(
      `Agent wants to execute: ${toolName}`,
      { modal: true, detail },
      'Allow',
      'Allow All',
      'Deny'
    );

    if (result === 'Allow All') {
      this._autoApproved.add(toolName);
      return true;
    }

    return result === 'Allow';
  }

  /** Reset all auto-approvals (e.g. between runs). */
  reset(): void {
    this._autoApproved.clear();
  }
}
