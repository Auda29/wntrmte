import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as cp from 'child_process';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  execute(args: Record<string, unknown>): Promise<string>;
}

export class ToolRegistry {
  private readonly _tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this._tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this._tools.get(name);
  }

  all(): ToolDefinition[] {
    return [...this._tools.values()];
  }

  /** Convert to vscode.LanguageModelChatTool format for the LM API. */
  asLMTools(): vscode.LanguageModelChatTool[] {
    return this.all().map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters,
    }));
  }
}

export function createBuiltinTools(workspaceRoot: string): ToolDefinition[] {
  return [
    {
      name: 'fs_readFile',
      description: 'Read the contents of a file relative to the workspace root.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
        },
        required: ['path'],
      },
      requiresApproval: false,
      async execute(args) {
        const filePath = path.resolve(workspaceRoot, String(args.path));
        return await fs.readFile(filePath, 'utf-8');
      },
    },
    {
      name: 'fs_writeFile',
      description: 'Write content to a file relative to the workspace root.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
          content: { type: 'string', description: 'File content to write' },
        },
        required: ['path', 'content'],
      },
      requiresApproval: true,
      async execute(args) {
        const filePath = path.resolve(workspaceRoot, String(args.path));
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, String(args.content), 'utf-8');
        return `Written ${filePath}`;
      },
    },
    {
      name: 'fs_listDir',
      description: 'List files in a directory relative to the workspace root.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative directory path (default: ".")' },
        },
      },
      requiresApproval: false,
      async execute(args) {
        const dirPath = path.resolve(workspaceRoot, String(args.path ?? '.'));
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries.map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`).join('\n');
      },
    },
    {
      name: 'shell_execute',
      description: 'Execute a shell command in the workspace root directory.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
        },
        required: ['command'],
      },
      requiresApproval: true,
      async execute(args) {
        const command = String(args.command);
        return new Promise<string>((resolve) => {
          cp.exec(command, { cwd: workspaceRoot, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
              resolve(`EXIT ${err.code ?? 1}\n${stderr}\n${stdout}`);
            } else {
              resolve(stdout + (stderr ? `\nSTDERR: ${stderr}` : ''));
            }
          });
        });
      },
    },
  ];
}
