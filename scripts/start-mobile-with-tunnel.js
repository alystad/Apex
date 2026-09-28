#!/usr/bin/env node
/* eslint-disable no-console */
const { spawn } = require("child_process");

console.log("[mobile] starting Expo with tunnel");

const expo = spawn("npx", ["expo", "start", "-c", "--tunnel"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

expo.on("exit", (code) => {
  process.exit(code ?? 0);
});



