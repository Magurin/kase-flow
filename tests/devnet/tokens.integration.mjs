import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PublicKey, Transaction, Keypair } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createTransferCheckedInstruction,
  createBurnCheckedInstruction,
  createThawAccountInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
} from "@solana/spl-token";
import {
  connection,
  readConfig,
  createInstrument,
  state,
  tokenBalances,
  fundVault,
  send,
  instruction,
  confirmSend,
  u8,
  u16,
  i64,
  u64,
  loadKey,
} from "../../server/chain.mjs";
const schedule = (kind, period, bps, date) =>
  Buffer.concat([u8(1), u8(kind), u8(period), u16(bps), i64(date)]);
const expectRejected = async (fn, match) =>
  assert.rejects(fn, (e) => {
    assert.match([e.message, ...(e.logs ?? [])].join(" "), match);
    return true;
  });
const advance = async (at) => {
  while ((await connection.getBlockTime(await connection.getSlot())) < at)
    await new Promise((r) => setTimeout(r, 5000));
};
test("Token-2022 lifecycle: escrow, holder claims, atomic burn, restrictions and retry safety", async () => {
  const { config, holders } = await createInstrument(readConfig().programId, {
    tokenized: true,
    duration: 600,
    periods: 2,
    units: [10, 20],
    funding: 0n,
  });
  const s = await state(config),
    issuer = loadKey("issuer.json");
  let balances = await tokenBalances(config);
  assert.equal(s.tokens.enabled, true);
  assert.equal(balances.supply, "30");
  assert.equal(balances.escrow, "0");
  assert.ok(balances.holders.every((h) => h.frozen));
  const bond = new PublicKey(config.tokens.bondMint),
    a = new PublicKey(config.tokens.bonds[0]),
    b = new PublicKey(config.tokens.bonds[1]);
  const raw = (ix) =>
    confirmSend(new Transaction().add(ix), [issuer, holders[0]]);
  await expectRejected(
    () =>
      raw(
        createTransferCheckedInstruction(
          a,
          bond,
          b,
          holders[0].publicKey,
          1,
          0,
          [],
          TOKEN_2022_PROGRAM_ID,
        ),
      ),
    /frozen/i,
  );
  await expectRejected(
    () =>
      raw(
        createBurnCheckedInstruction(
          a,
          bond,
          holders[0].publicKey,
          1,
          0,
          [],
          TOKEN_2022_PROGRAM_ID,
        ),
      ),
    /frozen/i,
  );
  await expectRejected(
    () =>
      raw(
        createThawAccountInstruction(
          a,
          bond,
          holders[0].publicKey,
          [],
          TOKEN_2022_PROGRAM_ID,
        ),
      ),
    /owner|authority|mismatch/i,
  );
  await expectRejected(
    () =>
      raw(
        createSetAuthorityInstruction(
          a,
          holders[0].publicKey,
          AuthorityType.AccountOwner,
          holders[1].publicKey,
          [],
          TOKEN_2022_PROGRAM_ID,
        ),
      ),
    /frozen|immutable/i,
  );
  await send(config, Buffer.concat([u8(5), u8(0), u8(1), u64(1)]), holders[0]);
  assert.equal((await tokenBalances(config)).holders[0].bonds, "9");
  await send(config, Buffer.concat([u8(5), u8(1), u8(0), u64(1)]), holders[1]);
  await send(config, schedule(0, 1, 0, s.issuedAt + 300));
  await advance(s.issuedAt + 300);
  await expectRejected(
    () =>
      send(config, Buffer.concat([u8(5), u8(0), u8(1), u64(1)]), holders[0]),
    /Record-date/,
  );
  await send(config, u8(2));
  await send(config, u8(3));
  await expectRejected(
    () => send(config, Buffer.from([4, 0])),
    /insufficient funds/i,
  );
  assert.equal((await state(config)).actions[0].rows[0].settled, false);
  assert.equal((await tokenBalances(config)).holders[0].cash, "0");
  await fundVault(config, 100_000_000_000n);
  const bad = instruction(config, Buffer.from([4, 0]), issuer);
  bad.keys[9].pubkey = new PublicKey(config.tokens.cash[1]);
  await expectRejected(
    () => confirmSend(new Transaction().add(bad), [issuer]),
    /Wrong settlement account/,
  );
  await expectRejected(
    () => send(config, Buffer.from([4, 0]), holders[1]),
    /Issuer authority/,
  );
  const signatures = [];
  signatures.push(await send(config, Buffer.from([4, 0]), holders[0]));
  assert.equal((await tokenBalances(config)).holders[0].cash, "500000000");
  await expectRejected(
    () => send(config, Buffer.from([4, 0]), holders[0]),
    /Already settled/,
  );
  await send(config, Buffer.from([4, 1]));
  const partialDate =
    (await connection.getBlockTime(await connection.getSlot())) + 30;
  await send(config, schedule(2, 0, 2000, partialDate));
  await advance(partialDate);
  await send(config, u8(2));
  await send(config, u8(3));
  signatures.push(await send(config, Buffer.from([4, 0]), holders[0]));
  await send(config, Buffer.from([4, 1]));
  balances = await tokenBalances(config);
  assert.equal(balances.supply, "24");
  assert.equal(balances.holders[0].bonds, "8");
  assert.equal(balances.holders[0].cash, "2500000000");
  await send(config, schedule(0, 2, 0, s.maturity));
  await advance(s.maturity);
  await send(config, u8(2));
  await send(config, u8(3));
  await send(config, Buffer.from([4, 0]));
  await send(config, Buffer.from([4, 1]));
  const finalDate =
    (await connection.getBlockTime(await connection.getSlot())) + 30;
  await send(config, schedule(1, 0, 10000, finalDate));
  await advance(finalDate);
  await send(config, u8(2));
  await send(config, u8(3));
  // A bad bond account fails after cash validation: all cash and state stay unchanged.
  const before = await tokenBalances(config),
    beforeState = await state(config);
  const invalid = instruction(config, Buffer.from([4, 0]), issuer);
  invalid.keys[8].pubkey = b;
  await expectRejected(
    () => confirmSend(new Transaction().add(invalid), [issuer]),
    /Bond account/,
  );
  assert.deepEqual(await tokenBalances(config), before);
  assert.deepEqual(await state(config), beforeState);
  signatures.push(await send(config, Buffer.from([4, 0])));
  await send(config, Buffer.from([4, 1]));
  balances = await tokenBalances(config);
  assert.equal(balances.supply, "0");
  assert.equal((await state(config)).retired, "30");
  assert.equal(balances.holders[0].cash, "10900000000");
  assert.ok(balances.holders.every((h) => h.bonds === "0" && h.frozen));
  const tx = await connection.getTransaction(signatures.at(-1), {
    maxSupportedTransactionVersion: 0,
  });
  assert.ok(
    tx.meta.logMessages.some((l) =>
      l.includes("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke"),
    ),
  );
  assert.ok(tx.meta.logMessages.some((l) => l.includes("BurnChecked")));
  fs.writeFileSync(
    "artifacts/devnet-token-security.json",
    JSON.stringify(
      {
        config,
        signatures,
        balances,
        checks: [
          "direct transfers, burns, owner changes and thaw rejected",
          "record-date lock",
          "insufficient escrow leaves entitlement unpaid",
          "wrong recipient/holder rejected",
          "holder-signed coupon exactly 500 TEST USD",
          "duplicate claim rejected",
          "partial and final redemption transfer and burn",
          "mint supply equals registry, final supply zero",
        ],
      },
      null,
      2,
    ),
  );
});
