// Dedicated Devnet profile. This script never targets Mainnet.
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { Connection, Keypair } from "@solana/web3.js";
process.env.SOLANA_CLUSTER = "devnet";
process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";

const dir = new URL("../.local/devnet/", import.meta.url);
fs.mkdirSync(dir, { recursive: true });
const c = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
if (
  (await c.getGenesisHash()) !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
)
  throw Error("Not Solana Devnet");
if (process.argv.includes("--serve")) {
  if (!fs.existsSync(new URL("config.json", dir)))
    throw Error("Deploy with npm run devnet:deploy first");
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "dev"],
    {
      stdio: "inherit",
      env: process.env,
      windowsHide: true,
      shell: process.platform === "win32",
    },
  );
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  const { saveKey, loadKey, createInstrument } =
    await import("../server/chain.mjs");
  if (!fs.existsSync(new URL("issuer.json", dir))) {
    saveKey("issuer.json", Keypair.generate());
  }
  if (!fs.existsSync(new URL("program.json", dir)))
    saveKey("program.json", Keypair.generate());
  const issuer = loadKey("issuer.json"),
    program = loadKey("program.json");
  const bytes = fs.statSync(
    new URL("../program/target/deploy/kase_flow.so", import.meta.url),
  ).size;
  const required =
    (await c.getMinimumBalanceForRentExemption(bytes + 45)) * 2 + 200_000_000;
  const balance = await c.getBalance(issuer.publicKey);
  console.log(
    "Devnet deploy wallet:",
    issuer.publicKey.toBase58(),
    "SOL:",
    balance / 1e9,
    "estimated setup reserve:",
    required / 1e9,
  );
  if (balance < required)
    throw Error(
      "Need test SOL from https://faucet.solana.com; Mainnet SOL cannot be used here.",
    );
  if (
    !(await c.getAccountInfo(program.publicKey))?.executable ||
    process.argv.includes("--upgrade")
  ) {
    const r = spawnSync(
      "solana",
      [
        "program",
        "deploy",
        "program/target/deploy/kase_flow.so",
        "--program-id",
        ".local/devnet/program.json",
        "--keypair",
        ".local/devnet/issuer.json",
        "--url",
        process.env.SOLANA_RPC_URL,
      ],
      { stdio: "inherit", windowsHide: true },
    );
    if (r.status !== 0) throw Error("Devnet program deployment failed");
  }
  if (
    !fs.existsSync(new URL("config.json", dir)) ||
    process.argv.includes("--new")
  ) {
    const walletAt = process.argv.indexOf("--wallet");
    const { config, holders, setupSignatures } = await createInstrument(
      program.publicKey.toBase58(),
      {
        tokenized: true,
        duration: 86400,
        wallet: walletAt >= 0 ? process.argv[walletAt + 1] : null,
      },
    );
    if (fs.existsSync(new URL("config.json", dir))) {
      const old = JSON.parse(fs.readFileSync(new URL("config.json", dir)));
      const journalPath = new URL("journal.json", dir);
      fs.writeFileSync(
        new URL(`archive-${old.state}.json`, dir),
        JSON.stringify(
          {
            config: old,
            journal: fs.existsSync(journalPath)
              ? JSON.parse(fs.readFileSync(journalPath))
              : [],
          },
          null,
          2,
        ),
      );
    }
    holders.forEach((h, i) => {
      if (!config.externalWallet || i !== holders.length - 1)
        saveKey(`holder-${i}.json`, h);
    });
    fs.writeFileSync(
      new URL("config.json", dir),
      JSON.stringify(config, null, 2),
    );
    fs.writeFileSync(
      new URL("journal.json", dir),
      JSON.stringify(
        setupSignatures.map((signature) => ({
          type: "Devnet setup",
          signature,
          time: new Date().toISOString(),
        })),
        null,
        2,
      ),
    );
  }
  console.log(
    "Devnet ready: https://explorer.solana.com/address/" +
      program.publicKey.toBase58() +
      "?cluster=devnet",
  );
}
