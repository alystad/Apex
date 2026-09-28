#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Starts a Cloudflare quick tunnel pointed at the local API server, captures
 * the generated *.trycloudflare.com URL from cloudflared's output, and writes
 * it into .env as EXPO_PUBLIC_API_URL so the mobile app always has the
 * current tunnel address without manual copy/paste.
 *
 * Usage: node scripts/tunnel-and-update-env.js [localPort]
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = process.argv[2] || "4000";
const LOCAL_URL = `http://localhost:${PORT}`;
const ENV_PATH = path.join(__dirname, "..", ".env");
const ENV_KEY = "EXPO_PUBLIC_API_URL";
const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function updateEnvFile(newUrl) {
  let contents = "";
  try {
    contents = fs.readFileSync(ENV_PATH, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const line = `${ENV_KEY}=${newUrl}`;
  const keyRe = new RegExp(`^${ENV_KEY}=.*$`, "m");

  if (keyRe.test(contents)) {
    contents = contents.replace(keyRe, line);
  } else {
    contents = contents.length > 0 && !contents.endsWith("\n") ? `${contents}\n${line}\n` : `${contents}${line}\n`;
  }

  fs.writeFileSync(ENV_PATH, contents, "utf8");
}

console.log(`[tunnel] starting cloudflared quick tunnel -> ${LOCAL_URL}`);

const cloudflared = spawn("cloudflared", ["tunnel", "--url", LOCAL_URL]);

let captured = false;

function handleOutput(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);

  if (captured) return;
  const match = text.match(TUNNEL_URL_RE);
  if (match) {
    captured = true;
    const url = match[0];
    updateEnvFile(url);
    console.log(`\n[tunnel] captured URL: ${url}`);
    console.log(`[tunnel] wrote ${ENV_KEY}=${url} to .env`);
    console.log("[tunnel] restart Expo (or reload the app) to pick up the new URL.\n");
  }
}

cloudflared.stdout.on("data", handleOutput);
cloudflared.stderr.on("data", handleOutput);

cloudflared.on("error", (err) => {
  console.error("[tunnel] failed to start cloudflared:", err.message);
  console.error("[tunnel] make sure cloudflared is installed and on your PATH.");
  process.exit(1);
});

cloudflared.on("exit", (code) => {
  console.log(`[tunnel] cloudflared exited with code ${code}`);
  process.exit(code ?? 0);
});

function shutdown() {
  cloudflared.kill();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
