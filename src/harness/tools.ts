/**
 * Unified tool schema — what HELIOS exposes to host LLMs.
 *
 * The shapes are OpenAI tool-calling format so they can be passed straight
 * into chat.completions endpoints (NVIDIA NIM, Groq, OpenAI, etc.). Each
 * tool maps to a backend internally via the router.
 */

import type { ToolDefinition } from '../types.js';

export const HELIOS_TOOLS: readonly ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'shell',
      description:
        'Execute a shell command inside the session\'s Ubuntu sandbox. Replaces shell_exec and ubuntu_exec. Persistent filesystem within a session — files written here survive across turns until the sandbox is idle-reaped.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Bash command to run' },
          timeout_ms: { type: 'integer', description: 'Max ms (default 60000, max 240000)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the sandbox filesystem.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file in the sandbox. Creates parents as needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'ripgrep-backed content search in the sandbox.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string', description: 'Defaults to the workdir' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Filesystem glob expansion in the sandbox (e.g. "**/*.ts").',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' } },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_patch',
      description:
        'Apply a unified diff (codex apply-patch format). Use this for surgical multi-file edits instead of write_file when you have a precise diff.',
      parameters: {
        type: 'object',
        properties: { patch: { type: 'string', description: 'The patch body' } },
        required: ['patch'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'code_task',
      description:
        'Delegate a free-form coding task to a specialized sub-agent (openclaude or codex). Use for multi-step refactors, write-then-run flows, or anything that benefits from a dedicated coding loop. Returns the sub-agent\'s final reply plus any files it touched.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Natural-language task description' },
          backend: {
            type: 'string',
            enum: ['auto', 'openclaude', 'codex'],
            description: 'Force a backend; "auto" lets HELIOS pick (default).',
          },
          timeout_ms: { type: 'integer', description: 'Max ms (default 240000)' },
        },
        required: ['task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for a query and return the top results.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch a URL and return its body (truncated to 16 KB).',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
  },
];
