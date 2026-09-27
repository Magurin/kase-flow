// Run locally when the curated public showcase should include new Devnet issues.
// The generated module contains only public addresses, terms, and transaction IDs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, ".local", "devnet", "issues");
const workspace = JSON.parse(fs.readFileSync(path.join(root, ".local", "devnet", "workspace.json"), "utf8"));
const output = path.join(root, "api", "_public-data.mjs");
const ids = [
  "DmR75U3aHb1KpDVXpiXC9eCHY8aTeQ7soGFpJhzSrvPC", // Complete lifecycle
  "BQFMn6vpcNsWzsXuM2KVR8KKrorZhFgFd6AaRgJ8hyDM", // Open issue
];
const issues = ids.map((id) => {
  const dir = path.join(source, id);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
  const journal = JSON.parse(fs.readFileSync(path.join(dir, "journal.json"), "utf8"));
  const config = {
    programId: raw.programId,
    state: raw.state,
    network: raw.network,
    createdAt: raw.createdAt,
    names: raw.names,
    metadata: raw.metadata,
    wallets: raw.wallets,
    tokens: raw.tokens,
  };
  if (config.state !== id || config.network !== "devnet")
    throw Error(`Unexpected issue configuration: ${id}`);
  return {
    config,
    stats: workspace.issues.find((issue) => issue.id === id)?.stats ?? null,
    journal: journal.map(({ type, label, signature, time, holder }) => ({
      type,
      label,
      signature,
      time,
      holder,
    })),
  };
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `export const publicIssues = ${JSON.stringify(issues, null, 2)};\n`);
console.log(`Wrote ${issues.length} public Devnet issues to api/_public-data.mjs`);
