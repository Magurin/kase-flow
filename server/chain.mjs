import { issueContext } from "./context.mjs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import fs from "node:fs";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializePermanentDelegateInstruction,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  createMintToCheckedInstruction,
  getAccount,
  getMint,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";
export const ROOT = new URL("../", import.meta.url);
export const LOCAL = new URL("../.local/devnet/", import.meta.url);
export const RPC =
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
export const connection = new Connection(RPC, "confirmed");
let verifiedDevnet = false;
export async function assertTestNetwork() {
  if (!verifiedDevnet) {
    if (
      (await connection.getGenesisHash()) !==
      "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
    )
      throw Error("RPC is not Solana Devnet");
    verifiedDevnet = true;
  }
}
export const u8 = (n) => Buffer.from([n]);
export const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
export const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
export const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
export const i64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n));
  return b;
};
export function readConfig() {
  return (
    issueContext.getStore()?.config ??
    JSON.parse(fs.readFileSync(new URL("config.json", LOCAL), "utf8"))
  );
}
export function loadKey(name) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(new URL(name, LOCAL), "utf8"))),
  );
}
export function saveKey(name, key) {
  fs.mkdirSync(LOCAL, { recursive: true });
  fs.writeFileSync(new URL(name, LOCAL), JSON.stringify([...key.secretKey]));
}
export function decode(data) {
  let p = 0;
  const b = () => data.readUInt8(p++),
    short = () => {
      const v = data.readUInt16LE(p);
      p += 2;
      return v;
    },
    long = () => {
      const v = data.readUInt32LE(p);
      p += 4;
      return v;
    },
    num = () => {
      const v = data.readBigUInt64LE(p);
      p += 8;
      return v.toString();
    },
    time = () => {
      const v = data.readBigInt64LE(p);
      p += 8;
      return Number(v);
    },
    key = () => {
      const v = new PublicKey(data.subarray(p, p + 32)).toBase58();
      p += 32;
      return v;
    };
  const s = {
    initialized: !!b(),
    authority: key(),
    face: num(),
    couponBps: short(),
    frequency: b(),
    periods: b(),
    issuedAt: time(),
    maturity: time(),
    supply: num(),
    retired: num(),
    couponMask: num(),
    holders: [],
    actions: [],
  };
  for (let n = long(), i = 0; i < n; i++)
    s.holders.push({ index: i, wallet: key(), units: num() });
  for (let n = long(), i = 0; i < n; i++) {
    const a = {
      id: i + 1,
      kind: b(),
      period: b(),
      bps: short(),
      recordAt: time(),
      snapshotSlot: num(),
      status: b(),
      rows: [],
    };
    for (let m = long(), j = 0; j < m; j++)
      a.rows.push({
        holder: b(),
        units: num(),
        retireUnits: num(),
        amount: num(),
        settled: !!b(),
      });
    s.actions.push(a);
  }
  s.tokens = { enabled: !!b(), bondMint: key(), cashMint: key(), vault: key() };
  return s;
}
export async function state(config = readConfig()) {
  const info = await connection.getAccountInfo(new PublicKey(config.state));
  if (!info || !info.owner.equals(new PublicKey(config.programId)))
    throw new Error("Instrument account unavailable");
  return decode(info.data);
}
export function instruction(config, data, signer, stateSigns = false) {
  return new TransactionInstruction({
    programId: new PublicKey(config.programId),
    keys: [
      {
        pubkey: new PublicKey(config.state),
        isSigner: stateSigns,
        isWritable: true,
      },
      { pubkey: signer.publicKey, isSigner: true, isWritable: false },
      ...tokenKeys(config, data),
    ],
    data,
  });
}
export async function send(config, data, signer = loadKey("issuer.json")) {
  const issuer = loadKey("issuer.json");
  const tx = new Transaction().add(instruction(config, data, signer));
  tx.feePayer = issuer.publicKey;
  return confirmSend(
    tx,
    signer.publicKey.equals(issuer.publicKey) ? [issuer] : [issuer, signer],
  );
}
export async function confirmSend(tx, signers) {
  await assertTestNetwork();
  tx.recentBlockhash = (
    await connection.getLatestBlockhash("confirmed")
  ).blockhash;
  tx.feePayer ??= signers[0].publicKey;
  tx.sign(...signers);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  return waitSignature(signature);
}
export async function waitSignature(signature) {
  for (let i = 0; i < 60; i++) {
    const { value } = await connection.getSignatureStatuses([signature]);
    if (value[0]?.err) throw new Error(JSON.stringify(value[0].err));
    if (["confirmed", "finalized"].includes(value[0]?.confirmationStatus))
      return signature;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Confirmation timed out: ${signature}. Check journal before retrying.`,
  );
}
export async function createInstrument(
  programId,
  {
    duration = 600,
    periods = 4,
    units = [400, 300, 200, 100],
    tokenized = true,
    wallet = null,
    funding = null,
    face = 1_000_000_000n,
    couponBps = 1000,
    frequency = 2,
    names = ["Alatau Capital", "Steppe Ventures", "Aida S.", "Timur K."],
    holderWallets = null,
    metadata = null,
    checkpoint = async () => {},
  } = {},
) {
  const issuer = loadKey("issuer.json");
  const account = Keypair.generate();
  const holders = units.map(() => Keypair.generate());
  const wallets = holders.map((h, i) =>
    holderWallets?.[i] ? new PublicKey(holderWallets[i]) : h.publicKey,
  );
  if (wallet) wallets[wallets.length - 1] = new PublicKey(wallet);
  const slot = await connection.getSlot();
  const now =
    (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  const config = {
    programId,
    state: account.publicKey.toBase58(),
    network: "devnet",
    rpc: RPC,
    createdAt: new Date().toISOString(),
    names,
    metadata,
    wallets: wallets.map((w) => w.toBase58()),
    externalWallet: wallet,
  };
  const data = Buffer.concat([
    u8(0),
    u64(face),
    u16(couponBps),
    u8(frequency),
    u8(periods),
    i64(now + duration),
    u32(holders.length),
    ...wallets.flatMap((h, i) => [h.toBuffer(), u64(units[i])]),
  ]);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: issuer.publicKey,
      newAccountPubkey: account.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(16384),
      space: 16384,
      programId: new PublicKey(programId),
    }),
    instruction(config, data, issuer, true),
  );
  await checkpoint({ config, holders, account, setupSignatures: [] });
  const signature = await confirmSend(tx, [issuer, account]);
  const setupSignatures = [signature];
  await checkpoint({ config, holders, account, setupSignatures });
  if (tokenized)
    setupSignatures.push(
      ...(await attachTokens(
        config,
        wallets,
        units,
        periods,
        funding,
        { face: BigInt(face), couponBps, frequency },
        async (signatures) =>
          checkpoint({
            config,
            holders,
            account,
            setupSignatures: [signature, ...signatures],
          }),
      )),
    );
  return { config, holders, signature, setupSignatures };
}

const meta = (key, writable = false) => ({
  pubkey: new PublicKey(key),
  isSigner: false,
  isWritable: writable,
});
export function vaultAuthority(config) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), new PublicKey(config.state).toBuffer()],
    new PublicKey(config.programId),
  )[0];
}
export function tokenKeys(config, data) {
  if (!config.tokens) return [];
  const { bondMint, cashMint, vault, bonds, cash } = config.tokens;
  const common = [meta(vaultAuthority(config)), meta(bondMint, true)];
  if (data[0] === 5)
    return [
      ...common,
      meta(TOKEN_2022_PROGRAM_ID),
      meta(bonds[data[1]], true),
      meta(bonds[data[2]], true),
    ];
  if (data[0] !== 4 && data[0] !== 6) return [];
  const settlement = [
    ...common,
    meta(cashMint),
    meta(vault, true),
    meta(TOKEN_2022_PROGRAM_ID),
    meta(TOKEN_PROGRAM_ID),
  ];
  return data[0] === 6
    ? [...settlement, ...bonds.map((a) => meta(a, true))]
    : [...settlement, meta(bonds[data[1]], true), meta(cash[data[1]], true)];
}
async function attachTokens(
  config,
  wallets,
  units,
  periods,
  funding,
  terms,
  checkpoint,
) {
  const issuer = loadKey("issuer.json"),
    pda = vaultAuthority(config);
  const bond = Keypair.generate(),
    cash = Keypair.generate();
  const length = getMintLen([ExtensionType.PermanentDelegate]);
  const signatures = [];
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: issuer.publicKey,
      newAccountPubkey: bond.publicKey,
      space: length,
      lamports: await connection.getMinimumBalanceForRentExemption(length),
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializePermanentDelegateInstruction(
      bond.publicKey,
      pda,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMint2Instruction(
      bond.publicKey,
      0,
      pda,
      pda,
      TOKEN_2022_PROGRAM_ID,
    ),
    SystemProgram.createAccount({
      fromPubkey: issuer.publicKey,
      newAccountPubkey: cash.publicKey,
      space: 82,
      lamports: await connection.getMinimumBalanceForRentExemption(82),
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(cash.publicKey, 6, issuer.publicKey, null),
  );
  signatures.push(await confirmSend(tx, [issuer, bond, cash]));
  const vault = getAssociatedTokenAddressSync(cash.publicKey, pda, true);
  config.tokens = {
    bondMint: bond.publicKey.toBase58(),
    cashMint: cash.publicKey.toBase58(),
    vault: vault.toBase58(),
    bonds: wallets.map((w) =>
      getAssociatedTokenAddressSync(
        bond.publicKey,
        w,
        false,
        TOKEN_2022_PROGRAM_ID,
      ).toBase58(),
    ),
    cash: wallets.map((w) =>
      getAssociatedTokenAddressSync(cash.publicKey, w).toBase58(),
    ),
  };
  await checkpoint(signatures);
  const totalUnits = units.reduce((n, x) => n + BigInt(x), 0n);
  const budget =
    funding === null
      ? totalUnits * terms.face +
        units.reduce(
          (n, x) =>
            n +
            (BigInt(x) * terms.face * BigInt(terms.couponBps)) /
              (10000n * BigInt(terms.frequency)),
          0n,
        ) *
          BigInt(periods)
      : BigInt(funding);
  signatures.push(
    await confirmSend(
      new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          issuer.publicKey,
          vault,
          pda,
          cash.publicKey,
        ),
        createMintToCheckedInstruction(
          cash.publicKey,
          vault,
          issuer.publicKey,
          budget,
          6,
        ),
      ),
      [issuer],
    ),
  );
  for (let i = 0; i < wallets.length; i++) {
    signatures.push(
      await confirmSend(
        new Transaction().add(
          createAssociatedTokenAccountIdempotentInstruction(
            issuer.publicKey,
            new PublicKey(config.tokens.bonds[i]),
            wallets[i],
            bond.publicKey,
            TOKEN_2022_PROGRAM_ID,
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            issuer.publicKey,
            new PublicKey(config.tokens.cash[i]),
            wallets[i],
            cash.publicKey,
          ),
        ),
        [issuer],
      ),
    );
  }
  await checkpoint(signatures);
  signatures.push(await send(config, u8(6)));
  await checkpoint(signatures);
  return signatures;
}
export async function tokenBalances(config) {
  if (!config.tokens) return null;
  const t = config.tokens;
  const keys = [t.vault, t.bondMint, ...t.bonds, ...t.cash].map(
    (a) => new PublicKey(a),
  );
  const infos = await connection.getMultipleAccountsInfo(keys, "confirmed");
  const vault = unpackAccount(keys[0], infos[0]);
  const mint = unpackMint(keys[1], infos[1], TOKEN_2022_PROGRAM_ID);
  const accounts = infos
    .slice(2)
    .map((info, i) =>
      unpackAccount(
        keys[i + 2],
        info,
        i < t.bonds.length ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      ),
    );
  return {
    escrow: vault.amount.toString(),
    supply: mint.supply.toString(),
    holders: t.bonds.map((_, i) => ({
      bonds: accounts[i].amount.toString(),
      frozen: accounts[i].isFrozen,
      cash: accounts[i + t.bonds.length].amount.toString(),
    })),
  };
}
export async function fundVault(config, amount) {
  if (!config.tokens) throw Error("Token escrow unavailable");
  const issuer = loadKey("issuer.json");
  return confirmSend(
    new Transaction().add(
      createMintToCheckedInstruction(
        new PublicKey(config.tokens.cashMint),
        new PublicKey(config.tokens.vault),
        issuer.publicKey,
        BigInt(amount),
        6,
      ),
    ),
    [issuer],
  );
}
export function explain(error) {
  const logs = error.logs || [];
  const line = logs.find(
    (l) => l.startsWith("Program log:") && !l.includes("Instruction:"),
  );
  return (
    line?.replace("Program log: ", "") || error.message || "Transaction failed"
  );
}
