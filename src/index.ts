/**
 * HELIOS — public entrypoint.
 *
 * HELIOS is a coding-agent harness that orchestrates two open-source CLIs
 * — openai/codex and Gitlawb/openclaude — as subprocesses inside an E2B
 * Linux sandbox. It exposes a single tool schema to host LLMs and routes
 * each tool call to whichever backend is strongest at that capability.
 *
 * See README.md for the composition story and integration recipes.
 */

export { HeliosHarness, HELIOS_VERSION } from './harness/HeliosHarness.js';
export { HeliosSession } from './harness/HeliosSession.js';
export { HELIOS_TOOLS } from './harness/tools.js';
export { routeTool, routeCodeTask } from './harness/router.js';
export { toSSE, collect } from './harness/streaming.js';
export { E2BSandbox } from './sandbox/E2BSandbox.js';
export { MemoryBridge } from './memory/MemoryBridge.js';

export type {
  HeliosOptions,
  HeliosEvent,
  Provider,
  E2BConfig,
  MemoryBridge as MemoryBridgeOptions,
  SandboxHandle,
  ToolDefinition,
  BackendId,
  ExecOptions,
  PromptOptions,
} from './types.js';
