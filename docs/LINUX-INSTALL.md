# Installing Codename-Localhost on Linux

This guide takes a clean Linux box to a working Codename-Localhost (CL)
assistant: no Vellum Cloud account, no telemetry, your own local model, and a
phone app that talks to it over your own network.

CL is a fork of [vellum-ai/vellum-assistant](https://github.com/vellum-ai/vellum-assistant).
See the [README](../README.md) for what the fork removes and why.

**Tested on:** Debian/Ubuntu-family x86_64. The reference deployment this guide
was written against is in the README's "Verified working configuration" table.

---

## 0. What you end up with

| Piece | Where |
| --- | --- |
| Assistant daemon | `127.0.0.1:7821` (loopback only) |
| Gateway (API the app talks to) | `:7830` |
| nginx tunnel edge | `127.0.0.1:7840` |
| Vector memory (Qdrant) | `127.0.0.1:6333`, provisioned automatically |
| Embeddings | local `Xenova/bge-small-en-v1.5`, no API calls |
| Public origin | your own HTTPS origin, reachable from your tailnet only |

Nothing listens on a public interface. The only way in is the tunnel.

---

## 1. Prerequisites

### System packages

```console
sudo apt update
sudo apt install -y git curl build-essential sqlite3 nginx
```

| Package | Why |
| --- | --- |
| `nginx` | `vellum tunnel` fronts the assistant with a local nginx edge. **Required.** |
| `sqlite3` | the daemon shells out to it for async queries |
| `build-essential` | native module builds during install |
| `curl` | health checks and the local-model probe below |

### Bun and Node

```console
curl -fsSL https://bun.sh/install | bash
# Node 22 LTS — the assistant targets it
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Confirm both resolve before continuing:

```console
bun --version    # 1.4.x
node --version   # v22.x
```

### A local model server

CL talks to any OpenAI-compatible endpoint. This guide assumes **llama.cpp's
`llama-server`** on `127.0.0.1:5001`, which is what the reference deployment
uses. If yours is already running, skip ahead — just note the port.

```console
curl -sS http://127.0.0.1:5001/v1/models
```

You want a JSON reply listing your model's path. If that command fails, fix it
before continuing; nothing below can work without a live endpoint.

> **Context window matters.** Note your server's actual context size (`-c`).
> The default CL profile advertises `maxInputTokens: 200000`, which is *larger
> than a typical local server's window*. A long conversation can therefore pass
> the client's own budget check and still be rejected upstream. Either raise the
> server's `-c` or lower the profile's `contextWindow.maxInputTokens` to match.
> See [Troubleshooting](#9-troubleshooting).

### Tailscale (for the tunnel)

```console
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Then grant your user the operator role so `vellum tunnel` can configure serve
without sudo:

```console
sudo tailscale set --operator=$USER
```

Skip this and the tunnel fails with `Access denied: serve config denied`.

---

## 2. Get the code

```console
git clone https://github.com/PyroXFire/vellum-assistant.git codename-localhost
cd codename-localhost
```

Then install the workspace dependencies:

```console
bun install
```

This resolves the whole monorepo (CLI, assistant, gateway, web client) —
expect ~1700 packages and about 20 seconds on a warm cache.

---

## 3. Hatch the assistant

`hatch` creates the instance and starts its processes. The two flags that
matter for CL are `--remote local` (native processes, not Docker) and
`--disable-platform` (never call the Vellum platform API).

```console
export PATH="$HOME/.bun/bin:$PATH"
bun run cli/src/index.ts hatch \
  --name cl-localhost \
  --remote local \
  --disable-platform
```

Expect it to end with the assistant ready and the gateway listening. If you'd
rather it detach and return, add `-d`.

> Docker is **not** required. `--remote local` runs the daemon and gateway as
> ordinary host processes. If Docker *is* installed but not running, be explicit
> about `--remote local` anyway — the default target may differ.

Verify the stack came up:

```console
bun run cli/src/index.ts ps
```

You should see the daemon, the gateway, the credential-executor, the schedule
and monitoring workers, and Qdrant.

### If you ever need to restart it

```console
bun run cli/src/index.ts sleep cl-localhost   # stop everything cleanly
bun run cli/src/index.ts wake  cl-localhost   # start assistant + gateway + edge
```

`wake` also starts the tunnel edge, so you rarely need to re-run `tunnel`
separately unless you changed the web build (see §7).

---

## 4. Point the assistant at your local model

This is the step that makes CL *local*. It is done through the inference layer,
not by patching a URL.

### 4a. Register the connection

`openai-compatible` connections live in the daemon's SQLite store, not in
`config.json`. The REST field is **`base_url`** — the camelCase `baseUrl` is
rejected with a 400.

Easiest is the daemon API, using the assistant's own token:

```console
TOK=$(python3 -c "import json;print(json.load(open('$HOME/.config/vellum/assistants/cl-localhost/guardian-token.json'))['accessToken'])")

curl -sS -X POST http://127.0.0.1:7821/v1/inference/connections \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{
        "name": "llama-local",
        "provider": "openai-compatible",
        "auth": {"type": "none"},
        "base_url": "http://127.0.0.1:5001/v1",
        "models": [{"id": "local", "displayName": "Local model"}]
      }'
```

The daemon probes the endpoint on creation and reports whether it reached it.
If it reports failure, your model server is not reachable from the daemon's
namespace — fix that first.

### 4b. Create the profile and make it active

`openai-compatible` **cannot** be an `llm.defaultProvider`. The config schema
excludes endpoint-supplied providers because they have no code-resolvable
default profile. Select your local model as an **active profile** instead:

```console
cd ~/codename-localhost/assistant
export VELLUM_WORKSPACE_DIR=$HOME/.local/share/vellum/assistants/cl-localhost/.vellum/workspace
export VELLUM_ENVIRONMENT=local VELLUM_CLOUD=local VELLUM_DEV=1
bun run src/index.ts config set llm.activeProfile local-llama
bun run src/index.ts config set llm.advisorProfile local-llama
```

> **`VELLUM_WORKSPACE_DIR` is required** for assistant-scoped `config`
> commands. Without it the CLI looks in `~/.vellum/workspace`, finds no socket,
> and fails with "Could not connect to the assistant". The path is printed in
> the daemon's environment; `tr '\0' '\n' < /proc/$(pgrep -f daemon/main.ts)/environ | grep VELLUM_WORKSPACE_DIR`
> recovers it.

If `local-llama` doesn't exist yet as a profile, create it first — a minimal
definition in `<workspace>/config.json`:

```json
{
  "llm": {
    "profiles": {
      "local-llama": {
        "label": "Local llama.cpp",
        "provider": "openai-compatible",
        "provider_connection": "llama-local",
        "model": "/absolute/path/to/your-model.gguf",
        "maxTokens": 16000
      }
    },
    "activeProfile": "local-llama",
    "advisorProfile": "local-llama"
  }
}
```

### 4c. Why `advisorProfile` matters more than it looks

The advisor subagent is **the only code path that runs on
`llm.advisorProfile`**. Everything else — normal chat — runs on
`activeProfile`. So if `advisorProfile` names a managed cloud profile while you
have no cloud credential:

- normal chatting works fine
- features that consult the advisor (personality/persona updates among them)
  hang and then error

This is the single most common "everything works except this one thing"
failure in a CL install. Point it at your local profile.

### 4d. Repoint the auxiliary call sites

Several small call sites (`homeGreeting`, `conversationTitle`,
`replySuggestion`, `homeSuggestedPrompts`, `conversationStarters`) default to
managed "cost-optimized" tiers that resolve to a cloud model. With no cloud key
they return null and the feature silently does nothing — no greeting, no
auto-titles. Repoint them:

```console
for s in conversationTitle replySuggestion homeGreeting homeSuggestedPrompts conversationStarters; do
  bun run src/index.ts config set "llm.callSites.$s.profile" local-llama
done
```

### 4e. Prove it end to end

```console
cd ~/codename-localhost
bun run cli/src/index.ts message "Reply with exactly: LOCAL MODEL ONLINE"
```

Then read the reply:

```console
cat ~/.local/share/vellum/assistants/cl-localhost/.vellum/workspace/conversations/*/messages.jsonl | tail
```

If you see `LOCAL MODEL ONLINE` and no cloud key is configured anywhere, the
local path works. A direct probe of the model server is also worth doing:

```console
curl -sS http://127.0.0.1:5001/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"local","messages":[{"role":"user","content":"Reply with exactly: LOCAL MODEL ONLINE"}],"max_tokens":20,"temperature":0}'
```

---

## 5. Build the web client

The web client must be built in local mode with the platform disabled. These
are **build-time** flags — the runtime off-switch (`CL_TELEMETRY_ENABLED`) is a
plain constant in the source and is not env-driven, by design.

```console
cd ~/codename-localhost/clients/web
export VITE_PLATFORM_MODE=false
export VITE_VELLUM_DISABLE_PLATFORM=true
# make sure no telemetry DSNs leak in from the environment
unset VITE_SENTRY_DSN VITE_SENTRY_DSN_ANDROID VITE_SENTRY_DSN_IOS \
      VITE_SENTRY_DSN_MACOS VITE_SENTRY_DSN_WINDOWS VITE_SENTRY_DSN_LINUX \
      VITE_SENTRY_ENVIRONMENT
bun run build
```

Verify the flags actually reached the bundle — grep for the inlined literal,
not the bare variable name:

```console
grep -o 'VITE_VELLUM_DISABLE_PLATFORM:"true"' dist/assets/*.js | head
```

If that prints nothing, the build did not inline the flag and the app will show
a login screen. Re-run the build with the exports set.

---

## 6. Open the tunnel

```console
cd ~/codename-localhost
export PATH="$HOME/.bun/bin:$PATH"
export NGINX_BIN=/usr/sbin/nginx          # nginx is not on PATH on Debian/Ubuntu
bun run cli/src/index.ts tunnel cl-localhost --provider tailscale -d
```

> **`NGINX_BIN` is required when nginx isn't on `PATH`.** The tunnel resolves
> nginx as `process.env.NGINX_BIN || "nginx"`; on Debian/Ubuntu the binary is at
> `/usr/sbin/nginx`, which is not in a default user `PATH`.

> **The command may report failure on success.** You may see
> `tunnel process exited during startup (exit code 0)` while the serve is in
> fact published — tailscaled backgrounds it. Always read
> `~/.config/vellum/logs/tunnel-*.log` before believing the error.

Confirm the mapping and that it serves:

```console
tailscale serve status
curl -sSL -o /dev/null -w '%{http_code} %{url_effective}\n' https://<your-node>.<tailnet>.ts.net/
```

Expect a 200 landing on `/assistant/`. Your phone can now reach the assistant —
**but only while on the tailnet.**

### Firewall

The tunnel edge listens on loopback, so no inbound rule is needed for it. If you
want to serve files to your phone over the tailnet (for example the APK, §8),
allow that port on the tailscale interface only:

```console
sudo ufw allow in on tailscale0 to any port 8080 proto tcp comment 'CL apk share'
```

---

## 7. Rebuilding the web client (the one real gotcha)

The nginx edge **snapshots `index.html`** into
`<workspace>/data/ingress/assistant-index.html` when the edge starts, and serves
*that copy* at `/assistant/`.

If you rebuild `clients/web/dist` while the edge is running, the served shell
still points at the **old asset hashes**. The app then fails to boot — the main
chunk 404s and you get a blank screen or an endless spinner. Always restart the
edge after a web rebuild:

```console
kill "$(cat ~/.local/share/vellum/assistants/cl-localhost/.vellum/workspace/data/ingress/nginx.pid)"
cd ~/codename-localhost
export NGINX_BIN=/usr/sbin/nginx
bun run cli/src/index.ts tunnel cl-localhost --provider tailscale -d
```

Confirm the edge and the dist agree before you blame the app:

```console
grep -o 'assets/app-[A-Za-z0-9_-]*\.js' ~/.local/share/vellum/assistants/cl-localhost/.vellum/workspace/data/ingress/assistant-index.html | head -1
grep -o 'assets/app-[A-Za-z0-9_-]*\.js' ~/codename-localhost/clients/web/dist/index.html | head -1
```

Those two hashes must match.

---

## 8. Build and deliver the Android app

### Build the APK

```console
cd ~/codename-localhost/clients/android
export PATH="$HOME/.bun/bin:$PATH:$HOME/Android/Sdk/platform-tools"
export ANDROID_HOME="$HOME/Android/Sdk"
./gradlew assembleProductionDebug
```

The APK lands at:

```
clients/android/app/build/outputs/apk/production/debug/app-production-debug.apk
```

**The app is a thin Capacitor shell** — it bundles no web assets and loads the
SPA from `server.url` at runtime. Consequence: **web changes do not require an
APK rebuild.** Only edits to `clients/web/capacitor.config.ts` (the baked origin
or the app id) do.

Check what got baked in:

```console
~/Android/Sdk/build-tools/36.0.0/aapt2 dump badging \
  app/build/outputs/apk/production/debug/app-production-debug.apk \
  | grep -E '^package|application-label'
```

### Get it onto your phone

`MEDIA:` paths and local file paths only resolve on the host — a remote chat
client cannot read a file on your server. Serve the APK over the tailnet
instead:

```console
mkdir -p ~/apk-share
cp clients/android/app/build/outputs/apk/production/debug/app-production-debug.apk ~/apk-share/
cd ~/apk-share && python3 -m http.server 8080 --bind 0.0.0.0
```

Then open this on the phone (it must be on the tailnet):

```
http://<your-node>.<tailnet>.ts.net:8080/app-production-debug.apk
```

Allow the firewall rule from §6 first. The browser will warn about installing an
unknown app — that's expected for a debug-signed build.

> The APK is **debug-signed**. Fine for sideloading your own device; not
> suitable for distribution. For a release build you'll need your own signing
> key and `assembleProductionRelease`.

---

## 9. Troubleshooting

### The app shows a login screen

The web client was built without the local-mode flags. Rebuild per §5 and
confirm the inlined literal with the `grep` shown there. The login screen is a
*routing* outcome, not an auth check — with the flags set, the guard admits a
local-only user.

### The app hangs on "Waiting for approval" / a pairing code

You reached the SPA but not through the trusted edge — most likely you're
hitting a stale or plain-HTTP origin. CL pre-approves pairing challenges that
arrive through its own tunnel edge; a request arriving by any other path still
needs manual approval. Check `tailscale serve status` and make sure the origin
the phone loads is the one proxying to `127.0.0.1:7840`.

### A feature hangs for minutes then errors, while chat works

That's the advisor. See §4c — set `llm.advisorProfile` to a profile you can
actually reach. The advisor has a 5-minute wall-clock ceiling, so "hangs then
errors" is its signature.

### A feature silently does nothing (no greeting, no auto-titles)

A call site is resolving a managed cloud tier. See §4d. Look for
`Connection resolved to no usable adapter` in the assistant log:

```console
grep -A4 'no usable adapter' \
  ~/.local/share/vellum/assistants/cl-localhost/.vellum/workspace/data/logs/assistant-*.log \
  | grep callSite: | sort | uniq -c
```

Any `callSite:` you see there needs an explicit profile.

### Blank app / `net::ERR_ABORTED` on the main chunk

The edge is serving a stale `index.html`. See §7.

### `Access denied: serve config denied`

```console
sudo tailscale set --operator=$USER
```

### `Connection resolved to no usable adapter` for the advisor specifically

`llm.advisorProfile` still names a cloud profile. See §4c.

### The model server rejects long prompts

Your profile advertises a bigger context window than the server provides. Lower
`contextWindow.maxInputTokens` in the profile to match the server's `-c`, or
raise the server's `-c`.

### Where the logs are

| Log | Path |
| --- | --- |
| Assistant | `<workspace>/data/logs/assistant-*.log` |
| Gateway | `<instance>/.vellum/protected/logs/gateway-*.log` (and `.jsonl`) |
| nginx edge | `<workspace>/data/logs/nginx-ingress.log` |
| Tunnel supervisor | `~/.config/vellum/logs/tunnel-*.log` |

where `<workspace>` is
`~/.local/share/vellum/assistants/cl-localhost/.vellum/workspace`.

---

## 10. Day-2 operations

```console
bun run cli/src/index.ts ps                 # list instances and processes
bun run cli/src/index.ts logs cl-localhost  # tail logs
bun run cli/src/index.ts sleep cl-localhost # stop cleanly
bun run cli/src/index.ts wake  cl-localhost # start again (incl. edge)
```

Nothing in CL ever calls `vellum login` or `vellum logout`, and no command
requires a Vellum account. If a command asks you to authenticate to the
platform, something is misconfigured — check that the instance was hatched with
`--disable-platform`.
