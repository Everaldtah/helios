/**
 * ShellBackend — direct shell execution inside the session's E2B sandbox.
 *
 * This is the fast path for one-shot shell commands. The router selects it
 * when the LLM calls the `shell` tool or any other tool that maps to "run
 * this command and return its output." There is no LLM call here — the
 * command runs as-is.
 */

import type { E2BSandbox } from '../sandbox/E2BSandbox.js';
import type { HeliosEvent } from '../types.js';

export class ShellBackend {
  constructor(private sandbox: E2BSandbox, private workdir: string) {}

  /**
   * Run a single command. Emits tool_start, optional output, and a final
   * tool_result event. We don't stream stdout chunks here because the
   * e2b SDK's batch interface returns the full output at the end; if a
   * future SDK exposes a streaming API we can wire it through.
   */
  async *exec(
    cmd: string,
    opts: { timeoutMs?: number } = {}
  ): AsyncGenerator<HeliosEvent> {
    yield { type: 'tool_start', tool: 'shell', args: { command: cmd }, backend: 'shell' };

    // Source provider env so any subprocess (curl, scripts, etc.) sees the
    // OpenAI-compatible creds — same env shape codex/openclaude expect.
    const wrapped = `cd '${this.workdir.replace(/'/g, "'\\''")}' 2>/dev/null; ` +
                    `[ -f /home/user/.helios/provider.env ] && . /home/user/.helios/provider.env; ` +
                    cmd;

    const r = await this.sandbox.run(wrapped, { timeoutMs: opts.timeoutMs ?? 60_000 });

    if (r.stdout) yield { type: 'tool_output', tool: 'shell', chunk: r.stdout, stream: 'stdout' };
    if (r.stderr) yield { type: 'tool_output', tool: 'shell', chunk: r.stderr, stream: 'stderr' };

    yield {
      type: 'tool_result',
      tool: 'shell',
      result: {
        stdout: r.stdout.slice(0, 16_000),
        stderr: r.stderr.slice(0, 8_000),
        exit_code: r.exitCode,
      },
    };
  }

  async readFile(path: string): Promise<{ content: string }> {
    const content = await this.sandbox.readFile(path);
    return { content };
  }

  async writeFile(path: string, content: string): Promise<{ path: string; bytes: number }> {
    await this.sandbox.writeFile(path, content);
    return { path, bytes: content.length };
  }

  async grep(pattern: string, path: string = '.'): Promise<{ matches: string[] }> {
    const r = await this.sandbox.run(
      `cd '${this.workdir.replace(/'/g, "'\\''")}' && rg --no-heading --line-number --max-count 200 -- ${shellQuote(pattern)} ${shellQuote(path)} 2>/dev/null || true`,
      { timeoutMs: 15_000 }
    );
    return { matches: r.stdout.split('\n').filter(Boolean).slice(0, 200) };
  }

  async glob(pattern: string): Promise<{ paths: string[] }> {
    const r = await this.sandbox.run(
      `cd '${this.workdir.replace(/'/g, "'\\''")}' && bash -lc 'shopt -s globstar nullglob; printf "%s\\n" ${shellQuote(pattern)}' 2>/dev/null || true`,
      { timeoutMs: 10_000 }
    );
    return { paths: r.stdout.split('\n').filter(Boolean).slice(0, 500) };
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
