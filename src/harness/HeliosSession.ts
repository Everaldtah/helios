/**
 * HeliosSession — one logical user session = one E2B sandbox + backends.
 *
 * The host (e.g. Solis) holds a HeliosSession for the life of a chat
 * session. Between requests, the host persists the session's
 * SandboxHandle so a fresh function instance can reconnect on the next
 * turn.
 */

import { E2BSandbox } from '../sandbox/E2BSandbox.js';
import { ensureUpstreamCLIs, seedProviderEnv } from '../sandbox/installer.js';
import { ShellBackend } from '../backends/ShellBackend.js';
import { CodexBackend } from '../backends/CodexBackend.js';
import { OpenclaudeBackend } from '../backends/OpenclaudeBackend.js';
import { MemoryBridge } from '../memory/MemoryBridge.js';
import { routeTool, routeCodeTask } from './router.js';
import type {
  ExecOptions,
  HeliosEvent,
  HeliosOptions,
  PromptOptions,
  SandboxHandle,
} from '../types.js';

type ToolArgs = Record<string, unknown>;

export class HeliosSession {
  private prepared = false;
  private versions: { codex: string; openclaude: string } = { codex: 'unknown', openclaude: 'unknown' };

  constructor(
    public readonly sessionId: string,
    private opts: HeliosOptions,
    private sandbox: E2BSandbox,
    private shell: ShellBackend,
    private codex: CodexBackend,
    private openclaude: OpenclaudeBackend,
    private memory: MemoryBridge
  ) {}

  /**
   * Run installer + seed provider env. Cheap on warm sandboxes (probe-only).
   * Yields a sandbox_ready event when finished.
   */
  async *prepare(): AsyncGenerator<HeliosEvent> {
    if (this.prepared) {
      yield { type: 'sandbox_ready', sandboxId: this.handle()!.sandboxId, cold: false };
      return;
    }
    this.versions = await ensureUpstreamCLIs(this.sandbox, this.opts.log);
    await seedProviderEnv(this.sandbox, this.opts.provider, this.opts.log);
    this.prepared = true;
    yield { type: 'sandbox_ready', sandboxId: this.handle()!.sandboxId, cold: this.sandbox.isCold() };
  }

  handle(): SandboxHandle | null { return this.sandbox.handle(); }
  upstreamVersions(): { codex: string; openclaude: string } { return this.versions; }

  /** Execute one tool call. Yields HeliosEvents. */
  async *exec(toolName: string, args: ToolArgs, _opts: ExecOptions = {}): AsyncGenerator<HeliosEvent> {
    if (!this.prepared) yield* this.prepare();

    const backend = _opts.backend ?? routeTool(toolName);
    const timeout_ms = (args.timeout_ms as number | undefined) ?? _opts.timeoutMs;

    try {
      switch (toolName) {
        // Back-compat aliases for Solis's existing tool names.
        case 'shell_exec':
        case 'ubuntu_exec':
        case 'shell':
          yield* this.shell.exec(String(args.command ?? ''), { timeoutMs: timeout_ms });
          return;

        case 'read_file': {
          const r = await this.shell.readFile(String(args.path ?? ''));
          yield { type: 'tool_start', tool: 'read_file', args, backend: 'shell' };
          yield { type: 'tool_result', tool: 'read_file', result: r };
          return;
        }

        case 'file_write':         // Solis legacy name
        case 'write_file': {
          const path = String(args.path ?? '');
          const content = String(args.content ?? '');
          const r = await this.shell.writeFile(path, content);
          yield { type: 'tool_start', tool: 'write_file', args: { path, bytes: content.length }, backend: 'shell' };
          yield { type: 'file_edit', path };
          yield { type: 'tool_result', tool: 'write_file', result: r };
          return;
        }

        case 'grep': {
          const r = await this.shell.grep(String(args.pattern ?? ''), args.path ? String(args.path) : undefined);
          yield { type: 'tool_start', tool: 'grep', args, backend: 'shell' };
          yield { type: 'tool_result', tool: 'grep', result: r };
          return;
        }

        case 'glob': {
          const r = await this.shell.glob(String(args.pattern ?? ''));
          yield { type: 'tool_start', tool: 'glob', args, backend: 'shell' };
          yield { type: 'tool_result', tool: 'glob', result: r };
          return;
        }

        case 'apply_patch':
          yield* this.codex.applyPatch(String(args.patch ?? ''));
          return;

        case 'web_search':
          yield* this.openclaude.webSearch(String(args.query ?? ''), { timeoutMs: timeout_ms });
          return;

        case 'web_fetch':
          yield* this.openclaude.webFetch(String(args.url ?? ''), { timeoutMs: timeout_ms });
          return;

        case 'code_task': {
          const task = String(args.task ?? '');
          const hint = (args.backend as 'auto' | 'codex' | 'openclaude' | undefined);
          const pick = routeCodeTask(task, hint);
          if (pick === 'codex') yield* this.codex.prompt(task, { timeoutMs: timeout_ms });
          else                  yield* this.openclaude.prompt(task, { timeoutMs: timeout_ms });
          return;
        }

        default:
          yield { type: 'error', text: `unknown tool: ${toolName}` };
          return;
      }
    } catch (e) {
      yield { type: 'error', text: (e as Error).message };
    }
  }

  /**
   * Free-form prompt mode — bypass the unified tool surface and hand the
   * prompt directly to one of the upstream CLIs.
   */
  async *prompt(text: string, opts: PromptOptions = {}): AsyncGenerator<HeliosEvent> {
    if (!this.prepared) yield* this.prepare();
    const backend = opts.backend ?? 'openclaude';
    if (backend === 'codex') yield* this.codex.prompt(text, { timeoutMs: opts.timeoutMs });
    else                     yield* this.openclaude.prompt(text, { timeoutMs: opts.timeoutMs });
  }

  /**
   * Recall snippets from the host's memory system (Solis cloud-memory).
   */
  async recall(query: string, k = 4): Promise<string> {
    return this.memory.recall(query, k);
  }

  async save(fact: string, scope: 'session' | 'global' = 'global'): Promise<void> {
    return this.memory.save(fact, scope);
  }

  async close(): Promise<void> { await this.sandbox.close(); }
}
