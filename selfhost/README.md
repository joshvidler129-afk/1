# Self-hosting HackerAI

Run your own instance of the open-source [hackerai.co](https://hackerai.co) app
([github.com/hackerai-tech/hackerai](https://github.com/hackerai-tech/hackerai)) —
its real system prompt, its `auto` model routing, its tools, and its own
authorization gate — with your own API keys and **no HackerAI subscription**.

This directory is a deploy helper, not a fork. `bootstrap.sh` prepares a server
and clones the upstream app; you then run the app's own setup wizard.

## Read this first (the honest reality)

- **It does not run on a phone.** It's a Next.js + Convex + Trigger.dev app. You
  need an always-on Linux server. Your phone is only the client (a browser).
- **"Free of the paywall" ≠ "free."** Self-hosting removes HackerAI's
  subscription, but the app still calls paid/limited third-party services. A
  minimal instance needs accounts on **7** of them (below). You pay those
  providers directly — for cheap/free-tier OpenRouter models that can be ~$0,
  but E2B, S3, and WorkOS have their own limits.
- **"Unlimited requests"** means no HackerAI cap — you're then bounded by
  whatever your OpenRouter / OpenAI / E2B usage and their free tiers allow.
- **License: Apache 2.0 _with Commercial Restrictions_** (`LICENSE`, © HackerAI, LLC).
  Personal, non-revenue self-hosting is permitted. Using it for **commercial
  purposes** — offering paid services, selling access, or bundling it into
  anything that generates revenue — requires a separate commercial license
  (contact@hackerai.co). This bundle is for personal use.
- **No production Docker for the app itself.** Upstream documents the *dev*
  workflow and assumes Vercel + managed SaaS for production. Running it yourself
  means running the dev servers (or `next build`/`next start`) under a process
  manager on your box.

## The models & the "uncensored" question

The default is standard open models (DeepSeek, Qwen, …) via OpenRouter plus a
pentest-tuned system prompt — all included when you self-host. The genuinely
uncensored `abliteration.ai` fallback is **double-gated and off by default**: it
only activates if you both set `ABLITERATION_API_KEY` *and* configure a PostHog
`test` flag. Leave the key blank (the wizard does) and don't wire up PostHog, and
your instance keeps the models' normal behavior. This bundle documents leaving it
off; enabling it is your decision as the operator.

## Prerequisites

1. **A server.** Simplest always-free option: an
   [Oracle Cloud "Always Free"](https://www.oracle.com/cloud/free/) Ampere ARM
   instance (up to 4 vCPU / 24 GB RAM), Ubuntu 22.04. A 1 GB micro is too small —
   `next build` for this app wants ~2 GB+ RAM. Both x64 and arm64 are supported.
2. **Free accounts** (get keys as the checklist walks you through them):
   OpenRouter, OpenAI, E2B, AWS S3, WorkOS, Trigger.dev — and Convex *unless* you
   pick the local Convex option. Details and signup links in
   [`ENV_CHECKLIST.md`](./ENV_CHECKLIST.md).

## Quick start

On the server (as a sudo-capable user):

```bash
# 1. get this repo (or just copy selfhost/bootstrap.sh over)
git clone <this-repo> && cd <this-repo>

# 2. prepare the machine + clone the app into ~/hackerai
bash selfhost/bootstrap.sh

# 3. run the app's interactive setup (needs your keys)
cd ~/hackerai
pnpm run setup
```

The wizard: prompts for OpenRouter / OpenAI / E2B / AWS S3 / WorkOS keys;
auto-generates the server secrets (`WORKOS_COOKIE_PASSWORD`,
`CONVEX_SERVICE_ROLE_KEY`, `ACCOUNT_IDENTITY_HMAC_SECRET`); asks
**"Use a local Convex deployment? (y/N)"** — choose **y** to run Convex on the box
with no Convex account; writes `.env.local`; and leaves `ABLITERATION_API_KEY` blank.

## Point it at your server (not localhost)

The wizard hardcodes localhost. Edit `~/hackerai/.env.local`:

```
NEXT_PUBLIC_BASE_URL=https://your-domain-or-ip
NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://your-domain-or-ip/callback
```

Then in the **WorkOS dashboard** set the same callback URL and create an **Admin**
role (the wizard prints these steps). A mismatch breaks login.

## Run it

```bash
pnpm run dev          # cloud Convex
# or
pnpm run dev:local    # if you chose the local Convex option
```

Open `https://your-domain-or-ip` from your phone's browser and sign in.

**Agent mode** (terminal/browser tools) is optional and needs a
[Trigger.dev](https://cloud.trigger.dev) project plus a third long-running
process — see [`ENV_CHECKLIST.md`](./ENV_CHECKLIST.md#agent-mode-trigger-dev):

```bash
pnpm dev:trigger
```

## Keep it running across reboots

General options (not app-specific):

- **pm2** — `pm2 start`, then `pm2 startup` + `pm2 save`. Easiest for the Node
  processes (`next start`, the trigger worker).
- **systemd** — one `Restart=always` unit per process, enabled on boot. Most robust.
- **tmux/screen** — quickest, but does not survive a reboot. Fine for trying it out.

There are two or three long-running processes: the Next.js app, the Convex dev
process (only if self-hosting Convex), and the Trigger.dev worker (only for Agent
mode). Production tip: `next build` chains a PostHog sourcemap upload — without
PostHog, run `pnpm exec next build` and `pnpm exec next start` directly, or just
use `pnpm run dev`.

## The #1 silent-failure gotcha

Several env vars must be set in **three** places, not just `.env.local`: the app's
`.env.local`, the **Convex** dashboard/local backend, and the **Trigger.dev**
dashboard (the worker reads its env there, not from `.env.local`).
[`ENV_CHECKLIST.md`](./ENV_CHECKLIST.md) has the exact "goes where" table.
