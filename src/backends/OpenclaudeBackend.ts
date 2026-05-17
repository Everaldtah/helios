/**
 * OpenclaudeBackend — drives `openclaude` (Gitlawb/openclaude) inside the
 * sandbox.
 *
 * Openclaude is best-suited for:
 *   - free-form multi-file code tasks (richer file tools, sub-agents)
 *   - web search / web fetch (firecrawl + duckduckgo built in)
 *   - LSP-aware navigation
 *
 * Invocation strategy: we use openclaude's non-interactive prompt mode
 * (`openclaude --print` / `-p`). If the upstream CLI later renames the
 * flag, this is the file to update; output parsing is forgiving.
 */

import type { E2BSandbox } from '../sandbox/E2BSandbox.js';
import type { HeliosEvent } from '../types.js';

export class OpenclaudeBackend {
  constructor(private sandbox: E2BSandbox, private workdir: string) {}

  async *prompt(text: string, opts: { timeoutMs?: number } = {}): AsyncGenerator<HeliosEvent> {
    yield { type: 'tool_start', tool: 'code_task', args: { prompt: text.slice(0, 200), backend: 'openclaude' }, backend: 'openclaude' };

    // -p / --print: non-interactive single prompt.
    // --output-format stream-json: emit one JSON event per line (claude-code-style).
    // Provider is configured via env (provider.env file seeded in the sandbox).
    const r = await this.sandbox.run(
      `cd '${q(this.workdir)}' && . /home/user/.helios/provider.env && ` +
      `openclaude -p ${q(text)} --output-format stream-json 2>&1 || ` +
      `openclaude -p ${q(text)} 2>&1`, // fallback if stream-json unsupported
      { timeoutMs: opts.timeoutMs ?? 240_000 }
    );

    const lines = r.stdout.split('\n').filter(Boolean);
    let emittedAny = false;
    for (const ln of lines) {
      if (ln.startsWith('{')) {
        try {
          const ev = JSON.parse(ln) as { type?: string; subtype?: string; text?: string; content?: string; path?: string };
          // openclaude/claude-code stream-json shapes (approximate; tolerant parser)
          if ((ev.type === 'assistant' || ev.type === 'message') && (ev.text || ev.content)) {
            yield { type: 'reply_chunk', text: ev.text ?? ev.content ?? '' };
            emittedAny = true;
          } else if (ev.type === 'tool_use' && ev.path) {
            yield { type: 'file_edit', path: ev.path };
            emittedAny = true;
          }
        } catch { /* not JSON; ignore line */ }
      }
    }
    if (!emittedAny && r.stdout) yield { type: 'reply_chunk', text: r.stdout.slice(0, 8_000) };
    if (r.stderr) yield { type: 'tool_output', tool: 'code_task', chunk: r.stderr, stream: 'stderr' };
    yield { type: 'tool_result', tool: 'code_task', result: { exit_code: r.exitCode, backend: 'openclaude' } };
  }

  /**
   * Web search via openclaude's built-in web tool. We invoke a tiny
   * one-shot prompt that forces the tool call; this avoids re-implementing
   * firecrawl/duckduckgo plumbing.
   */
  async *webSearch(query: string, opts: { timeoutMs?: number } = {}): AsyncGenerator<HeliosEvent> {
    yield { type: 'tool_start', tool: 'web_search', args: { query }, backend: 'openclaude' };
    const r = await this.sandbox.run(
      `cd '${q(this.workdir)}' && . /home/user/.helios/provider.env && ` +
      `openclaude -p ${q(`Search the web for: ${query}. Return the top 5 results as JSON.`)} 2>&1`,
      { timeoutMs: opts.timeoutMs ?? 60_000 }
    );
    yield { type: 'tool_result', tool: 'web_search', result: { output: r.stdout.slice(0, 8_000), exit_code: r.exitCode } };
  }

  async *webFetch(url: string, opts: { timeoutMs?: number } = {}): AsyncGenerator<HeliosEvent> {
    yield { type: 'tool_start', tool: 'web_fetch', args: { url }, backend: 'openclaude' };
    // We just use curl — openclaude's web_fetch is overkill for a single URL.
    const r = await this.sandbox.run(
      `curl -sSL --max-time 20 ${q(url)} | head -c 16384`,
      { timeoutMs: opts.timeoutMs ?? 30_000 }
    );
    yield { type: 'tool_result', tool: 'web_fetch', result: { body: r.stdout, exit_code: r.exitCode } };
  }

  async version(): Promise<string> {
    const r = await this.sandbox.run('openclaude --version 2>/dev/null || echo unknown', { timeoutMs: 5_000 });
    return r.stdout.trim() || 'unknown';
  }
}

function q(s: string): string { return `'${s.replace(/'/g, "'\\''")}'`; }
