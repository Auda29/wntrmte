import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { StoreMode } from '../store/StoreFactory';

const execAsync = promisify(exec);

export type EffectiveMode = 'offline' | 'connected';

export interface WorkspaceContext {
  hasWorkspace: boolean;
  workspaceRoot?: string;
  agentsDirName: string;
  workspaceReady: boolean;
}

export interface CliStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export interface DashboardStatus {
  reachable: boolean;
  url: string;
  error?: string;
}

export interface SetupStatus {
  hasWorkspace: boolean;
  workspaceReady: boolean;
  workspaceRoot?: string;
  agentsDirName: string;
  configuredMode: StoreMode;
  effectiveMode: EffectiveMode;
  defaultRunner: string;
  cli: CliStatus;
  dashboard: DashboardStatus;
}

export class SetupInspector {
  constructor(private readonly context: WorkspaceContext) {}

  async inspect(): Promise<SetupStatus> {
    const config = vscode.workspace.getConfiguration('wntrmte.workflow');
    const configuredMode = config.get<StoreMode>('mode', 'auto');
    const defaultRunner = config.get<string>('defaultRunner', 'claude-code');
    const dashboardUrl = config.get<string>('dashboardUrl', 'http://localhost:3000');

    const [cli, dashboard] = await Promise.all([
      checkPatchbayCli(this.context.workspaceRoot),
      probeDashboard(dashboardUrl),
    ]);

    return {
      hasWorkspace: this.context.hasWorkspace,
      workspaceReady: this.context.workspaceReady,
      workspaceRoot: this.context.workspaceRoot,
      agentsDirName: this.context.agentsDirName,
      configuredMode,
      effectiveMode: resolveEffectiveMode(configuredMode, dashboard.reachable),
      defaultRunner,
      cli,
      dashboard,
    };
  }
}

export function getWorkspaceContext(agentsDirName: string): WorkspaceContext {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!workspaceRoot) {
    return {
      hasWorkspace: false,
      agentsDirName,
      workspaceReady: false,
    };
  }

  return {
    hasWorkspace: true,
    workspaceRoot,
    agentsDirName,
    workspaceReady: hasProjectAgentsDir(workspaceRoot, agentsDirName),
  };
}

export function hasProjectAgentsDir(workspaceRoot: string, agentsDirName: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, agentsDirName));
}

export async function checkPatchbayCli(cwd?: string): Promise<CliStatus> {
  try {
    const { stdout, stderr } = await execAsync('patchbay --version', cwd ? { cwd } : undefined);
    const version = (stdout || stderr).trim();
    return {
      available: true,
      version: version || 'patchbay',
    };
  } catch (error) {
    return {
      available: false,
      error: getErrorMessage(error),
    };
  }
}

export async function probeDashboard(url: string): Promise<DashboardStatus> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${url}/api/state`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        reachable: false,
        url,
        error: `HTTP ${response.status}`,
      };
    }

    return {
      reachable: true,
      url,
    };
  } catch (error) {
    return {
      reachable: false,
      url,
      error: getErrorMessage(error),
    };
  }
}

export async function createPatchbayWorkspace(workspaceRoot: string, agentsDirName: string): Promise<void> {
  const agentsDir = path.join(workspaceRoot, agentsDirName);
  const tasksDir = path.join(agentsDir, 'tasks');
  const runsDir = path.join(agentsDir, 'runs');

  await fsPromises.mkdir(tasksDir, { recursive: true });
  await fsPromises.mkdir(runsDir, { recursive: true });

  const projectName = path.basename(workspaceRoot);
  const projectFile = path.join(agentsDir, 'project.yml');
  const taskFile = path.join(tasksDir, 'task-001.md');

  if (!fs.existsSync(projectFile)) {
    const project = [
      `name: ${projectName}`,
      `goal: Bootstrapped Patchbay workspace for ${projectName}`,
      `repoPath: ${workspaceRoot.replace(/\\/g, '/')}`,
      'rules: []',
      'techStack: []',
      '',
    ].join('\n');
    await fsPromises.writeFile(projectFile, project, 'utf-8');
  }

  if (!fs.existsSync(taskFile)) {
    const task = [
      '---',
      'id: task-001',
      'title: Verify Patchbay workspace setup',
      'status: open',
      'owner: wintermute',
      'affectedFiles: []',
      '---',
      '',
      'Confirm that Wintermute, Patchbay CLI, and the local dashboard are wired up for this workspace.',
      '',
      '- Start or connect the Patchbay dashboard.',
      '- Check the configured default runner.',
      '- Replace this bootstrap task with real project work.',
      '',
    ].join('\n');
    await fsPromises.writeFile(taskFile, task, 'utf-8');
  }
}

export function resolveEffectiveMode(mode: StoreMode, dashboardReachable: boolean): EffectiveMode {
  if (mode === 'offline') {
    return 'offline';
  }

  if (mode === 'connected') {
    return 'connected';
  }

  return dashboardReachable ? 'connected' : 'offline';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
