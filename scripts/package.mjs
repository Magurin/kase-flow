import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const files = [
  ".gitignore",
  "README.md",
  "docs",
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "src",
  "server",
  "scripts",
  "tests",
  "vendor",
  "program/Cargo.toml",
  "program/Cargo.lock",
  "program/src",
];
const stage = path.resolve(".local/source-package-devnet");
fs.mkdirSync(stage, { recursive: true });
for (const file of files) {
  const dest = path.join(stage, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(file, dest, { recursive: true });
}
const result = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    "Compress-Archive -Path '.local/source-package-devnet/*' -DestinationPath 'artifacts/kase-flow-source.zip' -Force",
  ],
  { stdio: "inherit", windowsHide: true },
);
if (result.status !== 0) process.exit(1);
console.log(
  "Source archive: artifacts/kase-flow-source.zip (no wallets, dependencies or build output)",
);
