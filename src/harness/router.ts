/**
 * Router — picks a backend for each tool call.
 *
 * The capability matrix lives here in code form. When the LLM calls a tool,
 * `routeTool` returns the backend id; for code_task with backend=auto, we
 * use heuristics on the task text.
 */

import type { BackendId } from '../types.js';

export function routeTool(toolName: string): BackendId {
  switch (toolName) {
    case 'shell':
    case 'read_file':
    case 'write_file':
    case 'grep':
    case 'glob':
      return 'shell';

    case 'apply_patch':
      return 'codex';

    case 'web_search':
    case 'web_fetch':
      return 'openclaude';

    case 'code_task':
      // Resolved by routeCodeTask when args are known.
      return 'openclaude';

    default:
      return 'shell';
  }
}

/**
 * For code_task with backend=auto, pick codex vs openclaude based on
 * cheap textual signals. The rules are deliberately simple — the router
 * is meant to be tweakable, not magical.
 */
export function routeCodeTask(task: string, hint?: 'auto' | 'codex' | 'openclaude'): 'codex' | 'openclaude' {
  if (hint && hint !== 'auto') return hint;

  const t = task.toLowerCase();

  // Strong signals for codex: explicit diff/patch work, run-and-verify
  // loops, sandboxed test execution.
  if (
    /\bapply\b.*\bpatch\b/.test(t) ||
    /\bdiff\b/.test(t) ||
    /run (the )?tests?\b/.test(t) ||
    /verify.+(passes|works)/.test(t)
  ) return 'codex';

  // Default: openclaude — better at multi-file refactors, web-aware work,
  // and broader file-tool surface.
  return 'openclaude';
}
