/**
 * Minimal HELIOS example — run a shell command in the sandbox.
 *
 *   E2B_API_KEY=... OPENAI_API_KEY=... node examples/basic.js   (after build)
 */

import { HeliosHarness } from '../src/index.js';

const helios = new HeliosHarness({
  provider: {
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
    apiKey:  process.env.OPENAI_API_KEY  ?? '',
    model:   process.env.HELIOS_MODEL    ?? 'meta/llama-3.3-70b-instruct',
  },
  e2b: {
    apiKey:   process.env.E2B_API_KEY ?? '',
    template: process.env.HELIOS_E2B_TEMPLATE ?? 'helios-base',
  },
  log: (s) => console.error(`[helios] ${s}`),
});

const session = await helios.startSession('demo');

for await (const ev of session.exec('shell', { command: 'uname -a && which codex && which openclaude' })) {
  console.log(JSON.stringify(ev));
}

console.log('sandbox handle:', session.handle());
await session.close();
