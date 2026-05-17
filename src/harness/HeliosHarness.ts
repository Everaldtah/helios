/**
 * HeliosHarness — the top-level façade.
 *
 * One harness per process. The harness is cheap to construct; per-user
 * state lives in HeliosSession.
 *
 * Typical use from a host app (e.g. Solis api/chat.js):
 *
 *   const helios = new HeliosHarness({
 *     provider: { baseUrl, apiKey, model },
 *     e2b:      { apiKey: E2B_API_KEY, template: 'helios-base' },
 *     memory:   { recall: memoryRecall, save: memorySaveFact },
 *   });
 *   const session = await helios.resumeSession(sessionId, savedHandle);
 *   for await (const ev of session.exec('shell', { command: 'uname -a' })) emitSSE(ev);
 *   await persist(session.handle());   // write sandboxId back to session record
 */

import { E2BSandbox } from '../sandbox/E2BSandbox.js';
import { ShellBackend } from '../backends/ShellBackend.js';
import { CodexBackend } from '../backends/CodexBackend.js';
import { OpenclaudeBackend } from '../backends/OpenclaudeBackend.js';
import { MemoryBridge } from '../memory/MemoryBridge.js';
import { HELIOS_TOOLS } from './tools.js';
import { HeliosSession } from './HeliosSession.js';
import type { HeliosOptions, SandboxHandle, ToolDefinition } from '../types.js';

export const HELIOS_VERSION = '0.1.0';

export class HeliosHarness {
  constructor(private opts: HeliosOptions) {}

  /** OpenAI-format tool schema the host LLM should be given. */
  static tools(): ToolDefinition[] {
    return HELIOS_TOOLS.map((t) => ({ ...t, function: { ...t.function } }));
  }

  /** Convenience instance accessor — same as the static. */
  tools(): ToolDefinition[] { return HeliosHarness.tools(); }

  version(): string { return HELIOS_VERSION; }

  /**
   * Fresh session (no existing sandbox). Equivalent to resumeSession with
   * no handle.
   */
  async startSession(sessionId: string): Promise<HeliosSession> {
    return this.resumeSession(sessionId);
  }

  /**
   * Resume an existing session if a SandboxHandle is provided, else
   * create a new one. Either way returns a HeliosSession ready to use.
   *
   * The host MUST persist `session.handle()` back to its session record
   * after the first call so the next request can reconnect.
   */
  async resumeSession(sessionId: string, existing?: SandboxHandle): Promise<HeliosSession> {
    const log = this.opts.log ?? (() => {});

    const sandbox = new E2BSandbox(this.opts.e2b, existing, log);
    await sandbox.ensure();

    const workdir = this.opts.workdir ?? '/home/user/work';
    await sandbox.run(`mkdir -p '${workdir.replace(/'/g, "'\\''")}'`, { timeoutMs: 5_000 });

    const shell      = new ShellBackend(sandbox, workdir);
    const codex      = new CodexBackend(sandbox, workdir);
    const openclaude = new OpenclaudeBackend(sandbox, workdir);
    const memory     = new MemoryBridge(this.opts.memory);

    return new HeliosSession(sessionId, this.opts, sandbox, shell, codex, openclaude, memory);
  }
}
