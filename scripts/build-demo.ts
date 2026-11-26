// Builds the static browser demo into demo/out. Run with `npm run build:demo`.
// Copies the prebuilt index next to the pages so the site needs no server, then runs a static Next.js export.
import { spawnSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function main() {
  const publicData = path.join(root, "demo", "public", "data");
  await rm(publicData, { recursive: true, force: true });
  await mkdir(publicData, { recursive: true });
  await cp(path.join(root, "data", "index.json"), path.join(publicData, "index.json"));
  await rm(path.join(root, "demo", "out"), { recursive: true, force: true });

  const build = spawnSync("npx", ["next", "build", "demo"], { stdio: "inherit", cwd: root, env: process.env });
  if (build.status !== 0) process.exit(build.status ?? 1);
  console.log("demo built in demo/out");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
