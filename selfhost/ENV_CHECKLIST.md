# Environment checklist

Every value the self-hosted app needs, what it's for, and **where it must be set**.
Facts here were extracted from the upstream `.env.local.example`, `README.md`, and
`scripts/setup.ts`. The wizard (`pnpm run setup`) fills in most of the required
`.env.local` values for you; this table is the map for the rest and for the two
places the wizard does **not** touch (Convex dashboard, Trigger.dev dashboard).

Legend for "Where": **L** = app `.env.local` · **C** = Convex (dashboard, or the
local backend the wizard configures) · **T** = Trigger.dev dashboard (worker env).

## Required — core accounts

| Variable | Service | Where | Notes |
|---|---|---|---|
| `OPENROUTER_API_KEY` | [OpenRouter](https://openrouter.ai/keys) | L, T | Primary model provider. Must start `sk-`. Free-tier models exist. |
| `OPENAI_API_KEY` | [OpenAI](https://platform.openai.com/api-keys) | L, T | Moderation that decides security-request routing. Must start `sk-`. |
| `E2B_API_KEY` | [E2B](https://e2b.dev/dashboard) | L, T | Cloud sandbox for Agent mode. Must start `e2b_`. |
| `E2B_TEMPLATE` | E2B | L | Default `terminal-agent-sandbox`. |
| `AWS_S3_ACCESS_KEY_ID` | [AWS S3](https://aws.amazon.com/s3/) | L, C, T | File storage. |
| `AWS_S3_SECRET_ACCESS_KEY` | AWS S3 | L, C, T | |
| `AWS_S3_REGION` | AWS S3 | L, C, T | Default `us-east-1`. |
| `AWS_S3_BUCKET_NAME` | AWS S3 | L, C, T | Your bucket. |
| `WORKOS_API_KEY` | [WorkOS](https://dashboard.workos.com/get-started) | L | Auth. Must start `sk_`. There is no built-in local login — WorkOS is required. |
| `WORKOS_CLIENT_ID` | WorkOS | L, C | Starts `client_`. |
| `WORKOS_AUTH_DOMAIN` | WorkOS | L, C | Usually `api.workos.com`. |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | WorkOS | L | `https://<host>/callback`; set the same URL in the WorkOS dashboard. |
| `NEXT_PUBLIC_BASE_URL` | app | L | `https://<host>` (wizard writes localhost — change it). |

## Required — generated for you (no signup)

The wizard auto-generates these with `crypto.randomBytes(32)`. If you ever set one
by hand: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

| Variable | Where | Notes |
|---|---|---|
| `WORKOS_COOKIE_PASSWORD` | L | Encrypts auth cookies. Auto-generated. |
| `CONVEX_SERVICE_ROLE_KEY` | L, C, T | Privileged server→Convex calls. Auto-generated; mirror the same value into Convex and Trigger.dev. |
| `ACCOUNT_IDENTITY_HMAC_SECRET` | L | Free-quota identity hashing. Auto-generated. |

## Required — Convex (database)

| Variable | Where | Notes |
|---|---|---|
| `CONVEX_DEPLOYMENT` | L | Auto-written by `npx convex dev`. |
| `NEXT_PUBLIC_CONVEX_URL` | L, T | Auto-written by `npx convex dev`; the Trigger worker also needs it. |

Choosing **local Convex** in the wizard means no Convex account and Convex runs on
your box (`pnpm run dev:local`); to stop it later: `npx convex disable-local-deployments`.

## Agent mode (Trigger.dev)

Optional — needed only for the terminal/browser agent. The **worker reads its env
from the Trigger.dev dashboard, not `.env.local`.** The wizard does not configure
Trigger.dev; do it by hand.

1. Create a project at [cloud.trigger.dev](https://cloud.trigger.dev).
2. In `.env.local`: `TRIGGER_PROJECT_ID` (`proj_…`) and `TRIGGER_SECRET_KEY` (`tr_dev_…`).
3. In the Trigger.dev dashboard → Environment Variables, add: `NEXT_PUBLIC_CONVEX_URL`,
   `CONVEX_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`,
   `AWS_S3_ACCESS_KEY_ID`, `AWS_S3_SECRET_ACCESS_KEY`, `AWS_S3_REGION`,
   `AWS_S3_BUCKET_NAME`, `E2B_API_KEY`.
4. Run the worker: `pnpm dev:trigger` (a third process, alongside the app).

## Leave these OFF (safe defaults)

All optional. A minimal personal instance skips every one of them.

| Variable(s) | What it would add | Keep it off by |
|---|---|---|
| `ABLITERATION_API_KEY` | Uncensored model fallback for refused requests | Leaving blank (wizard does). Also needs a PostHog `test` flag, so with no PostHog it can never activate — normal model behavior. |
| `MIOSA_*`, `CLOUD_SANDBOX_PROVIDER` | Alternative cloud sandbox | Leaving blank → E2B-only. |
| `E2B_EU_*` | EU execution cluster | Leaving unset → single region. |
| `S3_REGIONAL_STORAGE_ENABLED` + regional buckets | Multi-region storage | `false` + set only `AWS_S3_REGION`/`AWS_S3_BUCKET_NAME`. |
| `PERPLEXITY_API_KEY`, `JINA_API_KEY` | Web search / URL reader | Unset. |
| `REDIS_URL`, `UPSTASH_REDIS_REST_*` | Stream resume / rate limiting | Unset. |
| `NEXT_PUBLIC_POSTHOG_*`, `POSTHOG_CLI_*` | Analytics + build sourcemap upload | Unset. Without it, run `pnpm exec next build` directly (the default `build` script tries to upload sourcemaps). |
| `STRIPE_*`, `REFERRAL_*`, `INTERCOM_MESSENGER_SECRET`, `WORKOS_WEBHOOK_SECRET`, `CRON_SECRET`, `VERCEL_BILLING_*`, `CENTRIFUGO_*` | Payments / referrals / support / webhooks / cost-sync / real-time relay | Unset for a basic single-user instance. |

## Where the money actually goes

No HackerAI subscription. You pay providers directly: OpenRouter (free-tier models
≈ $0; others pay-per-use), OpenAI (tiny, moderation only), E2B (free credits then
usage), AWS S3 (near-free at low volume), WorkOS (free up to a large user count),
Convex/Trigger.dev (free tiers). "Unlimited" = no HackerAI cap, bounded by these.
