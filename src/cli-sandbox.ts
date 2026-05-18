#!/usr/bin/env node
/**
 * helios-sandbox — interactive launcher for a HELIOS-equipped E2B sandbox.
 *
 * Spawns (or reconnects to) an E2B sandbox, ensures the HELIOS CLI is on
 * PATH, injects NVIDIA NIM credentials as env vars, then opens a raw-mode
 * PTY between the user's terminal and the sandbox's bash so they can poke
 * at `helios shell|prompt|tools`, `codex`, `openclaude`, etc. interactively.
 *
 * Required env:
 *   E2B_API_KEY                            E2B account key
 *   NVIDIA_API_KEY (or OPENAI_API_KEY)     NIM provider key (read by helios)
 *
 * Optional env:
 *   NVIDIA_BASE_URL                        defaults to NIM's URL
 *   HELIOS_MODEL                           defaults to deepseek-ai/deepseek-v4-pro
 *   HELIOS_E2B_TEMPLATE                    defaults to helios-base; falls back
 *                                          to the default E2B image if that
 *                                          template hasn't been uploaded
 *
 * State: the sandbox id is cached in ~/.helios/cli-sandbox.json so reruns
 * reconnect to the same box instead of spawning a fresh one each time.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STATE_DIR = join(homedir(), '.helios');
const STATE_FILE = join(STATE_DIR, 'cli-sandbox.json');

interface CliState { sandboxId: string; createdAt: string; }

function need(name: string): string {
  const v = process.env[name];
  if (!v) { process.stderr.write(`error: ${name} is required\n`); process.exit(2); }
  return v;
}

async function loadState(): Promise<CliState | null> {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf-8')); } catch { return null; }
}
async function saveState(state: CliState): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

interface SandboxRef {
  sandboxId: string;
  commands: { run(cmd: string, opts?: { timeoutMs?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>; };
  files: { write(path: string, content: string): Promise<unknown>; };
  pty: {
    create(opts: { cols: number; rows: number; onData: (d: Uint8Array) => void; timeoutMs?: number }): Promise<{ pid: number; wait(): Promise<unknown> }>;
    sendInput(pid: number, data: Uint8Array): Promise<void>;
    resize(pid: number, size: { cols: number; rows: number }): Promise<void>;
  };
  setTimeout?(ms: number): Promise<unknown>;
}

interface SandboxStatic {
  create(opts: { apiKey: string; template?: string; timeoutMs?: number }): Promise<SandboxRef>;
  connect(id: string, opts: { apiKey: string }): Promise<SandboxRef>;
}

async function loadSandbox(): Promise<SandboxStatic> {
  const mod = await import('e2b' as string);
  const m = mod as { Sandbox?: SandboxStatic; default?: { Sandbox?: SandboxStatic } };
  const Sandbox = m.Sandbox ?? m.default?.Sandbox;
  if (!Sandbox) throw new Error('e2b SDK: Sandbox export not found');
  return Sandbox;
}

async function spawnOrReconnect(Sandbox: SandboxStatic, apiKey: string, template: string): Promise<{ sbx: SandboxRef; fresh: boolean }> {
  const state = await loadState();
  if (state?.sandboxId) {
    try {
      process.stderr.write(`[helios-sandbox] reconnecting to ${state.sandboxId}…\n`);
      const sbx = await Sandbox.connect(state.sandboxId, { apiKey });
      return { sbx, fresh: false };
    } catch (e) {
      process.stderr.write(`[helios-sandbox] reconnect failed (${(e as Error).message}); spawning fresh.\n`);
    }
  }
  process.stderr.write(`[helios-sandbox] spawning new sandbox (template=${template || 'default'})…\n`);
  try {
    return { sbx: await Sandbox.create({ apiKey, template: template || undefined, timeoutMs: 60_000 }), fresh: true };
  } catch (e) {
    const msg = (e as Error).message || '';
    if (template && /template|404|not found/i.test(msg)) {
      process.stderr.write(`[helios-sandbox] template "${template}" unavailable; falling back to default image. helios CLI will be installed at runtime (~30s first time).\n`);
      return { sbx: await Sandbox.create({ apiKey, timeoutMs: 60_000 }), fresh: true };
    }
    throw e;
  }
}

async function ensureHeliosAndEnv(sbx: SandboxRef, env: Record<string, string>): Promise<void> {
  const probe = await sbx.commands.run('command -v helios || true', { timeoutMs: 10_000 });
  if (!probe.stdout.trim()) {
    process.stderr.write('[helios-sandbox] helios CLI not on PATH — installing @everaldtah/helios (~30s)…\n');
    const inst = await sbx.commands.run(
      'mkdir -p $HOME/.local && npm config set prefix $HOME/.local && npm install -g github:Everaldtah/helios 2>&1',
      { timeoutMs: 180_000 }
    );
    if (inst.exitCode !== 0) {
      process.stderr.write(`[helios-sandbox] helios install failed (exit ${inst.exitCode}):\n${inst.stdout.slice(-2000)}\n${inst.stderr.slice(-2000)}\n`);
      process.exit(3);
    }
  }

  const escape = (v: string) => String(v).replace(/'/g, "'\\''");
  const lines = [
    'export PATH=$HOME/.local/bin:$PATH',
    ...Object.entries(env).filter(([, v]) => v).map(([k, v]) => `export ${k}='${escape(v)}'`),
  ].join('\n') + '\n';

  await sbx.files.write('/home/user/.helios-env.sh', lines);
  await sbx.commands.run(
    `grep -q 'helios-env.sh' $HOME/.bashrc 2>/dev/null || echo 'source $HOME/.helios-env.sh' >> $HOME/.bashrc`,
    { timeoutMs: 10_000 }
  );
}

async function interactive(sbx: SandboxRef): Promise<void> {
  const cols = process.stdout.columns || 100;
  const rows = process.stdout.rows || 30;

  process.stderr.write(`\x1b[36m[helios-sandbox] sandboxId=${sbx.sandboxId}\x1b[0m\n`);
  process.stderr.write(`\x1b[36m[helios-sandbox] try: helios --help  |  helios shell "uname -a"  |  helios prompt --backend openclaude "list files"\x1b[0m\n`);
  process.stderr.write(`\x1b[36m[helios-sandbox] type 'exit' to disconnect (sandbox keeps running for ~1h)\x1b[0m\n\n`);

  const handle = await sbx.pty.create({
    cols, rows,
    onData: (data) => process.stdout.write(data),
    timeoutMs: 60 * 60_000,
  });

  process.stdin.setRawMode?.(true);
  process.stdin.resume();

  const onStdin = (chunk: Buffer) => {
    sbx.pty.sendInput(handle.pid, new Uint8Array(chunk)).catch(() => {});
  };
  process.stdin.on('data', onStdin);

  const onResize = () => {
    sbx.pty.resize(handle.pid, { cols: process.stdout.columns || 100, rows: process.stdout.rows || 30 }).catch(() => {});
  };
  process.stdout.on('resize', onResize);

  try {
    await handle.wait();
  } finally {
    process.stdin.off('data', onStdin);
    process.stdout.off('resize', onResize);
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
  }
}

(async () => {
  const apiKey = need('E2B_API_KEY');
  const nimKey = process.env.NVIDIA_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!nimKey) {
    process.stderr.write('[helios-sandbox] warn: no NVIDIA_API_KEY / OPENAI_API_KEY in env. `helios prompt` will fail until you set one.\n');
  }
  const template = process.env.HELIOS_E2B_TEMPLATE || 'helios-base';

  const Sandbox = await loadSandbox();
  const { sbx, fresh } = await spawnOrReconnect(Sandbox, apiKey, template);
  await saveState({ sandboxId: sbx.sandboxId, createdAt: new Date().toISOString() });

  if (fresh) {
    await ensureHeliosAndEnv(sbx, {
      OPENAI_BASE_URL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      OPENAI_API_KEY:  nimKey,
      HELIOS_MODEL:    process.env.HELIOS_MODEL || 'deepseek-ai/deepseek-v4-pro',
    });
  }

  try { await sbx.setTimeout?.(60 * 60_000); } catch { /* not all SDK versions expose this */ }

  await interactive(sbx);
  process.stderr.write(`\x1b[36m[helios-sandbox] disconnected. Sandbox ${sbx.sandboxId} still running. Re-run to reattach.\x1b[0m\n`);
})().catch((e) => {
  process.stderr.write(`fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
