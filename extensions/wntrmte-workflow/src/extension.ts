import * as vscode from 'vscode';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createStore } from './store/StoreFactory';
import { PatchbayStore } from './store/PatchbayStore';
import { TaskTreeProvider } from './providers/TaskTreeProvider';
import { RunLogProvider } from './providers/RunLogProvider';
import { WorkflowStatusBar } from './providers/StatusBarItem';
import { DashboardPanel } from './providers/DashboardPanel';
import { TaskStatus, Run } from './store/types';
import { PatchbayRunner } from './agent/PatchbayRunner';
import { AVAILABLE_RUNNERS } from './services/constants';
import {
  SetupInspector,
  checkPatchbayCli,
  SetupStatus,
  getWorkspaceContext,
  createPatchbayWorkspace,
  initViaCli,
  WorkspaceContext,
} from './services/SetupInspector';

const ALL_STATUSES: TaskStatus[] = ['open', 'in_progress', 'blocked', 'review', 'done'];

interface CliInstallPlan {
  label: string;
  detail: string;
  terminalName: string;
  terminalCwd?: string;
  commands: string[];
}

function getPatchbayCliMissingMessage(): string {
  return 'Patchbay CLI not found. Use the CLI Install action to build and install it from a local Patchbay checkout.';
}

function hasPatchbayCliPackage(repoRoot: string): boolean {
  return fsSync.existsSync(path.join(repoRoot, 'packages', 'cli', 'package.json'));
}

function collectPatchbayRepoCandidates(workspaceRoot: string | undefined, extensionRoot: string): string[] {
  const bases = new Set<string>();
  if (workspaceRoot) {
    bases.add(workspaceRoot);
    bases.add(path.dirname(workspaceRoot));
    bases.add(path.resolve(workspaceRoot, '..', 'wntrmte_patchbay'));
  }

  let current = extensionRoot;
  for (let index = 0; index < 8; index += 1) {
    bases.add(current);
    current = path.dirname(current);
  }

  const candidates = new Set<string>();
  for (const base of bases) {
    candidates.add(base);
    candidates.add(path.join(base, 'patchbay'));
    candidates.add(path.join(base, 'wntrmte_patchbay', 'patchbay'));
  }

  return [...candidates];
}

function findLocalPatchbayRepo(workspaceRoot: string | undefined, extensionRoot: string): string | undefined {
  for (const candidate of collectPatchbayRepoCandidates(workspaceRoot, extensionRoot)) {
    if (hasPatchbayCliPackage(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function getPatchbayCliInstallPlan(workspaceRoot: string | undefined, extensionRoot: string): CliInstallPlan | undefined {
  const localRepo = findLocalPatchbayRepo(workspaceRoot, extensionRoot);
  if (!localRepo) {
    return undefined;
  }

  const cliPackageDir = path.join(localRepo, 'packages', 'cli');
  return {
    label: 'Install from local Patchbay repo',
    detail: localRepo,
    terminalName: 'Patchbay CLI Install',
    terminalCwd: localRepo,
    commands: [
      'npm install',
      'npm run build --workspace=@patchbay/cli',
      `npm install -g "${cliPackageDir}"`,
    ],
  };
}

async function runCliInstallPlan(plan: CliInstallPlan): Promise<void> {
  const terminal = vscode.window.createTerminal({
    name: plan.terminalName,
    cwd: plan.terminalCwd,
  });
  terminal.show(true);

  for (const command of plan.commands) {
    terminal.sendText(command, true);
  }
}

export function activate(ctx: vscode.ExtensionContext): void {
  const patchbayRunner = new PatchbayRunner();
  const outputChannel = vscode.window.createOutputChannel('Patchbay');
  const dashboardPanel = new DashboardPanel();
  const dashboardToggle = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  dashboardToggle.name = 'Patchbay Dashboard Toggle';
  dashboardToggle.command = 'wntrmte.toggleDashboard';
  dashboardToggle.text = '$(layout-sidebar-right) Patchbay';
  dashboardToggle.tooltip = 'Toggle the Patchbay start panel';
  dashboardToggle.show();

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

  const getAgentsDirName = (): string => vscode.workspace
    .getConfiguration('wntrmte.workflow')
    .get<string>('projectAgentsDir', '.project-agents');

  const getContext = (): WorkspaceContext => getWorkspaceContext(getAgentsDirName());

  const updateContexts = (context: WorkspaceContext, connected: boolean): void => {
    void vscode.commands.executeCommand('setContext', 'wntrmte.workspaceOpen', context.hasWorkspace);
    void vscode.commands.executeCommand('setContext', 'wntrmte.projectAgentsFound', context.workspaceReady);
    void vscode.commands.executeCommand('setContext', 'wntrmte.connected', connected);
  };

  const refreshPanel = async (show = false): Promise<SetupStatus> => {
    const inspector = new SetupInspector(getContext());
    const status = await inspector.inspect();
    latestSetupStatus = status;
    updateContexts(
      getContext(),
      status.hasWorkspace && status.workspaceReady && status.effectiveMode === 'connected'
    );

    if (show) {
      dashboardPanel.show(status, vscode.ViewColumn.Beside);
    } else {
      dashboardPanel.update(status);
    }

    return status;
  };

  const initializeStore = async (): Promise<void> => {
    disposeBootstrap();

    const context = getContext();
    updateContexts(context, false);

    if (!context.workspaceReady || !context.workspaceRoot) {
      await refreshPanel(dashboardPanel.isOpen());
      return;
    }

    const storeResult = await createStore(context.workspaceRoot, context.agentsDirName);
    store = storeResult.store;
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

    updateContexts(context, storeResult.mode === 'connected');
    await refreshPanel(dashboardPanel.isOpen());
  };

  const ensureWorkspaceRoot = async (): Promise<string | undefined> => {
    const context = getContext();
    if (context.workspaceRoot) {
      return context.workspaceRoot;
    }

    const action = await vscode.window.showInformationMessage(
      'Open a project folder to initialize a Patchbay workspace.',
      'Open Folder'
    );

    if (action === 'Open Folder') {
      await vscode.commands.executeCommand('vscode.openFolder');
    }

    return undefined;
  };

  const ensureStore = (): PatchbayStore | undefined => {
    if (!store) {
      void vscode.window.showWarningMessage('Patchbay is not ready yet. Open or initialize a Patchbay workspace first.');
      return undefined;
    }

    return store;
  };

  ctx.subscriptions.push(
    outputChannel,
    dashboardPanel,
    dashboardToggle,
    { dispose: disposeBootstrap },

    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await initializeStore();
    }),

    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (
        event.affectsConfiguration('wntrmte.workflow.mode') ||
        event.affectsConfiguration('wntrmte.workflow.projectAgentsDir')
      ) {
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
        ALL_STATUSES.map((status) => ({
          label: status,
          description: status === task.status ? '(current)' : undefined,
        })),
        { title: `Set status for ${task.id}` }
      );
      if (!pick) { return; }

      try {
        await activeStore.updateTaskStatus(task.id, pick.label as TaskStatus);
      } catch (error) {
        void vscode.window.showErrorMessage(`Failed to update task: ${String(error)}`);
      }
    }),

    vscode.commands.registerCommand('wntrmte.openRun', async (run: Run) => {
      await RunLogProvider.open(run);
    }),

    vscode.commands.registerCommand('wntrmte.openDashboard', () => {
      void refreshPanel(true);
    }),

    vscode.commands.registerCommand('wntrmte.toggleDashboard', async () => {
      const setupStatus = latestSetupStatus ?? await refreshPanel(false);
      dashboardPanel.toggle(setupStatus, vscode.ViewColumn.Beside);
    }),

    vscode.commands.registerCommand('wntrmte.refreshDashboardPanel', async () => {
      await refreshPanel(dashboardPanel.isOpen());
    }),

    vscode.commands.registerCommand('wntrmte.openPatchbayDashboardExternal', async () => {
      const setupStatus = latestSetupStatus ?? await refreshPanel(false);
      await vscode.env.openExternal(vscode.Uri.parse(setupStatus.dashboard.url));
    }),

    vscode.commands.registerCommand('wntrmte.checkPatchbayCli', async () => {
      const context = getContext();
      const cli = await checkPatchbayCli(context.workspaceRoot);
      await refreshPanel(dashboardPanel.isOpen());

      if (cli.available) {
        void vscode.window.showInformationMessage(`Patchbay CLI available: ${cli.version ?? 'patchbay'}`);
        return;
      }

      void vscode.window.showWarningMessage(`Patchbay CLI not available: ${cli.error ?? 'unknown error'}`);
    }),

    vscode.commands.registerCommand('wntrmte.showPatchbayCliInstall', async () => {
      const context = getContext();
      const installPlan = getPatchbayCliInstallPlan(context.workspaceRoot, ctx.extensionUri.fsPath);

      if (!installPlan) {
        void vscode.window.showWarningMessage(
          'Automatic CLI install is only available when Wintermute can find a local Patchbay checkout nearby.'
        );
        return;
      }

      const action = await vscode.window.showInformationMessage(
        `${installPlan.label} from ${installPlan.detail}? Wintermute will run the build/install steps in the integrated terminal.`,
        { modal: true },
        'Run in Terminal'
      );

      if (action === 'Run in Terminal') {
        await runCliInstallPlan(installPlan);
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

    vscode.commands.registerCommand('wntrmte.configureAuth', async () => {
      const setupStatus = latestSetupStatus ?? await refreshPanel(false);

      if (!setupStatus.cli.available || !setupStatus.auth.available) {
        const action = await vscode.window.showWarningMessage(
          'Patchbay CLI is required to configure runner auth.',
          'Install CLI'
        );
        if (action === 'Install CLI') {
          await vscode.commands.executeCommand('wntrmte.showPatchbayCliInstall');
        }
        return;
      }

      if (setupStatus.auth.missing.length === 0) {
        void vscode.window.showInformationMessage('All Patchbay runner auth entries are already configured.');
        return;
      }

      const pick = await vscode.window.showQuickPick(
        setupStatus.auth.missing.map((runner) => ({
          label: runner,
          description: AVAILABLE_RUNNERS.find((entry) => entry.label === runner)?.description,
        })),
        { title: 'Configure auth for runner' }
      );
      if (!pick) { return; }

      const terminal = vscode.window.createTerminal({
        name: 'Patchbay Auth',
        cwd: setupStatus.workspaceRoot,
      });
      terminal.show();
      terminal.sendText(`patchbay auth set ${pick.label}`, true);
    }),

    vscode.commands.registerCommand('wntrmte.setupWorkspace', async () => {
      const workspaceRoot = await ensureWorkspaceRoot();
      if (!workspaceRoot) { return; }

      const agentsDirName = getAgentsDirName();
      const projectName = path.basename(workspaceRoot);

      try {
        const cli = await checkPatchbayCli(workspaceRoot);
        let usedCli = false;

        if (cli.available) {
          const name = await vscode.window.showInputBox({
            title: 'Project Name',
            value: projectName,
            prompt: 'Name for the Patchbay project',
          });
          if (!name) { return; }

          const goal = await vscode.window.showInputBox({
            title: 'Project Goal',
            value: 'To build awesome software',
            prompt: 'Main goal of this project',
          });
          if (!goal) { return; }

          const techStack = await vscode.window.showInputBox({
            title: 'Tech Stack',
            value: 'Node.js, TypeScript',
            prompt: 'Tech stack (comma separated)',
          });
          if (!techStack) { return; }

          usedCli = await initViaCli(workspaceRoot, { name, goal, techStack });
        }

        if (!usedCli) {
          await createPatchbayWorkspace(workspaceRoot, agentsDirName);
          if (cli.available) {
            void vscode.window.showWarningMessage('CLI init failed — created minimal bootstrap instead.');
          } else {
            void vscode.window.showInformationMessage(
              'Created local bootstrap. Install Patchbay CLI for a full setup with schema validation.',
              'Install CLI'
            ).then((action) => {
              if (action === 'Install CLI') {
                void vscode.commands.executeCommand('wntrmte.showPatchbayCliInstall');
              }
            });
          }
        }

        const projectFile = path.join(workspaceRoot, agentsDirName, 'project.yml');
        const initialTask = path.join(workspaceRoot, agentsDirName, 'tasks', 'task-001.md');

        await initializeStore();

        const action = await vscode.window.showInformationMessage(
          `Initialized Patchbay workspace in ${projectName}.`,
          'Open Project File',
          'Open Initial Task'
        );

        if (action === 'Open Project File') {
          const document = await vscode.workspace.openTextDocument(projectFile);
          await vscode.window.showTextDocument(document);
        } else if (action === 'Open Initial Task') {
          try {
            const document = await vscode.workspace.openTextDocument(initialTask);
            await vscode.window.showTextDocument(document);
          } catch {
            // CLI init doesn't create a bootstrap task — that's fine
          }
        }
      } catch (error) {
        void vscode.window.showErrorMessage(`Failed to initialize Patchbay workspace: ${String(error)}`);
      }
    }),

    vscode.commands.registerCommand('wntrmte.dispatch', async () => {
      const activeStore = ensureStore();
      if (!activeStore) { return; }

      const context = getContext();
      const cli = await checkPatchbayCli(context.workspaceRoot);
      if (!cli.available) {
        void vscode.window.showErrorMessage(getPatchbayCliMissingMessage());
        return;
      }

      const tasks = await activeStore.getTasks();
      const actionable = tasks.filter((task) => task.status === 'open' || task.status === 'blocked');
      if (actionable.length === 0) {
        void vscode.window.showInformationMessage('No open tasks to dispatch.');
        return;
      }

      const taskPick = await vscode.window.showQuickPick(
        actionable.map((task) => ({ label: task.id, description: task.title, task })),
        { title: 'Select task to dispatch' }
      );
      if (!taskPick) { return; }

      const defaultRunner = vscode.workspace
        .getConfiguration('wntrmte.workflow')
        .get<string>('defaultRunner', 'claude-code');

      const sorted = [
        ...AVAILABLE_RUNNERS.filter((runner) => runner.label === defaultRunner),
        ...AVAILABLE_RUNNERS.filter((runner) => runner.label !== defaultRunner),
      ];

      const runnerPick = await vscode.window.showQuickPick(sorted, {
        title: 'Select runner',
      });
      const workspaceRoot = context.workspaceRoot;
      if (!runnerPick || !workspaceRoot) { return; }

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
            void vscode.window.showWarningMessage(`Runner '${runnerPick.label}' was cancelled.`);
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
