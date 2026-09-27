import fs from "node:fs";
import assert from "node:assert/strict";
process.env.SOLANA_CLUSTER = "devnet";
process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";
const {
  connection,
  createInstrument,
  readConfig,
  state,
  tokenBalances,
  send,
  u8,
  u16,
  i64,
} = await import("../server/chain.mjs");
const { config, setupSignatures } = await createInstrument(
  readConfig().programId,
  { tokenized: true, duration: 240, periods: 2, units: [10, 20] },
);
const evidence = { network: "devnet", config, setupSignatures, actions: [] };
fs.writeFileSync(
  ".local/devnet/verification-config.json",
  JSON.stringify(config, null, 2),
);
const initial = await state(config);
const time = async () =>
  await connection.getBlockTime(await connection.getSlot());
const wait = async (date) => {
  while ((await time()) < date) await new Promise((r) => setTimeout(r, 5000));
};
async function run(kind, period, bps, date) {
  const signatures = [];
  signatures.push(
    await send(
      config,
      Buffer.concat([u8(1), u8(kind), u8(period), u16(bps), i64(date)]),
    ),
  );
  await wait(date);
  signatures.push(await send(config, u8(2)));
  signatures.push(await send(config, u8(3)));
  for (let h = 0; h < 2; h++)
    signatures.push(await send(config, Buffer.from([4, h])));
  const s = await state(config),
    balances = await tokenBalances(config);
  assert.equal(s.actions.at(-1).status, 4);
  evidence.actions.push({ kind, period, signatures, balances });
  fs.writeFileSync(
    "artifacts/devnet-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log("Confirmed on Devnet:", {
    kind,
    period,
    supply: balances.supply,
    firstHolderCash: balances.holders[0].cash,
  });
}
await run(0, 1, 0, Math.max(initial.issuedAt + 120, (await time()) + 20));
assert.equal((await tokenBalances(config)).holders[0].cash, "500000000");
await run(2, 0, 2000, (await time()) + 20);
await run(0, 2, 0, Math.max(initial.maturity, (await time()) + 20));
await run(1, 0, 10000, (await time()) + 20);
const final = await tokenBalances(config);
assert.equal(final.supply, "0");
assert.equal(final.holders[0].cash, "10900000000");
console.log(
  "Devnet verified: coupon, partial redemption, final coupon, principal and SPL burn. Evidence: artifacts/devnet-evidence.json",
);
