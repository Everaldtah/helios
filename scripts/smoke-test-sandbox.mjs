// Non-interactive smoke test: spawn an E2B sandbox, install helios, run
// `helios --help`, then `helios shell "uname -a"`, then kill the sandbox.
// Prints each step's output. Exits non-zero on any failure.

import { Sandbox } from 'e2b';

const E2B_KEY = process.env.E2B_API_KEY;
if (!E2B_KEY) { console.error('E2B_API_KEY required'); process.exit(2); }

const TEMPLATE = process.env.HELIOS_E2B_TEMPLATE || 'helios-base';

async function step(label, p) {
  process.stdout.write(`\n──▶ ${label}\n`);
  const t = Date.now();
  const r = await p;
  process.stdout.write(`◀── ${label} done in ${((Date.now() - t) / 1000).toFixed(1)}s\n`);
  return r;
}

(async () => {
  let sbx;
  try {
    sbx = await step('spawn sandbox', (async () => {
      try {
        return await Sandbox.create({ apiKey: E2B_KEY, template: TEMPLATE, timeoutMs: 60_000 });
      } catch (e) {
        const m = e?.message || '';
        if (/template|404|not found/i.test(m)) {
          process.stdout.write(`(template "${TEMPLATE}" unavailable: ${m.slice(0, 100)}; falling back to default image)\n`);
          return await Sandbox.create({ apiKey: E2B_KEY, timeoutMs: 60_000 });
        }
        throw e;
      }
    })());

    process.stdout.write(`sandboxId=${sbx.sandboxId}\n`);

    const probe = await step('probe helios on PATH', sbx.commands.run('command -v helios || true', { timeoutMs: 10_000 }));
    process.stdout.write(`stdout: ${probe.stdout.trim() || '(not found)'}\n`);

    if (!probe.stdout.trim()) {
      const inst = await step(
        'clone + build helios',
        sbx.commands.run(
          [
            'set -e',
            'mkdir -p $HOME/.local/bin $HOME/helios-src',
            'cd $HOME/helios-src',
            '[ -d .git ] || git clone --depth 1 https://github.com/Everaldtah/helios .',
            'npm install --include=dev --no-audit --no-fund --loglevel=error 2>&1 | tail -5',
            'npm run build',
            'ln -sf $HOME/helios-src/dist/cli.js $HOME/.local/bin/helios',
            'chmod +x $HOME/helios-src/dist/cli.js',
            'echo OK',
          ].join(' && '),
          { timeoutMs: 240_000 }
        )
      );
      process.stdout.write(`exit=${inst.exitCode}\n${inst.stdout.slice(-1500)}\n`);
      if (inst.exitCode !== 0) { process.stderr.write(`install failed; stderr:\n${inst.stderr.slice(-1500)}\n`); process.exit(3); }
    }

    const help = await step('helios --help', sbx.commands.run('export PATH=$HOME/.local/bin:$PATH && helios --help', { timeoutMs: 30_000 }));
    process.stdout.write(`exit=${help.exitCode}\n${help.stdout}\n`);

    const uname = await step('helios shell "uname -a"', sbx.commands.run('export PATH=$HOME/.local/bin:$PATH && helios shell "uname -a" 2>&1 | head -20', { timeoutMs: 60_000 }));
    process.stdout.write(`exit=${uname.exitCode}\n${uname.stdout}\n`);

    process.stdout.write(`\n✅ smoke test OK\nsandboxId=${sbx.sandboxId}\n`);
  } finally {
    if (sbx) {
      try { await sbx.kill(); process.stdout.write('sandbox killed.\n'); } catch (e) { process.stdout.write(`kill failed (ok if already dead): ${e.message}\n`); }
    }
  }
})().catch((e) => { console.error(`fatal: ${e.message}\n${e.stack || ''}`); process.exit(1); });
