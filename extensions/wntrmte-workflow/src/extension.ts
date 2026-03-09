import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileStore } from './store/FileStore';
import { TaskTreeProvider } from './providers/TaskTreeProvider';
import { RunLogProvider } from './providers/RunLogProvider';
import { WorkflowStatusBar } from './providers/StatusBarItem';
import { TaskStatus, Run } from './store/types';

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

  const store = new FileStore(workspaceRoot, agentsDirName);
  const treeProvider = new TaskTreeProvider(store);
  const statusBar = new WorkflowStatusBar(store);

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
      // item is a TaskNode — access task via duck typing
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
  );
}

export function deactivate(): void {
  // FileStore.dispose() is handled via ctx.subscriptions
}
