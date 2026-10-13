<h1 align="center">Codename-Localhost</h1>

<p align="center"><b>A no-login, no-telemetry, local-model-only build of the Vellum Assistant.</b><br>
Your machine runs the assistant. Your phone talks to it over your own network. Nothing signs in anywhere, and nothing reports anywhere.</p>

---

## What Codename-Localhost is

**Codename-Localhost (CL) is a fork of [vellum-ai/vellum-assistant](https://github.com/vellum-ai/vellum-assistant)** (MIT), made so the
product can be used the way it is advertised — self-hosted, with your own local
model — without a Vellum Cloud account being the price of admission.

Upstream ships a login gate and two outbound reporting channels. CL removes all
three:

| Removed | How |
| --- | --- |
| **Vellum account login / signup** | Nothing in CL ever calls the platform API. The web client ships in local mode with the platform disabled (`VITE_PLATFORM_MODE=false`, `VITE_VELLUM_DISABLE_PLATFORM=true`), so `isLocalClient()` and `isPlatformDisabled()` are both true at runtime and the router guard admits a local-only user instead of redirecting to `/account/login`. The gateway never receives a platform token, so `arePlatformFeaturesEnabled()` is false and platform-backed paths no-op rather than fail. |
| **Device pairing screen** | Requests that arrive *through our own tunnel edge* are pre-approved. See [Pairing](#pairing) below. |
| **Crash reporting (Sentry)** | `initSentry()` returns before `Sentry.init()`; no DSN is baked into the bundle. |
| **Product / funnel analytics** | `postTelemetryEvents()` returns before sending, and the shared `client_*` transport (`sendClientWatchdogEvent`) returns before sending, which retires the boot-timing, perf, switch and resume families in one place. |
| **Server-side usage reporting** | `usage-telemetry-reporter` short-circuits to `"disabled"` whenever platform features are off, so the daemon's local telemetry outbox is never flushed upstream. |

The off-switch for the web client is a single constant,
[`clients/web/src/lib/fork-mode.ts`](clients/web/src/lib/fork-mode.ts) →
`CL_TELEMETRY_ENABLED = false`. It is deliberately **not** driven by
build-time env vars: a fork that silently resumes reporting because someone
rebuilt without the right `VITE_*` set is worse than one that cannot report at
all. Setting it back to `true` restores upstream behaviour for every channel.

### Pairing

Upstream mints a pairing code and waits for a human to approve it on the host.
That is the right second factor for an ingress URL that may be reachable from
the public internet (ngrok, Cloudflare). CL only ever fronts the edge with a
**tailnet-only** tunnel, and the gateway already tracks whether a request
arrived through that edge (`arrivedViaTrustedEdgeProxy` = unspoofable edge
marker **and** a loopback raw peer). Reaching the edge therefore already proves
the caller is on a network only the operator's own devices can join, so
[`remote-web-pairing-challenge.ts`](gateway/src/http/routes/remote-web-pairing-challenge.ts)
approves those challenges in-process at creation. The device's own poll of
`/v1/remote-web/pairing-token` observes `approved` and completes the exchange
unchanged — the phone goes straight to chat.

Direct loopback mints (`vellum pair`) and every non-edge caller are unaffected,
and the loopback guard still runs for them.

### The Android app

The Android app is a thin Capacitor WebView shell — it bundles no web assets and
loads the SPA from `server.url` at runtime. CL rebrands it so it can sit
alongside an upstream install on the same phone:

- application id **`ai.codenamelocalhost.app`** (upstream: `ai.vellum.assistant`)
- display name **"Codename Localhost"** in every locale
- baked origin = your own assistant's HTTPS origin, not a Vellum Cloud hub

Because the shell loads the live SPA over the network, **web changes do not
require an APK rebuild** — only changes to `clients/web/capacitor.config.ts` do.

---

## Verified working configuration

The reference deployment this fork was built and tested against:

| Piece | Value |
| --- | --- |
| Assistant | `cl-localhost`, hatched locally — daemon `:7821`, gateway `:7830` |
| Memory | Qdrant `:6333`, embeddings `Xenova/bge-small-en-v1.5` (local) |
| Model server | `llama-server` (llama.cpp) on `0.0.0.0:5001` |
| Model | `Goetia-26B-A4B-v1.7.i1-Q6_K.gguf`, 64k ctx |
| Ingress | `vellum tunnel --provider tailscale` → nginx edge `127.0.0.1:7840` |
| Public origin | `https://gaming-boi.tailc343dd.ts.net` (tailnet only) |

The assistant is pointed at the local model through the inference layer, not by
patching a URL:

```
connection  llama-local      provider=openai-compatible  auth=none
            base_url         http://127.0.0.1:5001/v1
profile     local-llama      provider_connection=llama-local
            model            .../Goetia-26B-A4B-v1.7.i1-Q6_K.gguf
llm.activeProfile            local-llama
```

`openai-compatible` cannot be a `llm.defaultProvider` — the schema excludes
endpoint-supplied providers because they have no code-resolvable default
profile — so the local model is selected as an **active profile** instead.

End-to-end check that never touches a cloud provider:

```console
$ vellum message "Reply with exactly: LOCAL MODEL ONLINE"
Message accepted
# → assistant replied "LOCAL MODEL ONLINE", generated by llama-server
```

### A note on rebuilding the SPA

The nginx edge **snapshots `index.html`** into
`<workspace>/data/ingress/assistant-index.html` when the edge starts, and serves
that copy at `/assistant/`. If you rebuild `clients/web/dist` with the edge
running, the served shell keeps pointing at the old asset hashes and the app
fails to boot. Restart the edge after a web rebuild:

```console
$ kill "$(cat <workspace>/data/ingress/nginx.pid)"
$ vellum tunnel cl-localhost --provider tailscale -d
```

---

<p align="center"><i>Everything below this line is upstream Vellum Assistant documentation, kept for reference.</i></p>

---

<p align="center">
  <img src="assets/banner.png" alt="Vellum Assistant" width="100%">
</p>

<p align="center">
  <a href="https://vellum.ai/docs"><img src="https://img.shields.io/badge/Docs-vellum.ai%2Fdocs-FFD700?style=for-the-badge" alt="Documentation"></a>
  <a href="https://vellum.ai/community"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/vellum-ai/vellum-assistant/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://vellum.ai"><img src="https://img.shields.io/badge/Built%20by-Vellum-blueviolet?style=for-the-badge" alt="Built by Vellum"></a>
</p>

<p align="center"><b>A personal AI assistant that evolves with you.</b><br>
8 different types of memory (episodic, semantic, procedural, emotional, prospective, behavioral, narrative, shared) make it truly yours. It learns how you work, remembers what matters, and takes action across your apps.</p>

---

## What It Does

If you've set up a Personal AI on OpenClaw, Hermes Agent, or Claude Code, you know how long it takes, and how many times you have to hatch a new one to get it right. Vellum gets you the result you're looking for out of the box, one download away.
| Area                          | Summary |
| ----------------------------- | --- |
| **Memory**                    | Eight types (episodic, semantic, procedural, emotional, prospective, behavioral, narrative, shared), each with its own staleness window, hybrid dense + sparse retrieval, and per-user and per-channel isolation. Structured items (identity, preferences, projects, events) extracted from conversations with source attribution and dedup. Embeddings run locally by default. Not a SQLite + Markdown file you maintain yourself. |
| **Identity**                  | Behavior lives in SOUL.md. During onboarding the assistant observes how you communicate and writes its own personality files. It keeps a per-user journal of reflections and uses NOW.md as a scratchpad for current focus and active threads. |
| **Proactivity**               | Every hour the assistant re-reads its notes, looks for anything unfinished or due soon, and messages you if something needs attention. Notifications go to the right channel and won't interrupt an active conversation. |
| **Security**                  | Actor identity (guardian, trusted, unknown) is resolved once and enforced everywhere; unknown actors can't read memory, trigger tools, or escalate. Credentials live in a separate process and never reach the model. Every tool call runs in a sandbox. The default is to deny. |
| **Channels**           | macOS, Windows, iOS, Web, Voice, Email, Telegram, Slack, Twilio. One assistant, one memory, every channel. |
| **OAuth**             | Slack, Notion, Google, HubSpot, Linear, Discord, Twitter, Telegram, Twilio. No hand-rolled token refresh. |
| **Hosting**      | Managed runtime on Vellum Platform, or self-hosted. Same codebase, same data model. |

---

## Get Started

**1. [Sign up](https://vellum.ai/signup) or [download the app](https://vellum.ai/downloads)**

The desktop app is available for macOS and Windows. The Windows download is currently a dev build connected to the development environment, with x64 (Intel/AMD) and ARM64 installers. See the [installation guide](https://www.vellum.ai/docs/getting-started/installation) for setup and permissions.

**2. Pick your mode**

- **Managed**: sign in via Vellum Cloud, no local runtime required
- **Local**: everything runs on your machine

**3. Hatch your assistant**

- It's yours! Have fun with it.

<sub>Prefer the terminal? See <a href="#cli">CLI install</a> below.</sub>

---

## Quick Demo

<p align="center">
  <img src="assets/quick-demo.gif" alt="Vellum Assistant demo" width="100%">
</p>

---

## CLI

<details open>
<summary>Install and common commands</summary>

<br>

The CLI works but the desktop app is our primary focus. Available for advanced users, contributors, and terminal-based workflows. The Windows desktop app installs the bundled CLI for your user account on first launch; open a new terminal afterward to use `vellum`.

**Install**

```bash
bun install -g vellum
vellum hatch
```

**Install from source**

```bash
git clone https://github.com/vellum-ai/vellum-assistant.git
cd vellum-assistant
./setup.sh
source ~/.bashrc
vellum hatch
```

**Common commands**

```bash
vellum wake        # start services
vellum sleep       # stop services, keep data
vellum client      # interact through the terminal
vellum ps          # view running assistants
vellum terminal    # open a shell into a managed assistant container
vellum upgrade     # upgrade to latest version
```

All commands target the default assistant. If you have multiple, pass the assistant ID as the second argument.

**Guides**

- [Pair a device](https://vellum.ai/docs/hosting-options/pair-a-device): reach a self-hosted assistant from your phone or another computer by opening a tunnel and pairing the device.

</details>

---

## Infra and security

| Area                       | Summary                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Computer use**           | The assistant works in its own sandbox, and with your approval reaches your actual machine: reads and edits files, runs commands, drives the browser. Every action is permission-gated, and you can grant once, for ten minutes, or always. |
| **Skills**                 | Plugins defined by a SKILL.md and a TOOLS.json that add tools and prompt sections at runtime, sandboxed like everything else. Install them from the catalog, bundle them, or drop them in the workspace.                                                                                      |
| **Channels**               | One assistant with one memory, reachable from the macOS or Windows app, Telegram, or Slack. Start a thought in one channel and pick it up in another.                                                                                                                                                              |
| **Multi-provider support** | Works with Anthropic, OpenAI, Google Gemini, Fireworks, OpenRouter, MiniMax, [Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=vellum-assistant), and any OpenAI-compatible endpoint. Local models run through Ollama. Embeddings run on local ONNX by default and fall back to cloud providers automatically.                                                                                    |

---

## Foundational documents

The canonical sources for who we are and how we talk about what we're building. The docs site at [vellum.ai/docs](https://vellum.ai/docs) is a rendered view of these files.

| Doc                             | What it is                                                       |
| ------------------------------- | ---------------------------------------------------------------- |
| [Constitution](CONSTITUTION.md) | Who we are, what we believe, and what we refuse to compromise on |
| [Glossary](GLOSSARY.md)         | The shared vocabulary we use to talk about personal intelligence |

---

## Documentation

| Section                                                                             | What's covered                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Architecture](https://vellum.ai/docs/developer-guide/architecture)                 | Platform domains, repo structure, runtime · clients · gateway      |
| [Security & Permissions](https://vellum.ai/docs/developer-guide/security)           | Sandbox, credentials, trust rules, permission modes                |
| [Features & Capabilities](https://vellum.ai/docs/developer-guide/features)          | Integrations, dynamic skills, browser, attachments, media embeds   |
| [API & Communication](https://vellum.ai/docs/developer-guide/api)                   | SSE event stream, event payloads, remote access                    |
| [Development Workflow](https://vellum.ai/docs/developer-guide/development-workflow) | Claude Code commands, parallel PRs, review loops, release pipeline |

📖 **[Full documentation →](https://vellum.ai/docs)**

---

## Contributing

We welcome contributions from everyone.

- **Development**: The [contributing guide](CONTRIBUTING.md) will help you get started.
- Make sure to check out our [Code of Conduct](CODE_OF_CONDUCT.md).

## Community

- 💬 [Discord](https://vellum.ai/community)
- 🐛 [Issues](https://github.com/vellum-ai/vellum-assistant/issues)

## License

MIT. See [License](https://github.com/vellum-ai/vellum-assistant?tab=MIT-1-ov-file). Integration logos from [Simple Icons](https://github.com/simple-icons/simple-icons), licensed [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

Vellum Assistant is open-source software built by [Vellum AI](https://vellum.ai), a for-profit company. We also offer a managed product, the [Vellum Platform](https://vellum.ai/platform), which sustains the business. Free to use and modify under MIT, and we're committed to keeping it that way.

---

<p align="center">Built with 💚 by <a href="https://vellum.ai">Vellum</a></p>
