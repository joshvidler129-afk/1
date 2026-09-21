#!/usr/bin/env node
// Chat with your hackerai.co account from the terminal.
//
// hackerai.co has no public API; this drives the same /api/chat endpoint its
// web app uses, authenticated with your browser session cookie.
//
// Setup (once): log in at https://hackerai.co in a browser, open DevTools ->
// Application/Storage -> Cookies -> https://hackerai.co, copy the value of
// "wos-session", and run this script; it asks for it and saves it to .env
// (ignored by git). Sessions expire; re-copy the cookie when you get 401.
//
// Usage:
//   node hackerai-co-chat.js                 interactive
//   node hackerai-co-chat.js "your question" one-shot
// Commands in interactive mode: /new (fresh chat), /model <auto|hackerai-standard|hackerai-pro|hackerai-max>, /exit

"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { randomUUID } = require("crypto");

const ORIGIN = process.env.HACKERAI_CO_ORIGIN || "https://hackerai.co";
const ENV_FILE = path.join(__dirname, ".env");
const MODELS = ["auto", "hackerai-standard", "hackerai-pro", "hackerai-max"];

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

function saveSession(value) {
  let text = "";
  try {
    text = fs.readFileSync(ENV_FILE, "utf8");
  } catch (_) {}
  const line = `HACKERAI_CO_SESSION=${value}`;
  if (/^HACKERAI_CO_SESSION=.*$/m.test(text)) {
    text = text.replace(/^HACKERAI_CO_SESSION=.*$/m, line);
  } else {
    text = text.replace(/\s*$/, "") + (text ? "\n" : "") + line + "\n";
  }
  fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
}

async function promptSession() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return "";
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
  console.log("Log in at " + ORIGIN + " in a browser, then copy the 'wos-session' cookie value");
  console.log("(DevTools -> Application -> Cookies -> " + ORIGIN + ").");
  const value = await ask("wos-session: ");
  rl.close();
  if (value) {
    saveSession(value);
    console.log(`Saved to ${ENV_FILE} (ignored by git).`);
  }
  return value;
}

function parseSetCookie(res) {
  const list = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  for (const c of list) {
    const m = /^wos-session=([^;]*)/.exec(c);
    if (m && m[1]) return m[1];
  }
  return null;
}

function userMessage(text) {
  return {
    id: randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
    metadata: { createdAt: Date.now() },
  };
}

async function send(state, text, onDelta) {
  const res = await fetch(`${ORIGIN}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Cookie: `wos-session=${state.session}`,
      Origin: ORIGIN,
      Referer: `${ORIGIN}/c/${state.chatId}`,
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    },
    body: JSON.stringify({
      chatId: state.chatId,
      messages: [userMessage(text)],
      mode: "ask",
      todos: [],
      sandboxPreference: "e2b",
      selectedModel: state.model,
    }),
  });

  const refreshed = parseSetCookie(res);
  if (refreshed && refreshed !== state.session) {
    state.session = refreshed;
    saveSession(refreshed);
  }

  if (!res.ok) {
    const body = await res.text();
    let msg = body;
    try {
      const j = JSON.parse(body);
      msg = j.message || j.error || j.cause || body;
    } catch (_) {}
    const hint = res.status === 401 || res.status === 403
      ? " (session expired? delete HACKERAI_CO_SESSION from .env and run again)"
      : "";
    throw new Error(`HTTP ${res.status}: ${String(msg).slice(0, 300)}${hint}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let ev;
      try {
        ev = JSON.parse(payload);
      } catch (_) {
        continue;
      }
      if (ev.type === "text-delta" && typeof ev.delta === "string") {
        full += ev.delta;
        onDelta(ev.delta);
      } else if (ev.type === "error") {
        throw new Error(ev.errorText || "stream error");
      }
    }
  }
  return full;
}

async function main() {
  loadDotEnv(ENV_FILE);
  let session = process.env.HACKERAI_CO_SESSION || "";
  if (!session) session = await promptSession();
  if (!session) {
    console.error(`Error: set HACKERAI_CO_SESSION (the wos-session cookie) in ${ENV_FILE}.`);
    process.exit(1);
  }

  const state = { session, chatId: randomUUID(), model: process.env.HACKERAI_CO_MODEL || "auto" };
  if (!MODELS.includes(state.model)) state.model = "auto";

  if (process.argv[2]) {
    await send(state, process.argv.slice(2).join(" "), (d) => process.stdout.write(d));
    process.stdout.write("\n");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "You: " });
  console.log(`hackerai.co · model ${state.model} · chat ${state.chatId}`);
  console.log("Commands: /new  /model <name>  /exit\n");
  rl.prompt();

  let busy = false;
  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input || busy) return rl.prompt();
    if (input === "/exit" || input === "/quit") return rl.close();
    if (input === "/new") {
      state.chatId = randomUUID();
      console.log(`new chat ${state.chatId}\n`);
      return rl.prompt();
    }
    if (input.startsWith("/model")) {
      const m = input.split(/\s+/)[1];
      if (MODELS.includes(m)) {
        state.model = m;
        console.log(`model -> ${m}\n`);
      } else {
        console.log(`models: ${MODELS.join(", ")}\n`);
      }
      return rl.prompt();
    }

    busy = true;
    process.stdout.write("\nHackerAI: ");
    try {
      await send(state, input, (d) => process.stdout.write(d));
      process.stdout.write("\n\n");
    } catch (e) {
      console.error("\nError: " + e.message + "\n");
    }
    busy = false;
    rl.prompt();
  });
  rl.on("close", () => process.exit(0));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
