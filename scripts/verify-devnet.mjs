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
  withdrawEscrow,
  loadKey,
  u8,
  u16,
  i64,
} = await import("../server/chain.mjs");
const { getTokenMetadata, getAssociatedTokenAddressSync, getAccount } =
  await import("@solana/spl-token");
const { PublicKey } = await import("@solana/web3.js");
// --resume continues the last verification instrument from its on-chain state,
// e.g. after the public RPC rate-limited a step.
const resume = process.argv.includes("--resume");
const CONFIG = ".local/devnet/verification-config.json",
  EVIDENCE = "artifacts/devnet-evidence.json";
const { config, setupSignatures } = resume
  ? { config: JSON.parse(fs.readFileSync(CONFIG, "utf8")) }
  : await createInstrument(readConfig().programId, {
      tokenized: true,
      duration: 240,
      periods: 2,
      units: [10, 20],
    });
const evidence = resume
  ? JSON.parse(fs.readFileSync(EVIDENCE, "utf8"))
  : { network: "devnet", config, setupSignatures, actions: [] };
if (!resume) fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));
const initial = await state(config);
const bondMeta = await getTokenMetadata(
  connection,
  new PublicKey(config.tokens.bondMint),
);
assert.equal(bondMeta?.symbol, "STPE.28");
const metaplex = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const [cashMeta] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("metadata"),
    metaplex.toBuffer(),
    new PublicKey(config.tokens.cashMint).toBuffer(),
  ],
  metaplex,
);
evidence.metadata = {
  bond: { name: bondMeta.name, symbol: bondMeta.symbol },
  cashMetadataAccount: (await connection.getAccountInfo(cashMeta))
    ? cashMeta.toBase58()
    : null,
};
console.log("Token metadata:", evidence.metadata);
const time = async () =>
  await connection.getBlockTime(await connection.getSlot());
const wait = async (date) => {
  while ((await time()) < date) await new Promise((r) => setTimeout(r, 5000));
};
// Each step starts from the chain status, so a resumed run never repeats one.
async function run(kind, period, bps, date) {
  let s = await state(config);
  if (
    s.actions.some(
      (a) => a.kind === kind && a.period === period && a.status === 4,
    )
  )
    return;
  const signatures = [];
  const open = s.actions.at(-1);
  if (open && open.status < 4) date = open.recordAt;
  else
    signatures.push(
      await send(
        config,
        Buffer.concat([u8(1), u8(kind), u8(period), u16(bps), i64(date)]),
      ),
    );
  await wait(date);
  let a = (await state(config)).actions.at(-1);
  if (a.status === 0) signatures.push(await send(config, u8(2)));
  if (a.status <= 1) signatures.push(await send(config, u8(3)));
  a = (await state(config)).actions.at(-1);
  for (const r of a.rows.filter((r) => !r.settled))
    signatures.push(await send(config, Buffer.from([4, r.holder])));
  s = await state(config);
  const balances = await tokenBalances(config);
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
// A scheduled but unpaid action can be withdrawn and rescheduled.
const firstDue = Math.max(initial.issuedAt + 120, (await time()) + 20);
if (!evidence.cancel) {
  evidence.cancel = [
    await send(
      config,
      Buffer.concat([u8(1), u8(0), u8(1), u16(0), i64(firstDue)]),
    ),
    await send(config, u8(7)),
  ];
  assert.equal((await state(config)).actions.length, 0);
}
await run(0, 1, 0, firstDue);
assert.equal(
  evidence.actions.find((a) => a.kind === 0 && a.period === 1).balances
    .holders[0].cash,
  "500000000",
);
await run(2, 0, 2000, (await time()) + 20);
// Coupon 2 is due at maturity; its record date may not be earlier.
await run(0, 2, 0, Math.max(initial.maturity, (await time()) + 20));
await run(1, 0, 10000, (await time()) + 20);
const final = await tokenBalances(config);
assert.equal(final.supply, "0");
assert.equal(final.holders[0].cash, "10900000000");
// 300 TEST USD of coupon 2 were not needed after the partial redemption,
// plus the 4 micro-unit rounding reserve (2 holders x 2 periods).
assert.equal(final.escrow, "300000004");
const issuerCash = getAssociatedTokenAddressSync(
  new PublicKey(config.tokens.cashMint),
  loadKey("issuer.json").publicKey,
);
evidence.withdraw ??= await withdrawEscrow(config);
assert.equal((await tokenBalances(config)).escrow, "0");
assert.equal(
  (await getAccount(connection, issuerCash)).amount.toString(),
  "300000004",
);
fs.writeFileSync(
  "artifacts/devnet-evidence.json",
  JSON.stringify(evidence, null, 2),
);
console.log(
  "Devnet verified: metadata, cancel, coupon, partial redemption, final coupon, principal, SPL burn and escrow release. Evidence: artifacts/devnet-evidence.json",
);
