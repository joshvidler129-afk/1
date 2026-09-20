#!/usr/bin/env node
// Launch the globally installed `hackerai` TUI against a custom
// OpenAI-compatible endpoint (e.g. api.hackwithclaude.com).
//
// Env:
//   ANTHROPIC_BASE_URL   endpoint root, with or without /v1
//   ANTHROPIC_API_KEY    or ANTHROPIC_AUTH_TOKEN
//   HACKERAI_MODELS      optional comma-separated model ids (skips /models fetch)
//   HACKERAI_PATH        optional path to the hackerai package dir
//
// Usage:  source .env && node hackerai-proxy.js

"use strict";

const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const rawBase = (
  process.env.HACKERAI_BASE_URL ||
  process.env.ANTHROPIC_BASE_URL ||
  ""
).replace(/\/+$/, "");
const API_KEY =
  process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";

if (!rawBase || !API_KEY) {
  console.error(
    "Error: set ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN)."
  );
  process.exit(1);
}

const BASE_URL = rawBase.endsWith("/v1") ? rawBase : rawBase + "/v1";
const HOST = new URL(BASE_URL).hostname;

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

function fetchModels() {
  return new Promise((resolve) => {
    const req = https.get(
      `${BASE_URL}/models`,
      { headers: { Authorization: `Bearer ${API_KEY}` }, timeout: 15000 },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).data || []);
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

function toModel(m) {
  const id = typeof m === "string" ? m : m.id;
  return {
    id,
    name: id.includes("/") ? id.split("/").slice(1).join("/") : id,
    contextWindow: (m && m.context_length) || 128000,
    maxTokens: 8192,
    provider: HOST,
    free: false,
  };
}

async function main() {
  let models = [];
  if (process.env.HACKERAI_MODELS) {
    models = process.env.HACKERAI_MODELS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(toModel);
  } else {
    models = (await fetchModels()).map(toModel);
  }
  if (models.length === 0) {
    console.error(
      `Error: no models available from ${BASE_URL}/models. Set HACKERAI_MODELS=id1,id2 to specify them.`
    );
    process.exit(1);
  }

  const pkgDir = resolveHackerai();
  const { PROVIDERS, ProviderManager } = require(
    path.join(pkgDir, "src/providers.js")
  );

  PROVIDERS.custom = {
    type: "custom",
    name: HOST,
    shortName: HOST,
    baseURL: BASE_URL,
    freeNote: "custom endpoint",
    tier: "paid",
    detectKey: () => false,
    getKey: () => BASE_URL,
    models,
  };

  const origLoad = ProviderManager.prototype._load;
  ProviderManager.prototype._load = function () {
    origLoad.call(this);
    const secondary = this._list.filter(
      (p) =>
        p.apiKey &&
        p.type !== "custom" &&
        p.type !== "openrouter" &&
        p.type !== "hackerai"
    );
    this._list = [{ type: "custom", apiKey: API_KEY }, ...secondary];
    this._idx = 0;
    this._applyCurrent();
  };

  // Keep the custom key out of ~/.hackerai/config.json.
  const origSave = ProviderManager.prototype._save;
  ProviderManager.prototype._save = function () {
    const keep = this._list;
    this._list = keep.filter((p) => p.type !== "custom");
    try {
      origSave.call(this);
    } finally {
      this._list = keep;
    }
  };

  const config = require(path.join(pkgDir, "src/config.js"));
  const origSetApiKey = config.setApiKey;
  config.setApiKey = function (key) {
    if (key === API_KEY) {
      this.apiKey = key;
      return;
    }
    origSetApiKey.call(this, key);
  };

  // These would send the key to hackerai's own backend for tier/usage tracking.
  const { HackerCLIApp } = require(path.join(pkgDir, "src/app.js"));
  HackerCLIApp.prototype._checkTier = async function () {};
  HackerCLIApp.prototype._useRequest = async function () {
    return true;
  };

  // The built-in picker iterates a hardcoded provider list that can't include ours.
  const fmtCtx = (n) =>
    n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.round(n / 1000) + "k";
  const clean = (s) => String(s).replace(/[{}]/g, "");
  HackerCLIApp.prototype._showModelPicker = async function () {
    const curId = (this.providers.currentModel() || {}).id;
    const items = models.map((m) => {
      const active = m.id === curId ? "{#00ff88-fg}▸{/#00ff88-fg}" : " ";
      return ` ${active} {#88ff88-fg}${clean(m.name).padEnd(30)}{/}  {#333333-fg}${fmtCtx(m.contextWindow)} ctx{/}`;
    });
    const idx = await this._openList({
      label: `{bold}⟐ Models — ${clean(HOST)}{/bold}`,
      items,
      selectedIndex: Math.max(0, models.findIndex((m) => m.id === curId)),
      width: Math.min(78, (this.screen.width || 80) - 4),
    });
    if (idx < 0) return;
    const m = models[idx];
    this.providers.selectByType("custom");
    this.providers.selectModelById(m.id);
    this._pinnedModel = true;
    this._updateModeBar();
    this._log(
      `{#444444-fg}  model → {#88ff88-fg}${clean(m.name)}{/#88ff88-fg} · ${clean(HOST)} · ${fmtCtx(m.contextWindow)} ctx · {#006600-fg}pinned{/#006600-fg}{/#444444-fg}`
    );
    this.screen.render();
  };

  require(path.join(pkgDir, "index.js"));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
