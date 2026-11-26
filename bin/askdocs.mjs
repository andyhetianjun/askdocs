#!/usr/bin/env node
// Entry point for `npx github:andyhetianjun/askdocs ask "..."`. The code is TypeScript, so this runs it through tsx.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const result = spawnSync(process.execPath, [tsx, path.join(here, "..", "scripts", "cli.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
