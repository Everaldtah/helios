/**
 * CodexBackend — drives `codex` (openai/codex) inside the sandbox.
 *
 * Codex is best-suited for:
 *   - apply_patch (its apply-patch crate is the proven format)
 *   - sandboxed exec with strong isolation (we still run inside E2B so we
 *     mostly use codex's non-interactive prompt mode)
 *   - MCP federation (`codex mcp` family — wired in a follow-up)
 *
 * Invocation strategy: we use `codex exec` (the non-interactive subcommand)
 * which takes a prompt, runs to completion, and emits structured output.
 * Output parsing tolerates either plain text or JSONL; if codex ever
 * changes its CLI surface, this is the file that needs updating.
 */

import type { E2BSandbox } from '../sandbox/E2BSandbox.js';
import type { HeliosEvent } from '../types.js';

export class CodexBackend {
  constructor(private sandbox: E2BSandbox, private workdir: string) {}

  /**
   * Apply a patch in codex's *** Begin Patch ... *** End Patch format,
   * via codex's apply-patch helper. We write the patch to a temp file
   * and invoke `codex apply-patch` (subcommand exists in recent releases;
   * fall back to a pipe if the subcommand is missing).
   */
  async *applyPatch(patch: string): AsyncGenerator<HeliosEvent> {
    yield { type: 'tool_start', tool: 'apply_patch', args: { patch_bytes: patch.length }, backend: 'codex' };

    const tmp = `/tmp/helios-patch-${Date.now()}.diff`;
    await this.sandbox.writeFile(tmp, patch);

    // Try the explicit subcommand first; fall back to piping into codex.
    const r = await this.sandbox.run(
      `cd '${q(this.workdir)}' && ` +
      `( codex apply-patch < '${tmp}' 2>&1 ) || ` +
      `( codex exec --json --skip-git-repo-check 'apply this patch' < '${tmp}' 2>&1 ); ` +
      `rc=$?; rm -f '${tmp}'; exit $rc`,
      { timeoutMs: 30_000 }
    );

    if (r.stdout) yield { type: 'tool_output', tool: 'apply_patch', chunk: r.stdout, stream: 'stdout' };
    if (r.stderr) yield { type: 'tool_output', tool: 'apply_patch', chunk: r.stderr, stream: 'stderr' };

    yield {
      type: 'tool_result',
      tool: 'apply_patch',
      result: { exit_code: r.exitCode, message: r.exitCode === 0 ? 'patch applied' : 'patch failed' },
    };
  }

  /**
   * Hand a free-form coding prompt to `codex exec`. Used by the `code_task`
   * tool when the router picks codex (typically sandboxed-test scenarios).
   */
  async *prompt(text: string, opts: { timeoutMs?: number } = {}): AsyncGenerator<HeliosEvent> {
    yield { type: 'tool_start', tool: 'code_task', args: { prompt: text.slice(0, 200), backend: 'codex' }, backend: 'codex' };

    // codex exec runs non-interactively. `--json` emits JSONL events;
    // `--skip-git-repo-check` lets us run outside a git repo (E2B workdir).
    // We pass the model via env so we don't have to know its CLI flag name
    // across versions.
    const r = await this.sandbox.run(
      `cd '${q(this.workdir)}' && . /home/user/.helios/provider.env && ` +
      `codex exec --json --skip-git-repo-check ${q(text)} 2>&1`,
      { timeoutMs: opts.timeoutMs ?? 240_000 }
    );

    // Parse JSONL lines if present; otherwise treat as plain text.
    const lines = r.stdout.split('\n').filter(Boolean);
    let emittedAny = false;
    for (const ln of lines) {
      if (ln.startsWith('{') && ln.endsWith('}')) {
        try {
          const ev = JSON.parse(ln) as { type?: string; text?: string; path?: string };
          if (ev.type === 'message' && ev.text) {
            yield { type: 'reply_chunk', text: ev.text };
            emittedAny = true;
          } else if (ev.type === 'file_edit' && ev.path) {
            yield { type: 'file_edit', path: ev.path };
            emittedAny = true;
          }
        } catch { /* not JSON; fall through */ }
      }
    }
    if (!emittedAny && r.stdout) yield { type: 'reply_chunk', text: r.stdout.slice(0, 8_000) };
    if (r.stderr) yield { type: 'tool_output', tool: 'code_task', chunk: r.stderr, stream: 'stderr' };
    yield { type: 'tool_result', tool: 'code_task', result: { exit_code: r.exitCode, backend: 'codex' } };
  }

  async version(): Promise<string> {
    const r = await this.sandbox.run('codex --version 2>/dev/null || echo unknown', { timeoutMs: 5_000 });
    return r.stdout.trim() || 'unknown';
  }
}

function q(s: string): string { return `'${s.replace(/'/g, "'\\''")}'`; }
