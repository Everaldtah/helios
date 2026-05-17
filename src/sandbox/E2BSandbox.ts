/**
 * E2BSandbox — sticky-per-session E2B sandbox.
 *
 * The host application persists a `SandboxHandle` per chat/job session. On
 * each turn we try to reconnect to the same sandbox; if it has been reaped
 * (E2B idle-TTL), we spawn a fresh one and return the new handle so the
 * host can re-persist it.
 *
 * Why this lives here, not in Solis: Solis previously cached a sandbox
 * module-globally, which only works inside one warm Vercel function
 * instance. Across instances and across requests the cache misses. The
 * fix is to persist the sandbox id in the session record and reconnect.
 */

import type { E2BConfig, SandboxHandle } from '../types.js';

/**
 * The e2b SDK shape is loose. We type only what we use to stay forward
 * compatible across minor releases.
 */
interface E2BSandboxRef {
  sandboxId: string;
  commands: {
    run(
      cmd: string,
      opts?: { timeoutMs?: number; cwd?: string; envs?: Record<string, string> }
    ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  };
  files: {
    write(path: string, content: string): Promise<unknown>;
    read(path: string): Promise<string>;
  };
  kill?: () => Promise<unknown>;
  keepAlive?: (ms: number) => Promise<unknown>;
}

interface E2BModule {
  Sandbox: {
    create(opts: { apiKey: string; template?: string; timeoutMs?: number }): Promise<E2BSandboxRef>;
    connect(id: string, opts: { apiKey: string }): Promise<E2BSandboxRef>;
  };
}

let _e2bMod: Promise<E2BModule> | null = null;
async function loadE2B(): Promise<E2BModule> {
  if (!_e2bMod) {
    _e2bMod = import('e2b' as string).then((m: unknown) => {
      const mod = m as { Sandbox?: E2BModule['Sandbox']; default?: { Sandbox?: E2BModule['Sandbox'] } };
      const Sandbox = mod.Sandbox ?? mod.default?.Sandbox;
      if (!Sandbox) throw new Error('e2b SDK: Sandbox export not found');
      return { Sandbox };
    });
  }
  return _e2bMod;
}

export class E2BSandbox {
  private ref: E2BSandboxRef | null = null;
  private wasCold = false;

  constructor(
    private cfg: E2BConfig,
    private existing?: SandboxHandle,
    private log: (s: string) => void = () => {}
  ) {}

  /** Returns true if we created a fresh sandbox (vs. reconnected). */
  isCold(): boolean { return this.wasCold; }

  async ensure(): Promise<E2BSandboxRef> {
    if (this.ref) return this.ref;
    const { Sandbox } = (await loadE2B());

    if (this.existing?.sandboxId) {
      try {
        this.log(`reconnecting sandbox ${this.existing.sandboxId}`);
        this.ref = await Sandbox.connect(this.existing.sandboxId, { apiKey: this.cfg.apiKey });
        this.wasCold = false;
        await this.tryKeepAlive();
        return this.ref;
      } catch (e) {
        this.log(`reconnect failed: ${(e as Error).message}; creating fresh`);
      }
    }

    const wantedTemplate = this.cfg.template ?? 'helios-base';
    try {
      this.ref = await Sandbox.create({
        apiKey: this.cfg.apiKey,
        template: wantedTemplate,
        timeoutMs: 30_000,
      });
    } catch (e) {
      // Custom template not built yet, or unknown to the account. Fall back
      // to E2B's default image so the harness still works — installer.ts
      // probes and installs codex + openclaude on demand (slow first call,
      // normal thereafter).
      const msg = (e as Error).message || '';
      const looksTemplateRelated =
        /template/i.test(msg) || /404/.test(msg) || /not found/i.test(msg) || /not exist/i.test(msg);
      if (!looksTemplateRelated) throw e;
      this.log(`template "${wantedTemplate}" unavailable (${msg.slice(0, 120)}); falling back to E2B default image`);
      this.ref = await Sandbox.create({
        apiKey: this.cfg.apiKey,
        timeoutMs: 30_000,
      });
    }
    this.wasCold = true;
    await this.tryKeepAlive();
    return this.ref;
  }

  private async tryKeepAlive() {
    const ms = this.cfg.keepAliveMs ?? 15 * 60_000;
    if (!this.ref?.keepAlive) return;
    try { await this.ref.keepAlive(ms); } catch (e) { this.log(`keepAlive failed: ${(e as Error).message}`); }
  }

  handle(): SandboxHandle | null {
    if (!this.ref) return null;
    return { sandboxId: this.ref.sandboxId, createdAt: this.existing?.createdAt ?? new Date().toISOString() };
  }

  async run(
    cmd: string,
    opts: { timeoutMs?: number; cwd?: string; envs?: Record<string, string> } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const sbx = await this.ensure();
    return sbx.commands.run(cmd, { timeoutMs: opts.timeoutMs ?? 60_000, cwd: opts.cwd, envs: opts.envs });
  }

  async writeFile(path: string, content: string): Promise<void> {
    const sbx = await this.ensure();
    await sbx.files.write(path, content);
  }

  async readFile(path: string): Promise<string> {
    const sbx = await this.ensure();
    return sbx.files.read(path);
  }

  async close(): Promise<void> {
    if (!this.ref?.kill) return;
    try { await this.ref.kill(); } catch { /* sandbox may already be dead */ }
    this.ref = null;
  }
}
