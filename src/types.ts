/**
 * Public types for HELIOS.
 *
 * HELIOS exposes one tool surface to host LLMs. The host (e.g. Solis) feeds
 * the schema returned by `HeliosHarness.tools()` into its model and calls
 * `HeliosSession.exec(name, args)` for each tool invocation. HELIOS routes
 * to the right backend internally.
 */

export type Provider = {
  /** OpenAI-compatible base URL, e.g. https://integrate.api.nvidia.com/v1 */
  baseUrl: string;
  apiKey: string;
  /** Default model id; backends may override via their own config. */
  model: string;
};

export type E2BConfig = {
  apiKey: string;
  /** Template name. Defaults to "helios-base" (built from e2b-template/). */
  template?: string;
  /** Idle-keepalive ms for the sandbox. Default 15 minutes. */
  keepAliveMs?: number;
};

export type MemoryBridge = {
  recall?: (query: string, opts?: { k?: number }) => Promise<unknown>;
  save?:   (fact: string, opts?: { scope?: 'session' | 'global' }) => Promise<unknown>;
};

export type HeliosOptions = {
  provider: Provider;
  e2b:      E2BConfig;
  memory?:  MemoryBridge;
  /** Working dir inside the sandbox. Default /home/user/work. */
  workdir?: string;
  /** Verbose logger; receives diagnostic strings. */
  log?: (line: string) => void;
};

/** Persistent sandbox handle stored by the host between requests. */
export type SandboxHandle = {
  sandboxId: string;
  /** ISO timestamp of when it was created. */
  createdAt: string;
};

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

export type HeliosEvent =
  | { type: 'sandbox_ready';  sandboxId: string; cold: boolean }
  | { type: 'tool_start';     tool: string; args: unknown; backend: BackendId }
  | { type: 'tool_output';    tool: string; chunk: string; stream: 'stdout' | 'stderr' }
  | { type: 'tool_result';    tool: string; result: unknown }
  | { type: 'file_edit';      path: string; diff?: string }
  | { type: 'reply_chunk';    text: string }
  | { type: 'error';          text: string };

export type BackendId = 'shell' | 'codex' | 'openclaude';

export type ExecOptions = {
  timeoutMs?: number;
  /** Force a specific backend. Default: router picks one. */
  backend?: BackendId;
};

export type PromptOptions = {
  /** Which underlying CLI to drive for a free-form prompt. Default: openclaude. */
  backend?: 'codex' | 'openclaude';
  timeoutMs?: number;
};
