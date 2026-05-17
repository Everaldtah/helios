# `helios-base` E2B template

Custom E2B sandbox image with codex + openclaude pre-installed. HELIOS spins
this up per Solis session.

## Build & upload

```bash
# 1. Install the e2b CLI once:
npm install -g @e2b/cli

# 2. Log in (use the same E2B account that holds the API key your app uses):
e2b auth login

# 3. From this directory:
e2b template build
```

Build takes ~3–5 min the first time (apt + Node + codex + openclaude global
installs).

The resulting template id is `helios-base` (see `e2b.toml`). Point HELIOS at
it via `HELIOS_E2B_TEMPLATE=helios-base` or by passing `e2b.template:
'helios-base'` to `new HeliosHarness({...})`.

## What's inside

| Layer                            | Why                                  |
|----------------------------------|--------------------------------------|
| Ubuntu 22.04 (E2B code-interp.)  | Stable base                          |
| ripgrep, jq, git, curl, unzip    | Shell tool surface                   |
| Node 22                          | Matches HELIOS's `engines.node`      |
| bun                              | Some openclaude scripts call bun     |
| `@openai/codex`                  | Codex Rust CLI (binary self-downloads) |
| `@gitlawb/openclaude`            | OpenClaude Node CLI                  |
| `/home/user/work`                | HELIOS default workdir               |
| `/home/user/.helios`             | Per-session provider env             |

## Rebuilding after upstream updates

If codex or openclaude release breaking CLI changes, bump the version in the
relevant `npm install -g` line, rebuild, and redeploy. HELIOS's backend
files are deliberately forgiving of version drift, but a known-good baseline
lives here.
