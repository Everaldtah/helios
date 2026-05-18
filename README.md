# HELIOS

> **HELIOS** is a coding-agent harness that orchestrates two open-source
> coding agents — [`openai/codex`](https://github.com/openai/codex) and
> [`Gitlawb/openclaude`](https://github.com/Gitlawb/openclaude) — as
> subprocesses inside an [E2B](https://e2b.dev) Linux sandbox.
>
> Built originally for the [Solis](https://github.com/Everaldtah/SOLIS-AGENT)
> agent, but designed as a standalone library: any host app that wants the
> combined capability of both CLIs behind one unified tool surface can use
> HELIOS as a dependency.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-43853d.svg)](package.json)
[![E2B-powered](https://img.shields.io/badge/sandbox-E2B-orange.svg)](https://e2b.dev)

---

## Why HELIOS

OpenClaude and Codex are both excellent — and they're good at different
things. OpenClaude (Node/TypeScript) is rich in file tools, web search,
LSP, and broad provider support. Codex (Rust) is stronger at sandboxed
execution, the apply-patch format, MCP federation, and cloud-task offload.

A host app shouldn't have to pick one. HELIOS gives you **one tool schema**
that the host's LLM is given; under the hood each tool routes to the
backend that's strongest at it. Where both have gaps (web app session
stickiness for an E2B sandbox, unified provider config across both CLIs,
event-stream normalization), HELIOS's JS layer fills them in.

### Capability matrix

| Capability                          | Backend                | Why                                            |
|-------------------------------------|------------------------|------------------------------------------------|
| Sandboxed shell exec                | direct shell in E2B    | E2B is already isolated                        |
| Apply patch (`apply_patch`)         | codex                  | Battle-tested `apply-patch` format             |
| Free-form multi-file code task      | openclaude             | Richer file tools, sub-agent/task model        |
| File read / write / glob / grep     | openclaude (ripgrep)   | Fast, direct                                   |
| Web search / web fetch              | openclaude             | codex has none                                 |
| MCP server federation               | codex `mcp`            | Strongest MCP impl                             |
| Memory recall / save                | host-app callback      | Stays where the host wants it                  |

Gaps in either upstream that HELIOS fills:
- **Stream normalization** — codex JSONL ≠ openclaude stream-json → one `HeliosEvent` type.
- **Session-sticky sandbox** — neither CLI owns this for a web app context.
- **Single-config provider routing** — both CLIs share one OpenAI-compatible base URL + key.

---

## Install

```bash
npm install @everaldtah/helios
```

Or, while iterating, install directly from git:

```bash
npm install github:Everaldtah/helios
```

You also need an E2B account and the `helios-base` template uploaded
once. From this repo's `e2b-template/` directory:

```bash
npm install -g @e2b/cli
e2b auth login
cd e2b-template
e2b template build
```

---

## Quick start

```ts
import { HeliosHarness } from '@everaldtah/helios';

const helios = new HeliosHarness({
  provider: {
    baseUrl: 'https://integrate.api.nvidia.com/v1',  // or any OpenAI-compatible
    apiKey:  process.env.NVIDIA_API_KEY!,
    model:   'meta/llama-3.3-70b-instruct',
  },
  e2b: {
    apiKey:   process.env.E2B_API_KEY!,
    template: 'helios-base',
  },
});

// Per chat session — pass an existing SandboxHandle to reconnect.
const session = await helios.resumeSession('user-42', /* optional savedHandle */);

// Give the LLM the tool schema:
const tools = HeliosHarness.tools();

// When the LLM calls a tool, dispatch via HELIOS:
for await (const ev of session.exec('shell', { command: 'uname -a' })) {
  // ev is a HeliosEvent — forward to SSE / WebSocket / your stream of choice
  console.log(ev);
}

// Persist sandbox stickiness in your session store:
const handle = session.handle();   // { sandboxId, createdAt }
```

The `handle` keeps the same sandbox alive across requests. On the next
turn, pass it to `resumeSession` and HELIOS reconnects (or transparently
spins a fresh sandbox if E2B has reaped the old one).

---

## Standalone sandbox CLI (`helios-sandbox`)

If you just want a sandbox with HELIOS preinstalled to **poke at
interactively** — no host app, no Solis — use the `helios-sandbox`
launcher. It spawns (or reattaches to) an E2B sandbox, makes sure the
`helios` CLI is on `PATH`, injects your provider credentials, and drops
you into a raw-mode `bash` over a PTY.

```bash
export E2B_API_KEY=e2b_...
export NVIDIA_API_KEY=nvapi-...            # or OPENAI_API_KEY for non-NIM
export HELIOS_MODEL=deepseek-ai/deepseek-v4-pro   # optional, default is this
export HELIOS_E2B_TEMPLATE=helios-base     # optional; falls back to default image

npx -p @everaldtah/helios helios-sandbox
```

Inside the resulting shell:

```bash
helios --help
helios shell "uname -a"
helios prompt --backend openclaude "list files in /tmp"
codex --help          # also preinstalled in helios-base
openclaude --help     # also preinstalled in helios-base
```

The sandbox id is cached in `~/.helios/cli-sandbox.json`, so re-running
`helios-sandbox` reconnects to the same box (until E2B reaps it — by
default the launcher requests a 1-hour idle TTL). Type `exit` in the
shell to disconnect without killing the sandbox.

---

## Tool surface

`HeliosHarness.tools()` returns OpenAI-format tool definitions you can pass
straight into `chat.completions`. The tools are:

| Tool          | What it does                                                |
|---------------|-------------------------------------------------------------|
| `shell`       | Run a bash command in the session's sandbox                 |
| `read_file`   | Read a file from the sandbox                                |
| `write_file`  | Write a file in the sandbox (creates parents)               |
| `grep`        | ripgrep search in the sandbox                               |
| `glob`        | Filesystem glob (e.g. `**/*.ts`)                            |
| `apply_patch` | Apply a unified diff (codex apply-patch format)             |
| `code_task`   | Delegate a free-form coding task to codex or openclaude     |
| `web_search`  | Web search via openclaude                                   |
| `web_fetch`   | Fetch a URL and return its body                             |

Each tool emits a stream of `HeliosEvent`s — see `src/types.ts`.

---

## Streaming

```ts
import { toSSE } from '@everaldtah/helios';

for await (const ev of session.exec(toolName, args)) {
  response.write(toSSE(ev));    // server-sent-events out
}
```

Or collect synchronously:

```ts
import { collect } from '@everaldtah/helios';
const { ok, stdout, stderr, reply, files } = await collect(session.exec(toolName, args));
```

---

## Architecture

```
host app (e.g. Solis /chat)
        │
        │ session.exec(toolName, args)
        ▼
┌─────────────────────┐
│   HeliosHarness     │  one instance per process
└────────┬────────────┘
         │ resumeSession()
         ▼
┌─────────────────────┐
│   HeliosSession     │  one per chat session, sticky sandbox
└──┬───────┬───────┬──┘
   │       │       │
   ▼       ▼       ▼
 Shell   Codex   Openclaude     all run subprocesses inside…
   │       │       │
   ▼       ▼       ▼
┌──────────────────────────┐
│   E2B sandbox            │  sticky per session via SandboxHandle
│   (template: helios-base)│
└──────────────────────────┘
```

---

## Solis integration

For the canonical wiring (memory bridge, session storage, SSE forwarding,
graceful shell_exec retirement), see [`examples/solis-integration.md`](examples/solis-integration.md).

---

## License & credits

HELIOS is MIT-licensed. It is **original code** that orchestrates two
upstream projects as subprocesses; it contains no copied source from
either:

- [`openai/codex`](https://github.com/openai/codex) — Apache 2.0
- [`Gitlawb/openclaude`](https://github.com/Gitlawb/openclaude) — see upstream LICENSE

Both are installed at runtime via their official distribution channels
and run under their own licenses.

---

## Project relationship

HELIOS was extracted from the [Solis](https://github.com/Everaldtah/SOLIS-AGENT)
agent (formerly TermuxClawAgent) to make the harness reusable. Solis
itself depends on HELIOS as a git dependency.
