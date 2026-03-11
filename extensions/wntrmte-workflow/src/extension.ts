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
import { PatchbayRunner } from './agent/PatchbayRunner';
import { AVAILABLE_RUNNERS } from './services/constants';
import { SetupInspector, checkPatchbayCli, SetupStatus } from './services/SetupInspector';

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

  const patchbayRunner = new PatchbayRunner();
  const outputChannel = vscode.window.createOutputChannel('Patchbay');
  const dashboardPanel = new DashboardPanel();
  const inspector = new SetupInspector(workspaceRoot, agentsDirName);

  let store: PatchbayStore | undefined;
  let treeProvider: TaskTreeProvider | undefined;
  let bootstrapDisposables: vscode.Disposable[] = [];
  let latestSetupStatus: SetupStatus | undefined;

  const disposeBootstrap = (): void => {
    for (const disposable of bootstrapDisposables) {
      disposable.dispose();
    }
    bootstrapDisposables = [];
    store = undefined;
    treeProvider = undefined;
  };

  const refreshPanel = async (show = false): Promise<SetupStatus> => {
    const status = await inspector.inspect();
    latestSetupStatus = status;

    if (show) {
      dashboardPanel.show(status, vscode.ViewColumn.Beside);
    } else {
      dashboardPanel.update(status);
    }

    return status;
  };

  const initializeStore = async (): Promise<void> => {
    disposeBootstrap();

    const storeResult = await createStore(workspaceRoot, agentsDirName);
    store = storeResult.store;

    void vscode.commands.executeCommand('setContext', 'wntrmte.connected', storeResult.mode === 'connected');

    treeProvider = new TaskTreeProvider(store);
    const statusBar = new WorkflowStatusBar(store);

    bootstrapDisposables = [
      store,
      statusBar,
      vscode.window.registerTreeDataProvider('wntrmte.taskTree', treeProvider),
      vscode.workspace.registerTextDocumentContentProvider(
        RunLogProvider.scheme,
        new RunLogProvider()
      ),
    ];

    await refreshPanel(dashboardPanel.isOpen());
  };

  const ensureStore = (): PatchbayStore | undefined => {
    if (!store) {
      void vscode.window.showWarningMessage('Patchbay store is still starting up. Try again in a moment.');
      return undefined;
    }

    return store;
  };

  ctx.subscriptions.push(
    outputChannel,
    dashboardPanel,

    {
      dispose: disposeBootstrap,
    },

    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration('wntrmte.workflow.mode')) {
        await initializeStore();
        return;
      }

      if (
        event.affectsConfiguration('wntrmte.workflow.dashboardUrl') ||
        event.affectsConfiguration('wntrmte.workflow.defaultRunner')
      ) {
        await refreshPanel(dashboardPanel.isOpen());
      }
    }),

    vscode.commands.registerCommand('wntrmte.refresh', async () => {
      treeProvider?.refresh();
      await refreshPanel(dashboardPanel.isOpen());
    }),

    vscode.commands.registerCommand('wntrmte.setStatus', async (item: unknown) => {
      const activeStore = ensureStore();
      const task = (item as { task?: { id: string; status: TaskStatus } })?.task;
      if (!activeStore || !task) { return; }

      const pick = await vscode.window.showQuickPick(
        ALL_STATUSES.map(s => ({ label: s, description: s === task.status ? '(current)' : undefined })),
        { title: `Set status for ${task.id}` }
      );
      if (!pick) { return; }

      try {
        await activeStore.updateTaskStatus(task.id, pick.label as TaskStatus);
      } catch (err) {
        void vscode.window.showErrorMessage(`Failed to update task: ${String(err)}`);
      }
    }),

    vscode.commands.registerCommand('wntrmte.openRun', async (run: Run) => {
      await RunLogProvider.open(run);
    }),

    vscode.commands.registerCommand('wntrmte.openDashboard', () => {
      void refreshPanel(true);
    }),

    vscode.commands.registerCommand('wntrmte.refreshDashboardPanel', async () => {
      await refreshPanel(dashboardPanel.isOpen());
    }),

    vscode.commands.registerCommand('wntrmte.openPatchbayDashboardExternal', async () => {
      const setupStatus = latestSetupStatus ?? await refreshPanel(false);
      await vscode.env.openExternal(vscode.Uri.parse(setupStatus.dashboard.url));
    }),

    vscode.commands.registerCommand('wntrmte.checkPatchbayCli', async () => {
      const cli = await checkPatchbayCli(workspaceRoot);
      await refreshPanel(dashboardPanel.isOpen());

      if (cli.available) {
        void vscode.window.showInformationMessage(`Patchbay CLI available: ${cli.version ?? 'patchbay'}`);
        return;
      }

      void vscode.window.showWarningMessage(`Patchbay CLI not available: ${cli.error ?? 'unknown error'}`);
    }),

    vscode.commands.registerCommand('wntrmte.showPatchbayCliInstall', async () => {
      const installCommand = 'npm install -g @patchbay/cli';
      const action = await vscode.window.showInformationMessage(
        `Install Patchbay CLI with: ${installCommand}`,
        'Copy Command'
      );

      if (action === 'Copy Command') {
        await vscode.env.clipboard.writeText(installCommand);
      }
    }),

    vscode.commands.registerCommand('wntrmte.setDefaultRunner', async () => {
      const defaultRunner = vscode.workspace
        .getConfiguration('wntrmte.workflow')
        .get<string>('defaultRunner', 'claude-code');

      const pick = await vscode.window.showQuickPick(
        AVAILABLE_RUNNERS.map((runner) => ({
          ...runner,
          description: runner.label === defaultRunner
            ? `${runner.description} (current)`
            : runner.description,
        })),
        { title: 'Select default runner' }
      );
      if (!pick) { return; }

      await vscode.workspace
        .getConfiguration('wntrmte.workflow')
        .update('defaultRunner', pick.label, vscode.ConfigurationTarget.Workspace);
    }),

    vscode.commands.registerCommand('wntrmte.dispatch', async () => {
      const activeStore = ensureStore();
      if (!activeStore) { return; }

      const cli = await checkPatchbayCli(workspaceRoot);
      if (!cli.available) {
        void vscode.window.showErrorMessage(
          'patchbay CLI not found. Install via: npm install -g @patchbay/cli'
        );
        return;
      }

      const tasks = await activeStore.getTasks();
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

          treeProvider?.refresh();
          await refreshPanel(dashboardPanel.isOpen());

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
      await vscode.workspace
        .getConfiguration('wntrmte.workflow')
        .update('mode', pick, vscode.ConfigurationTarget.Workspace);

      void vscode.window.showInformationMessage(`Mode set to "${pick}".`);
    }),
  );

  void (async () => {
    try {
      await initializeStore();

      const openOnStartup = vscode.workspace
        .getConfiguration('wntrmte.workflow')
        .get<boolean>('openDashboardOnStartup', true);

      if (openOnStartup) {
        await refreshPanel(true);
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to initialize Wintermute Workflow: ${String(error)}`);
    }
  })();
}

export function deactivate(): void {
  // Store.dispose() is handled via ctx.subscriptions
}
