#!/usr/bin/env node
// Launch the globally installed `hackerai` TUI with a custom OpenAI-compatible
// endpoint as the default provider, keeping everything else hackerai offers
// (HackerAI login, other providers, tools, modes) working alongside it.
//
// Env:
//   ANTHROPIC_BASE_URL   endpoint root, with or without /v1
//   ANTHROPIC_API_KEY    or ANTHROPIC_AUTH_TOKEN
//   HACKERAI_MODELS      optional comma-separated model ids (skips /models fetch)
//   HACKERAI_PATH        optional path to the hackerai package dir
//
// Usage:  source .env && node hackerai-proxy.js
//
// The custom key lives only in memory: it is never written to
// ~/.hackerai/config.json and never sent to hackerai's backend. HackerAI's
// own tier/usage tracking runs only while a HackerAI login is the active
// provider.

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const readline = require("readline");
const { execSync } = require("child_process");

const CUSTOM = "custom";
const DEFAULT_ENDPOINT = "https://api.hackwithclaude.com";

function loadDotEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (_) {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

async function promptSetup(file) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
  console.log("First run: where should HackerAI send requests?");
  const base = (await ask(`Endpoint [${DEFAULT_ENDPOINT}]: `)) || DEFAULT_ENDPOINT;
  const key = await ask("API key: ");
  rl.close();
  if (!key) return false;
  fs.writeFileSync(file, `ANTHROPIC_BASE_URL=${base}\nANTHROPIC_API_KEY=${key}\n`, { mode: 0o600 });
  console.log(`Saved to ${file} (ignored by git).`);
  process.env.ANTHROPIC_BASE_URL = base;
  process.env.ANTHROPIC_API_KEY = key;
  return true;
}

function esc(s) {
  return String(s).replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

function fmtCtx(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1000) return Math.floor(n / 1000) + "k";
  return String(n);
}

function resolveHackerai() {
  if (process.env.HACKERAI_PATH) return process.env.HACKERAI_PATH;
  try {
    return path.dirname(require.resolve("hackerai/package.json"));
  } catch (_) {}
  const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
  const dir = path.join(globalRoot, "hackerai");
  try {
    require.resolve(path.join(dir, "package.json"));
    return dir;
  } catch (_) {
    console.error(
      "Error: hackerai not found. Install it with: npm install -g hackerai"
    );
    process.exit(1);
  }
}

function fetchModels(baseURL, apiKey) {
  return new Promise((resolve) => {
    const url = new URL(baseURL + "/models");
    const client = url.protocol === "http:" ? http : https;
    const req = client.get(
      url,
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            resolve(Array.isArray(parsed.data) ? parsed.data : []);
          } catch (_) {
            resolve([]);
          }
        });
      }
    );
    req.on("error", () => resolve([]));
    req.on("timeout", () => req.destroy());
  });
}

function toModel(m, host) {
  const id = typeof m === "string" ? m : m.id;
  const ctx = m && Number(m.context_length);
  return {
    id,
    name: id.includes("/") ? id.split("/").slice(1).join("/") : id,
    contextWindow: ctx > 0 ? ctx : 128000,
    maxTokens: 8192,
    provider: host,
    free: false,
  };
}

function applyPatches(pkgDir, { baseURL, apiKey, host, models }) {
  const { PROVIDERS, ProviderManager } = require(
    path.join(pkgDir, "src/providers.js")
  );
  const config = require(path.join(pkgDir, "src/config.js"));
  const { HackerCLIApp } = require(path.join(pkgDir, "src/app.js"));
  const PM = ProviderManager.prototype;
  const APP = HackerCLIApp.prototype;

  const isCustomKey = (k) =>
    String(k || "").trim().replace(/^custom:/i, "") === apiKey;
  const isCustomActive = (app) =>
    !!app.providers && app.providers.current().type === CUSTOM;
  const resetTier = (app) => {
    app._tier = null;
    app._remaining = null;
    app._dailyLimit = null;
  };

  PROVIDERS[CUSTOM] = {
    type: CUSTOM,
    name: host,
    shortName: host,
    baseURL,
    freeNote: "your own key · no HackerAI limits",
    tier: "paid",
    detectKey: isCustomKey,
    getKey: () => baseURL,
    models,
  };

  // Custom is always present and is the default; whatever hackerai loaded
  // from config.json (a HackerAI login, Groq, ...) stays available after it.
  const origLoad = PM._load;
  PM._load = function () {
    origLoad.call(this);
    const others = this._list.filter(
      (p) => p.type !== CUSTOM && p.apiKey && !isCustomKey(p.apiKey)
    );
    this._list = [{ type: CUSTOM, apiKey }, ...others];
    this._idx = 0;
    this._applyCurrent();
  };

  // The custom key must never reach ~/.hackerai/config.json.
  const origSave = PM._save;
  PM._save = function () {
    const keep = this._list;
    this._list = keep.filter((p) => p.type !== CUSTOM);
    try {
      origSave.call(this);
    } finally {
      this._list = keep;
    }
  };
  const origSetApiKey = config.setApiKey;
  config.setApiKey = function (key) {
    if (isCustomKey(key)) {
      this.apiKey = apiKey;
      return;
    }
    origSetApiKey.call(this, key);
  };

  // Typing the custom key into /key or /addkey selects the custom provider
  // instead of being classified as an OpenRouter/OpenAI key and persisted.
  const origAdd = PM.add;
  PM.add = function (key) {
    if (isCustomKey(key)) {
      this.selectByType(CUSTOM);
      this._limited.delete(CUSTOM);
      return CUSTOM;
    }
    return origAdd.call(this, key);
  };

  // hackerai's OpenAI rule matches any "sk-" key, so it would claim ours.
  const origDetect = PM._detectType;
  PM._detectType = function (key) {
    return isCustomKey(key) ? CUSTOM : origDetect.call(this, key);
  };
  const origStaticDetect = ProviderManager.detectType;
  ProviderManager.detectType = function (key) {
    return isCustomKey(key) ? CUSTOM : origStaticDetect.call(ProviderManager, key);
  };

  const origRemove = PM.remove;
  PM.remove = function (type) {
    if (type === CUSTOM) return;
    origRemove.call(this, type);
  };

  // Never fall back from the custom endpoint to another provider on its own;
  // the user switches explicitly with /model.
  const origMarkRateLimited = PM.markRateLimited;
  PM.markRateLimited = function () {
    if (this.current().type === CUSTOM) return false;
    return origMarkRateLimited.call(this);
  };

  // Tier/usage tracking posts the active key to hackerai's backend; run it
  // only for a HackerAI login, never for the custom key.
  const origCheckTier = APP._checkTier;
  APP._checkTier = function () {
    if (isCustomActive(this)) {
      resetTier(this);
      this._refreshHeader();
      return Promise.resolve();
    }
    return origCheckTier.call(this);
  };
  const origUseRequest = APP._useRequest;
  APP._useRequest = function () {
    if (isCustomActive(this)) return Promise.resolve(true);
    return origUseRequest.call(this);
  };

  // Pinned from the start: a rate limit surfaces an error instead of silently
  // swapping the model.
  const origStart = APP.start;
  APP.start = function () {
    if (isCustomActive(this)) this._pinnedModel = true;
    return origStart.call(this);
  };

  const origSlash = APP._runSlashCommand;
  APP._runSlashCommand = function (text) {
    const parts = String(text).slice(1).trim().split(/\s+/);
    const cmd = (parts[0] || "").toLowerCase();

    if (cmd === "rmprovider" || cmd === "removeprovider") {
      const typeName = (parts[1] || "").toLowerCase();
      const match = Object.keys(PROVIDERS).find((t) => t.startsWith(typeName));
      if (typeName && match === CUSTOM) {
        this._log(`{yellow-fg}  ${esc(host)} is your default provider and can't be removed.{/yellow-fg}`);
        this.screen.render();
        return;
      }
    }

    if ((cmd === "account" || cmd === "acct" || cmd === "profile") && isCustomActive(this)) {
      const provs = this.providers.list();
      this._log("");
      this._log("{#003300-fg}  ══════════════════════════════════════════════{/#003300-fg}");
      this._log("{green-fg}{bold}  ⟐ Account{/bold}{/green-fg}");
      this._log("{#003300-fg}  ══════════════════════════════════════════════{/#003300-fg}");
      this._log("");
      this._log(`  {#00ff88-fg}Provider:{/#00ff88-fg}   {#88ff88-fg}${esc(host)}{/#88ff88-fg}  {#444444-fg}(your own key){/#444444-fg}`);
      this._log("  {#00ff88-fg}Limits:{/#00ff88-fg}     {#888888-fg}none from HackerAI — set by your endpoint{/#888888-fg}");
      this._log(`  {#00ff88-fg}Providers:{/#00ff88-fg}  ${provs.map((p) => `{#44ff88-fg}${esc(p.name)}{/#44ff88-fg}`).join(", ")}`);
      this._log("");
      this._log("{#003300-fg}  ══════════════════════════════════════════════{/#003300-fg}");
      this._log("");
      this.screen.render();
      return;
    }

    const result = origSlash.call(this, text);

    if (cmd === "logout" || cmd === "signout") {
      // hackerai blanked config.apiKey; drop the HackerAI login from the
      // rotation and put the custom key back.
      const pm = this.providers;
      pm._list = pm._list.filter((p) => p.type !== "hackerai" && p.type !== "openrouter");
      pm._idx = 0;
      pm._applyCurrent();
      resetTier(this);
      this._updateModeBar();
      this._refreshHeader();
      this._log(`{#444444-fg}  Still connected to ${esc(host)} with your own key.{/#444444-fg}`);
      this.screen.render();
    }
    return result;
  };

  // Same picker as hackerai's, with the custom provider listed first (the
  // built-in one iterates a fixed provider list that can't include it).
  APP._showModelPicker = async function () {
    const curId = (this.providers.currentModel() || {}).id;
    const curType = this.providers.current().type;
    const configured = new Set(this.providers.list().map((p) => p.type));
    const order = [CUSTOM, "hackerai", "openrouter", "groq", "cerebras", "gemini", "mistral", "anthropic", "openai", "deepseek", "xai", "together"];

    const entries = [];
    for (const type of order) {
      const def = PROVIDERS[type];
      if (!def) continue;
      let list = def.models || [];
      if ((type === "openrouter" || type === "hackerai") && configured.has(type)) {
        const live = this.models.list();
        if (live && live.length) list = live;
      }
      if (!list.length) continue;
      const hasKey = configured.has(type);
      entries.push({ kind: "header", providerType: type, providerName: def.name, hasKey });
      for (const m of list) {
        entries.push({ kind: "model", providerType: type, providerName: def.name, model: m, hasKey });
      }
    }

    let curIdx = 0;
    const items = entries.map((e, i) => {
      if (e.kind === "header") {
        const status = e.hasKey
          ? "{#00aa44-fg}● configured{/#00aa44-fg}"
          : "{#664400-fg}○ add key{/#664400-fg}";
        return `{#003300-fg}── {/#003300-fg}{bold}{#44ffaa-fg}${esc(e.providerName)}{/#44ffaa-fg}{/bold} {#003300-fg}──{/#003300-fg}  ${status}`;
      }
      const m = e.model;
      const isCur = e.hasKey && e.providerType === curType && m.id === curId;
      if (isCur) curIdx = i;
      const badge = m.free === true
        ? "{#00cc44-fg}FREE{/#00cc44-fg}"
        : m.free === false
          ? "{yellow-fg}PAID{/yellow-fg}"
          : "{#444444-fg} ?  {/}";
      const lock = e.hasKey ? "" : " {#664400-fg}🔒{/#664400-fg}";
      const color = e.hasKey ? "{#88ff88-fg}" : "{#555555-fg}";
      const active = isCur ? "{#00ff88-fg}▸{/#00ff88-fg}" : " ";
      return ` ${active} ${color}${esc(m.name).padEnd(26)}{/}  ${badge}  {#333333-fg}${fmtCtx(m.contextWindow)} ctx{/}${lock}`;
    });

    const idx = await this._openList({
      label: `{bold}⟐ All Models — ${esc(host)} · HackerAI · Groq · Gemini · More{/bold}`,
      items,
      selectedIndex: curIdx,
      width: Math.min(78, (this.screen.width || 80) - 4),
      skipFn: (i) => entries[i] && entries[i].kind === "header",
    });
    if (idx < 0) return;
    const chosen = entries[idx];
    if (!chosen || chosen.kind !== "model") return;

    const pick = () => {
      this.providers.selectByType(chosen.providerType);
      this.providers.selectModelById(chosen.model.id);
      this._pinnedModel = true;
      if (chosen.providerType === CUSTOM) {
        resetTier(this);
        this._refreshHeader();
      } else {
        this._checkTier();
      }
      this._updateModeBar();
    };

    if (!chosen.hasKey) {
      const def = PROVIDERS[chosen.providerType] || {};
      this._log("");
      this._log(`{#ffaa00-fg}  ${esc(chosen.providerName)} requires an API key{/#ffaa00-fg}`);
      this._log(`{#444444-fg}  Get one at: ${esc(def.getKey ? def.getKey() : "provider website")}{/#444444-fg}`);
      this._log("");
      this.screen.render();
      this._promptInput(`Paste your ${chosen.providerName} API key:`, (k) => {
        k = (k || "").trim();
        if (!k) return;
        try {
          this.providers.add(k);
          pick();
          this._log(`{green-fg}  ✓ ${esc(chosen.providerName)} added — using ${esc(chosen.model.name)}{/green-fg}`);
        } catch (err) {
          this._log(`{red-fg}  ✗ ${esc(err.message || "invalid key")}{/red-fg}`);
        }
        this.screen.render();
      });
      return;
    }

    pick();
    this._log(`{#444444-fg}  model → {#88ff88-fg}${esc(chosen.model.name)}{/#88ff88-fg} · ${esc(chosen.providerName)} · ${fmtCtx(chosen.model.contextWindow)} ctx · {#006600-fg}pinned{/#006600-fg}{/#444444-fg}`);
    this.screen.render();
  };
}

function readEnv() {
  return {
    rawBase: (process.env.HACKERAI_BASE_URL || process.env.ANTHROPIC_BASE_URL || "").replace(/\/+$/, ""),
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "",
  };
}

async function main() {
  const envFile = path.join(__dirname, ".env");
  loadDotEnv(envFile);
  let { rawBase, apiKey } = readEnv();
  if (!rawBase || !apiKey) {
    if (await promptSetup(envFile)) ({ rawBase, apiKey } = readEnv());
  }
  if (!rawBase || !apiKey) {
    console.error(
      `Error: set ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN), or put them in ${envFile}.`
    );
    process.exit(1);
  }
  const baseURL = rawBase.endsWith("/v1") ? rawBase : rawBase + "/v1";
  const host = new URL(baseURL).hostname;

  let models;
  if (process.env.HACKERAI_MODELS) {
    models = process.env.HACKERAI_MODELS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => toModel(id, host));
  } else {
    models = (await fetchModels(baseURL, apiKey)).map((m) => toModel(m, host));
  }
  if (models.length === 0) {
    console.error(
      `Error: no models available from ${baseURL}/models. Set HACKERAI_MODELS=id1,id2 to specify them.`
    );
    process.exit(1);
  }

  const pkgDir = resolveHackerai();
  applyPatches(pkgDir, { baseURL, apiKey, host, models });
  require(path.join(pkgDir, "index.js"));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { applyPatches, fetchModels, resolveHackerai, toModel };
