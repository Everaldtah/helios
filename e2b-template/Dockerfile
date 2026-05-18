# helios-base — E2B template image for HELIOS.
#
# Bakes both upstream coding-agent CLIs (codex + openclaude) plus the tools
# they expect into a single Ubuntu 22.04 image so a fresh session needs zero
# install time. Solis points its e2b SDK at `helios-base` and gets a sandbox
# with everything ready.

FROM e2bdev/code-interpreter:latest

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_VERSION=22 \
    HELIOS_VERSION=0.1.0

# ── System tools the harness uses directly ───────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git build-essential pkg-config \
      ripgrep jq unzip \
    && rm -rf /var/lib/apt/lists/*

# ── Node 22 (matches HELIOS's engines.node) ──────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node --version && npm --version

# ── Bun (openclaude's preferred runtime; some of its scripts use it) ─────────
RUN curl -fsSL https://bun.sh/install | bash \
    && ln -sf /root/.bun/bin/bun /usr/local/bin/bun \
    && bun --version

# ── codex (openai/codex) — npm installs and self-downloads the Rust binary ──
RUN npm install -g @openai/codex \
    && codex --version

# ── openclaude (Gitlawb/openclaude) — pure Node TUI/CLI ──────────────────────
RUN npm install -g @gitlawb/openclaude \
    && openclaude --version

# ── HELIOS CLI itself — so `helios shell|prompt|tools` works inside the box ──
# Installed from GitHub because the package isn't on npm yet. The package's
# `prepare` script runs `tsc` to build dist/ at install time.
RUN npm install -g github:Everaldtah/helios \
    && helios --help >/dev/null \
    && echo "HELIOS CLI installed"

# ── User dirs HELIOS expects ─────────────────────────────────────────────────
RUN mkdir -p /home/user/work /home/user/.helios \
    && chown -R user:user /home/user || true

WORKDIR /home/user/work
USER user
