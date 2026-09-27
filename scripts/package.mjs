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
  "vercel.json",
  ".vercelignore",
  "api",
  "src",
  "server",
  "scripts",
  "tests",
  "vendor",
  "program/Cargo.toml",
  "program/Cargo.lock",
  "program/src",
  "program/tests",
];
// A fresh stage keeps files deleted from the project out of the archive.
const stage = path.resolve(".local/source-package-devnet");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const file of files) {
  const dest = path.join(stage, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(file, dest, { recursive: true });
}
// Windows PowerShell 5.1 Compress-Archive stores "a\b" entry names, which
// unpack as literal backslashes elsewhere; bsdtar and zip write "a/b".
const archive = path.resolve("artifacts/kase-flow-source.zip");
fs.rmSync(archive, { force: true });
const entries = fs.readdirSync(stage);
const result =
  process.platform === "win32"
    ? spawnSync(
        path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
          "tar.exe",
        ),
        ["-a", "-cf", archive, "-C", stage, ...entries],
        { stdio: "inherit", windowsHide: true },
      )
    : spawnSync("zip", ["-qr", archive, ...entries], {
        cwd: stage,
        stdio: "inherit",
      });
if (result.status !== 0) process.exit(1);
console.log(
  "Source archive: artifacts/kase-flow-source.zip (no wallets, dependencies or build output)",
);
