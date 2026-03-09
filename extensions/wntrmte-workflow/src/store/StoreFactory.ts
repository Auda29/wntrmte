import * as vscode from 'vscode';
import { PatchbayStore } from './PatchbayStore';
import { FileStore } from './FileStore';
import { ApiStore } from './ApiStore';

export type StoreMode = 'auto' | 'offline' | 'connected';

export interface StoreResult {
  store: PatchbayStore;
  mode: 'offline' | 'connected';
}

export async function createStore(
  workspaceRoot: string,
  agentsDirName: string
): Promise<StoreResult> {
  const config = vscode.workspace.getConfiguration('wntrmte.workflow');
  const mode = config.get<StoreMode>('mode', 'auto');
  const dashboardUrl = config.get<string>('dashboardUrl', 'http://localhost:3000');

  if (mode === 'offline') {
    return { store: new FileStore(workspaceRoot, agentsDirName), mode: 'offline' };
  }

  if (mode === 'connected') {
    return { store: new ApiStore(dashboardUrl), mode: 'connected' };
  }

  // auto: probe dashboard
  const reachable = await probe(dashboardUrl);
  if (reachable) {
    return { store: new ApiStore(dashboardUrl), mode: 'connected' };
  }
  return { store: new FileStore(workspaceRoot, agentsDirName), mode: 'offline' };
}

async function probe(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${url}/api/state`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}
