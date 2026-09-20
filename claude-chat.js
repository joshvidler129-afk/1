#!/usr/bin/env node
// Interactive Claude chat using the Anthropic messages API.
// Usage:
//   ./claude-chat.js                  (interactive REPL)
//   ./claude-chat.js "your prompt"    (one-shot)

const https = require("https");
const readline = require("readline");

const BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
const API_KEY =
  process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_AUTH_TOKEN ||
  process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

if (!API_KEY) {
  console.error(
    "Error: set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN before running."
  );
  process.exit(1);
}

function ask(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: MODEL, max_tokens: 8096, messages });
    const url = new URL("/v1/messages", BASE_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.content[0].text);
        } catch (e) {
          reject(new Error("Bad response: " + data));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const history = [];

  // One-shot mode
  if (process.argv[2]) {
    const prompt = process.argv.slice(2).join(" ");
    history.push({ role: "user", content: prompt });
    const reply = await ask(history);
    console.log(reply);
    return;
  }

  // Interactive REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "You: ",
  });

  console.log(`Claude (${MODEL}) via ${BASE_URL}`);
  console.log('Type your message. Ctrl+C or "exit" to quit.\n');
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) return rl.prompt();
    if (input.toLowerCase() === "exit") return rl.close();

    history.push({ role: "user", content: input });
    try {
      const reply = await ask(history);
      history.push({ role: "assistant", content: reply });
      console.log("\nClaude: " + reply + "\n");
    } catch (e) {
      console.error("Error: " + e.message);
    }
    rl.prompt();
  });

  rl.on("close", () => process.exit(0));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
