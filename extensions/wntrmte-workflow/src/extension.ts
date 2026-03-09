import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { createStore } from './store/StoreFactory';
import { PatchbayStore } from './store/PatchbayStore';
import { TaskTreeProvider } from './providers/TaskTreeProvider';
import { RunLogProvider } from './providers/RunLogProvider';
import { WorkflowStatusBar } from './providers/StatusBarItem';
import { DashboardPanel } from './providers/DashboardPanel';
import { TaskStatus, Run } from './store/types';
import { AgentRunner } from './agent/AgentRunner';
import { ToolRegistry, createBuiltinTools } from './agent/ToolRegistry';
import { ApprovalGate } from './agent/ApprovalGate';

const ALL_STATUSES: TaskStatus[] = ['open', 'in_progress', 'blocked', 'review', 'done'];

export function activate(ctx: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) { return; }

  const agentsDirName = vscode.workspace
    .getConfiguration('wntrmte.workflow')
    .get<string>('projectAgentsDir', '.project-agents');

  const agentsDir = path.join(workspaceRoot, agentsDirName);
  if (!fs.existsSync(agentsDir)) { return; }

  // Signal to 'when' clauses that .project-agents exists
  void vscode.commands.executeCommand('setContext', 'wntrmte.projectAgentsFound', true);

  // Bootstrap store (async) then wire up providers
  void bootstrapAsync(ctx, workspaceRoot, agentsDirName);
}

async function bootstrapAsync(
  ctx: vscode.ExtensionContext,
  workspaceRoot: string,
  agentsDirName: string
): Promise<void> {
  const { store, mode } = await createStore(workspaceRoot, agentsDirName);

  void vscode.commands.executeCommand('setContext', 'wntrmte.connected', mode === 'connected');

  const treeProvider = new TaskTreeProvider(store);
  const statusBar = new WorkflowStatusBar(store);

  // AgentRunner setup (only if vscode.lm is available)
  let agentRunner: AgentRunner | undefined;
  if (typeof vscode.lm !== 'undefined') {
    const tools = new ToolRegistry();
    createBuiltinTools(workspaceRoot).forEach(t => tools.register(t));
    const gate = new ApprovalGate();
    agentRunner = new AgentRunner(store, tools, gate);
  }

  ctx.subscriptions.push(
    store,
    statusBar,

    vscode.window.registerTreeDataProvider('wntrmte.taskTree', treeProvider),

    vscode.workspace.registerTextDocumentContentProvider(
      RunLogProvider.scheme,
      new RunLogProvider()
    ),

    vscode.commands.registerCommand('wntrmte.refresh', () => {
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('wntrmte.setStatus', async (item: unknown) => {
      const task = (item as { task?: { id: string; status: TaskStatus } })?.task;
      if (!task) { return; }

      const pick = await vscode.window.showQuickPick(
        ALL_STATUSES.map(s => ({ label: s, description: s === task.status ? '(current)' : undefined })),
        { title: `Set status for ${task.id}` }
      );
      if (!pick) { return; }

      try {
        await store.updateTaskStatus(task.id, pick.label as TaskStatus);
      } catch (err) {
        void vscode.window.showErrorMessage(`Failed to update task: ${String(err)}`);
      }
    }),

    vscode.commands.registerCommand('wntrmte.openRun', async (run: Run) => {
      await RunLogProvider.open(run);
    }),

    vscode.commands.registerCommand('wntrmte.openDashboard', () => {
      const url = vscode.workspace
        .getConfiguration('wntrmte.workflow')
        .get<string>('dashboardUrl', 'http://localhost:3000');
      DashboardPanel.show(ctx.extensionUri, url);
    }),

    vscode.commands.registerCommand('wntrmte.dispatch', async () => {
      if (!agentRunner) {
        void vscode.window.showWarningMessage(
          'AgentRunner unavailable — vscode.lm API not found. Ensure a Language Model extension is installed.'
        );
        return;
      }

      const tasks = await store.getTasks();
      const actionable = tasks.filter(t => t.status === 'open' || t.status === 'in_progress');
      if (actionable.length === 0) {
        void vscode.window.showInformationMessage('No open tasks to dispatch.');
        return;
      }

      const pick = await vscode.window.showQuickPick(
        actionable.map(t => ({ label: t.id, description: t.title, task: t })),
        { title: 'Select task to dispatch' }
      );
      if (!pick) { return; }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Running agent on ${pick.label}`, cancellable: true },
        async (_progress, token) => {
          try {
            await agentRunner!.run(pick.task, token);
            void vscode.window.showInformationMessage(`Agent completed task ${pick.label}.`);
          } catch (err) {
            void vscode.window.showErrorMessage(`Agent failed: ${String(err)}`);
          }
        }
      );
    }),

    vscode.commands.registerCommand('wntrmte.switchMode', async () => {
      const pick = await vscode.window.showQuickPick(
        ['auto', 'offline', 'connected'],
        { title: 'Select connection mode' }
      );
      if (!pick) { return; }
      await vscode.workspace.getConfiguration('wntrmte.workflow').update('mode', pick, vscode.ConfigurationTarget.Workspace);
      void vscode.window.showInformationMessage(`Mode set to "${pick}". Reload window to apply.`);
    }),
  );
}

export function deactivate(): void {
  // Store.dispose() is handled via ctx.subscriptions
}
