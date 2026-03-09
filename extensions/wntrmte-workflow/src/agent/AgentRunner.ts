import * as vscode from 'vscode';
import { PatchbayStore } from '../store/PatchbayStore';
import { Task, Run } from '../store/types';
import { ToolRegistry } from './ToolRegistry';
import { ApprovalGate } from './ApprovalGate';

const MAX_ITERATIONS = 20;

export class AgentRunner {
  constructor(
    private readonly _store: PatchbayStore,
    private readonly _tools: ToolRegistry,
    private readonly _gate: ApprovalGate,
  ) {}

  async run(task: Task, cancellation?: vscode.CancellationToken): Promise<Run> {
    // Reset approval gate for this run
    this._gate.reset();

    // Mark task as in progress
    await this._store.updateTaskStatus(task.id, 'in_progress');

    const project = await this._store.getProject();
    const systemPrompt = this._buildSystemPrompt(project, task);
    const logs: string[] = [];
    let summary = '';
    const startTime = new Date().toISOString();

    try {
      // Select available chat model
      const models = await vscode.lm.selectChatModels();
      if (models.length === 0) {
        throw new Error('No language models available. Install a Language Model extension.');
      }
      const model = models[0];

      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(systemPrompt),
      ];

      const toolDefs = this._tools.asLMTools();

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        if (cancellation?.isCancellationRequested) {
          logs.push('CANCELLED by user');
          break;
        }

        const response = await model.sendRequest(messages, { tools: toolDefs }, cancellation);

        let assistantText = '';
        const toolResults: vscode.LanguageModelChatMessage[] = [];

        for await (const part of response.stream) {
          if (part instanceof vscode.LanguageModelTextPart) {
            assistantText += part.value;
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            const tool = this._tools.get(part.name);
            if (!tool) {
              logs.push(`UNKNOWN TOOL: ${part.name}`);
              toolResults.push(
                vscode.LanguageModelChatMessage.User([
                  new vscode.LanguageModelToolResultPart(part.callId, [
                    new vscode.LanguageModelTextPart(`Error: Unknown tool "${part.name}"`),
                  ]),
                ])
              );
              continue;
            }

            const args = part.input as Record<string, unknown>;

            // Approval gate
            if (tool.requiresApproval) {
              const approved = await this._gate.requestApproval(tool.name, args);
              if (!approved) {
                logs.push(`DENIED: ${tool.name}(${JSON.stringify(args)})`);
                toolResults.push(
                  vscode.LanguageModelChatMessage.User([
                    new vscode.LanguageModelToolResultPart(part.callId, [
                      new vscode.LanguageModelTextPart('Tool execution denied by user.'),
                    ]),
                  ])
                );
                continue;
              }
            }

            // Execute tool
            try {
              const result = await tool.execute(args);
              const preview = result.length > 300 ? result.slice(0, 300) + '...' : result;
              logs.push(`TOOL: ${tool.name} -> ${preview}`);
              toolResults.push(
                vscode.LanguageModelChatMessage.User([
                  new vscode.LanguageModelToolResultPart(part.callId, [
                    new vscode.LanguageModelTextPart(result),
                  ]),
                ])
              );
            } catch (err) {
              const errMsg = String(err);
              logs.push(`TOOL ERROR: ${tool.name} -> ${errMsg}`);
              toolResults.push(
                vscode.LanguageModelChatMessage.User([
                  new vscode.LanguageModelToolResultPart(part.callId, [
                    new vscode.LanguageModelTextPart(`Error: ${errMsg}`),
                  ]),
                ])
              );
            }
          }
        }

        if (assistantText) {
          logs.push(`ASSISTANT: ${assistantText.length > 500 ? assistantText.slice(0, 500) + '...' : assistantText}`);
          summary = assistantText;
        }

        // If no tool calls were made, the agent is done
        if (toolResults.length === 0) {
          break;
        }

        // Feed tool results back for next iteration
        messages.push(vscode.LanguageModelChatMessage.Assistant(assistantText));
        messages.push(...toolResults);
      }
    } catch (err) {
      logs.push(`FATAL: ${String(err)}`);
      const run = this._createRun(task, startTime, 'failed', logs, summary);
      await this._store.saveRun(run);
      await this._store.updateTaskStatus(task.id, 'blocked');
      return run;
    }

    const finalStatus = cancellation?.isCancellationRequested ? 'cancelled' : 'completed';
    const run = this._createRun(task, startTime, finalStatus as Run['status'], logs, summary);
    await this._store.saveRun(run);

    if (finalStatus === 'completed') {
      await this._store.updateTaskStatus(task.id, 'review');
    }

    return run;
  }

  private _buildSystemPrompt(project: { name: string; goal: string; rules?: string[] } | undefined, task: Task): string {
    const parts: string[] = [];

    if (project) {
      parts.push(`# Project: ${project.name}`);
      parts.push(`Goal: ${project.goal}`);
      if (project.rules?.length) {
        parts.push(`\nRules:\n${project.rules.map(r => `- ${r}`).join('\n')}`);
      }
    }

    parts.push(`\n# Task: ${task.id}`);
    parts.push(`Title: ${task.title}`);
    if (task.goal) { parts.push(`Goal: ${task.goal}`); }
    if (task.description) { parts.push(`Description: ${task.description}`); }
    if (task.affectedFiles?.length) {
      parts.push(`Affected files: ${task.affectedFiles.join(', ')}`);
    }

    parts.push('\nYou are an AI agent working on this task. Use the available tools to complete the task.');
    parts.push('When you are done, provide a summary of what you did.');

    return parts.join('\n');
  }

  private _createRun(
    task: Task,
    startTime: string,
    status: Run['status'],
    logs: string[],
    summary: string
  ): Run {
    const id = `run-${task.id}-${Date.now()}`;
    return {
      id,
      taskId: task.id,
      runner: 'vscode-lm',
      startTime,
      endTime: new Date().toISOString(),
      status,
      logs,
      summary: summary || undefined,
      filePath: '',
    };
  }
}
