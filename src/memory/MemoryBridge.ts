/**
 * MemoryBridge — bridges host-app memory (e.g. Solis's cloud-memory.mjs)
 * into the harness so sub-agent prompts can be primed with prior context.
 *
 * The host provides recall() and save() callbacks via HeliosOptions.memory.
 * If neither is given, the bridge is a no-op.
 */

import type { MemoryBridge as MemoryBridgeType } from '../types.js';

export class MemoryBridge {
  constructor(private impl?: MemoryBridgeType) {}

  async recall(query: string, k = 4): Promise<string> {
    if (!this.impl?.recall) return '';
    try {
      const hits = await this.impl.recall(query, { k });
      return formatHits(hits);
    } catch {
      return '';
    }
  }

  async save(fact: string, scope: 'session' | 'global' = 'global'): Promise<void> {
    if (!this.impl?.save) return;
    try { await this.impl.save(fact, { scope }); } catch { /* swallow */ }
  }
}

function formatHits(hits: unknown): string {
  if (!hits) return '';
  if (Array.isArray(hits)) {
    return hits
      .map((h) => (typeof h === 'string' ? h : JSON.stringify(h)))
      .join('\n---\n')
      .slice(0, 4000);
  }
  return String(hits).slice(0, 4000);
}
