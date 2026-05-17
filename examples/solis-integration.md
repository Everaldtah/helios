# Wiring HELIOS into the Solis agent

This is the reference recipe used by `Everaldtah/SOLIS-AGENT`. Adapt freely
for other host apps.

## 1. Dependency

In Solis's `package.json`:

```json
{
  "dependencies": {
    "@everaldtah/helios": "github:Everaldtah/helios"
  }
}
```

Re-install on Vercel via `vercel.json`'s `installCommand`.

## 2. Env (Vercel)

| Var                    | Value                                              |
|------------------------|----------------------------------------------------|
| `E2B_API_KEY`          | (existing)                                         |
| `HELIOS_E2B_TEMPLATE`  | `helios-base`                                      |
| `NVIDIA_API_KEY`       | (existing — passed as `provider.apiKey`)           |
| `MODEL`                | `meta/llama-3.3-70b-instruct` (existing)           |

`UBUNTU_SANDBOX_PROVIDER` becomes obsolete — leave it for the deprecation
release, remove it in the next.

## 3. Replace tool layer in each api/*.js

Pattern:

```js
import { HeliosHarness, collect } from '@everaldtah/helios';
import { recall as memoryRecall, saveFact as memorySaveFact } from '../src/memory/cloud-memory.mjs';

const helios = new HeliosHarness({
  provider: { baseUrl: NVIDIA_BASE, apiKey: NVIDIA_KEY, model: MODEL },
  e2b:      { apiKey: process.env.E2B_API_KEY, template: process.env.HELIOS_E2B_TEMPLATE ?? 'helios-base' },
  memory:   { recall: memoryRecall, save: memorySaveFact },
});

// LLM tool schema:
const TOOLS = [
  ...HeliosHarness.tools(),
  // keep Solis-owned tools (vault_*, memory_*, http_get) here
];

// When the LLM calls a tool:
async function execTool(name, args, { sessionId, savedHandle, emitSSE }) {
  const session = await helios.resumeSession(sessionId, savedHandle);
  let last;
  for await (const ev of session.exec(name, args)) {
    emitSSE(ev);
    last = ev;
  }
  await persistHandle(session.handle());   // back to sessions/web_<id>.json
  return last?.type === 'tool_result' ? last.result : { ok: true };
}
```

## 4. Retire `shell_exec`

HELIOS's `HeliosSession.exec` accepts `shell_exec` and `ubuntu_exec` as
back-compat aliases for `shell`. Keep them in the tool schema for one
release with a "deprecated" note; remove in the next.

## 5. Session storage

Add a `sandboxId` field to the session record (`sessions/web_<sessionId>.json`).
On each turn:

```js
const stored = await pullSession(sessionId);
const savedHandle = stored.sandboxId ? { sandboxId: stored.sandboxId, createdAt: stored.sandboxCreatedAt } : undefined;
// …after the turn:
await pushSession(sessionId, { ...stored, sandboxId: session.handle()?.sandboxId, sandboxCreatedAt: session.handle()?.createdAt });
```

## 6. Diag

Extend `/diag` to expose:

```js
{
  "helios": { "version": helios.version() },
  "sandbox": { "template": "helios-base", "status": "ok" },
  "upstream": session.upstreamVersions()   // probed once on session start
}
```
