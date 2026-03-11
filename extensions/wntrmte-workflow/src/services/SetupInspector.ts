import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { StoreMode } from '../store/StoreFactory';

const execAsync = promisify(exec);

export type EffectiveMode = 'offline' | 'connected';

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
  workspaceReady: boolean;
  workspaceRoot: string;
  agentsDirName: string;
  configuredMode: StoreMode;
  effectiveMode: EffectiveMode;
  defaultRunner: string;
  cli: CliStatus;
  dashboard: DashboardStatus;
}

export class SetupInspector {
  constructor(
    private readonly workspaceRoot: string,
    private readonly agentsDirName: string
  ) {}

  async inspect(): Promise<SetupStatus> {
    const config = vscode.workspace.getConfiguration('wntrmte.workflow');
    const configuredMode = config.get<StoreMode>('mode', 'auto');
    const defaultRunner = config.get<string>('defaultRunner', 'claude-code');
    const dashboardUrl = config.get<string>('dashboardUrl', 'http://localhost:3000');

    const [cli, dashboard] = await Promise.all([
      checkPatchbayCli(this.workspaceRoot),
      probeDashboard(dashboardUrl),
    ]);

    return {
      workspaceReady: hasProjectAgentsDir(this.workspaceRoot, this.agentsDirName),
      workspaceRoot: this.workspaceRoot,
      agentsDirName: this.agentsDirName,
      configuredMode,
      effectiveMode: resolveEffectiveMode(configuredMode, dashboard.reachable),
      defaultRunner,
      cli,
      dashboard,
    };
  }
}

export function hasProjectAgentsDir(workspaceRoot: string, agentsDirName: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, agentsDirName));
}

export async function checkPatchbayCli(cwd: string): Promise<CliStatus> {
  try {
    const { stdout, stderr } = await execAsync('patchbay --version', { cwd });
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
