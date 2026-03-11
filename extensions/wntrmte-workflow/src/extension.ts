import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createStore } from './store/StoreFactory';
import { TaskTreeProvider } from './providers/TaskTreeProvider';
import { RunLogProvider } from './providers/RunLogProvider';
import { WorkflowStatusBar } from './providers/StatusBarItem';
import { DashboardPanel } from './providers/DashboardPanel';
import { TaskStatus, Run } from './store/types';
import { PatchbayRunner } from './agent/PatchbayRunner';

const execAsync = promisify(exec);

const ALL_STATUSES: TaskStatus[] = ['open', 'in_progress', 'blocked', 'review', 'done'];

const AVAILABLE_RUNNERS = [
  { label: 'claude-code', description: 'Claude Code CLI' },
  { label: 'codex', description: 'OpenAI Codex CLI' },
  { label: 'gemini', description: 'Google Gemini CLI' },
  { label: 'cursor-cli', description: 'Cursor CLI' },
  { label: 'bash', description: 'Shell command runner' },
];

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
  const patchbayRunner = new PatchbayRunner();
  const outputChannel = vscode.window.createOutputChannel('Patchbay');

  ctx.subscriptions.push(
    store,
    statusBar,
    outputChannel,

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
      // Check if patchbay CLI is installed
      try {
        await execAsync('patchbay --version');
      } catch {
        void vscode.window.showErrorMessage(
          'patchbay CLI not found. Install via: npm install -g @patchbay/cli'
        );
        return;
      }

      // Pick a task
      const tasks = await store.getTasks();
      const actionable = tasks.filter(t => t.status === 'open' || t.status === 'blocked');
      if (actionable.length === 0) {
        void vscode.window.showInformationMessage('No open tasks to dispatch.');
        return;
      }

      const taskPick = await vscode.window.showQuickPick(
        actionable.map(t => ({ label: t.id, description: t.title, task: t })),
        { title: 'Select task to dispatch' }
      );
      if (!taskPick) { return; }

      // Pick a runner
      const defaultRunner = vscode.workspace
        .getConfiguration('wntrmte.workflow')
        .get<string>('defaultRunner', 'claude-code');

      const sorted = [
        ...AVAILABLE_RUNNERS.filter(r => r.label === defaultRunner),
        ...AVAILABLE_RUNNERS.filter(r => r.label !== defaultRunner),
      ];

      const runnerPick = await vscode.window.showQuickPick(sorted, {
        title: 'Select runner',
      });
      if (!runnerPick) { return; }

      // Execute via patchbay CLI
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Running ${runnerPick.label} on ${taskPick.label}`,
          cancellable: true,
        },
        async (_progress, token) => {
          const result = await patchbayRunner.run(
            taskPick.label,
            runnerPick.label,
            workspaceRoot,
            outputChannel,
            token
          );

          treeProvider.refresh();

          if (result === 'completed') {
            void vscode.window.showInformationMessage(
              `Runner '${runnerPick.label}' completed task ${taskPick.label}.`
            );
          } else if (result === 'cancelled') {
            void vscode.window.showWarningMessage(
              `Runner '${runnerPick.label}' was cancelled.`
            );
          } else {
            void vscode.window.showErrorMessage(
              `Runner '${runnerPick.label}' failed. See Output > Patchbay for details.`
            );
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
