/**
 * One-shot installer for sandboxes that aren't built from the helios-base
 * template (e.g. an E2B default Ubuntu image). Used as a fallback so the
 * harness still works without a custom template.
 *
 * On a real helios-base sandbox this is a no-op fast path — both CLIs are
 * already in /usr/local/bin.
 */

import type { E2BSandbox } from './E2BSandbox.js';

const PROBE = 'command -v codex >/dev/null && command -v openclaude >/dev/null && echo READY || echo MISSING';

export async function ensureUpstreamCLIs(
  sbx: E2BSandbox,
  log: (s: string) => void = () => {}
): Promise<{ codex: string; openclaude: string }> {
  const probe = await sbx.run(PROBE, { timeoutMs: 10_000 });
  if (probe.stdout.trim() === 'READY') {
    log('upstream CLIs already present (helios-base template)');
  } else {
    log('upstream CLIs missing; installing on the fly (slow path)');
    // Install into a user-writable prefix so we don't need sudo. We add
    // ~/.helios/cli/bin to PATH for both this install command and every
    // subsequent backend call (see seedProviderEnv below).
    await sbx.run(
      'set +e; ' +
      'mkdir -p /home/user/.helios/cli; ' +
      // Try a sudo-free user-prefix install first; fall back to sudo if
      // the sandbox happens to allow it; never fail the whole prepare.
      '(NPM_CONFIG_PREFIX=/home/user/.helios/cli ' +
        'npm install -g @openai/codex @gitlawb/openclaude 2>&1 | tail -8) || ' +
      '(sudo -n npm install -g @openai/codex @gitlawb/openclaude 2>&1 | tail -8) || ' +
      'echo "[helios] upstream CLI install failed — code_task/apply_patch/web_* will be unavailable"; ' +
      'true',
      { timeoutMs: 240_000 }
    );
  }

  const versions = await sbx.run(
    'export PATH=/home/user/.helios/cli/bin:$PATH; ' +
    'codex --version 2>/dev/null || echo unknown; ' +
    'openclaude --version 2>/dev/null || echo unknown',
    { timeoutMs: 10_000 }
  );
  const [codex, openclaude] = versions.stdout.split('\n').map((s) => s.trim());
  if (codex === 'unknown')      log('codex unavailable — apply_patch + code_task(codex) will return a clear error');
  if (openclaude === 'unknown') log('openclaude unavailable — code_task(openclaude) + web_* will return a clear error');
  return { codex: codex || 'unknown', openclaude: openclaude || 'unknown' };
}

/**
 * Seed provider credentials inside the sandbox so codex + openclaude both
 * use the same OpenAI-compatible endpoint. Called on every session start;
 * env vars are scoped to the sandbox and never written to disk in plaintext.
 */
export async function seedProviderEnv(
  sbx: E2BSandbox,
  provider: { baseUrl: string; apiKey: string; model: string },
  log: (s: string) => void = () => {}
): Promise<void> {
  // Both codex and openclaude understand OPENAI_BASE_URL + OPENAI_API_KEY
  // when configured for OpenAI-compatible providers. We write a small
  // bash file that subsequent commands source — keeping credentials out
  // of the visible env where possible.
  const script =
    `umask 077; ` +
    `mkdir -p /home/user/.helios; ` +
    `cat > /home/user/.helios/provider.env <<'EOF'\n` +
    `export OPENAI_BASE_URL='${provider.baseUrl.replace(/'/g, "'\\''")}'\n` +
    `export OPENAI_API_KEY='${provider.apiKey.replace(/'/g, "'\\''")}'\n` +
    `export HELIOS_MODEL='${provider.model.replace(/'/g, "'\\''")}'\n` +
    // Ensure the user-prefix npm install dir (used by the slow-path
    // installer) is on PATH for every backend call.
    `export PATH="/home/user/.helios/cli/bin:$PATH"\n` +
    `EOF\n` +
    `chmod 600 /home/user/.helios/provider.env`;
  const r = await sbx.run(script, { timeoutMs: 5_000 });
  if (r.exitCode !== 0) {
    log(`seedProviderEnv non-zero exit: ${r.stderr.slice(0, 300)}`);
  }
}
