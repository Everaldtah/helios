#!/usr/bin/env node
/**
 * Minimal standalone CLI — not the main use case (HELIOS is a library),
 * but useful for smoke-testing and one-off invocations.
 *
 *   helios shell "uname -a"
 *   helios prompt --backend openclaude "list files in /tmp"
 */

import { HeliosHarness } from './harness/HeliosHarness.js';

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  if (!sub || sub === '--help' || sub === '-h') {
    print(`HELIOS CLI v${(await import('./harness/HeliosHarness.js')).HELIOS_VERSION}\n\n` +
      `Usage:\n` +
      `  helios shell "<command>"\n` +
      `  helios prompt [--backend codex|openclaude] "<task>"\n` +
      `  helios tools         (print the tool schema as JSON)\n\n` +
      `Env required:\n` +
      `  E2B_API_KEY          E2B sandbox API key\n` +
      `  OPENAI_BASE_URL      Provider base URL (or NVIDIA_BASE_URL)\n` +
      `  OPENAI_API_KEY       Provider API key (or NVIDIA_API_KEY)\n` +
      `  HELIOS_MODEL         Model id (default: meta/llama-3.3-70b-instruct)\n` +
      `  HELIOS_E2B_TEMPLATE  Sandbox template (default: helios-base)\n`);
    return;
  }

  if (sub === 'tools') {
    print(JSON.stringify(HeliosHarness.tools(), null, 2));
    return;
  }

  const helios = new HeliosHarness({
    provider: {
      baseUrl: process.env.OPENAI_BASE_URL ?? process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
      apiKey:  process.env.OPENAI_API_KEY  ?? process.env.NVIDIA_API_KEY  ?? '',
      model:   process.env.HELIOS_MODEL    ?? 'meta/llama-3.3-70b-instruct',
    },
    e2b: {
      apiKey:   process.env.E2B_API_KEY ?? '',
      template: process.env.HELIOS_E2B_TEMPLATE ?? 'helios-base',
    },
    log: (s) => process.stderr.write(`[helios] ${s}\n`),
  });

  const session = await helios.startSession('cli');

  try {
    if (sub === 'shell') {
      const cmd = rest.join(' ');
      for await (const ev of session.exec('shell', { command: cmd })) print(JSON.stringify(ev));
    } else if (sub === 'prompt') {
      let backend: 'codex' | 'openclaude' | undefined;
      let i = 0;
      while (i < rest.length) {
        if (rest[i] === '--backend' && rest[i + 1]) { backend = rest[i + 1] as 'codex' | 'openclaude'; i += 2; }
        else break;
      }
      const text = rest.slice(i).join(' ');
      for await (const ev of session.prompt(text, { backend })) print(JSON.stringify(ev));
    } else {
      process.stderr.write(`unknown subcommand: ${sub}\n`);
      process.exit(2);
    }
  } finally {
    await session.close();
  }
}

function print(s: string) { process.stdout.write(s + '\n'); }

main().catch((e) => { process.stderr.write(`error: ${(e as Error).message}\n`); process.exit(1); });
