import { cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const compiled = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
  cwd: root,
  stdio: "inherit",
});

if (compiled.status !== 0) {
  process.exit(compiled.status ?? 1);
}

await cp(path.join(root, "index.html"), path.join(dist, "index.html"));
await cp(path.join(root, "styles.css"), path.join(dist, "styles.css"));
console.log("Built dist/");
