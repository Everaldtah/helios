/**
 * Streaming helpers — convert HELIOS event iterators into SSE strings or
 * collect them into a single result. Host apps can pick either model.
 */

import type { HeliosEvent } from '../types.js';

/** Format a HeliosEvent as a server-sent-events frame (data: <json>\n\n). */
export function toSSE(ev: HeliosEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

/**
 * Drain an event iterator into a result object suitable for returning from
 * a non-streaming tool call (the OpenAI tool-call result shape).
 */
export async function collect(it: AsyncIterable<HeliosEvent>): Promise<{
  ok: boolean;
  result: unknown;
  stdout: string;
  stderr: string;
  reply: string;
  files: string[];
}> {
  let result: unknown = null;
  let stdout = '';
  let stderr = '';
  let reply = '';
  const files: string[] = [];
  let ok = true;

  for await (const ev of it) {
    switch (ev.type) {
      case 'tool_output':
        if (ev.stream === 'stdout') stdout += ev.chunk;
        else stderr += ev.chunk;
        break;
      case 'tool_result':
        result = ev.result;
        if (typeof ev.result === 'object' && ev.result && 'exit_code' in ev.result) {
          const ec = (ev.result as { exit_code?: number }).exit_code;
          if (typeof ec === 'number' && ec !== 0) ok = false;
        }
        break;
      case 'reply_chunk':
        reply += ev.text;
        break;
      case 'file_edit':
        files.push(ev.path);
        break;
      case 'error':
        ok = false;
        stderr += ev.text;
        break;
      default:
        break;
    }
  }

  return { ok, result, stdout, stderr, reply, files };
}
