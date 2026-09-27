import { issueContext } from "./context.mjs";
import { escrowBudget } from "./workspace.mjs";
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
  createInitializeMetadataPointerInstruction,
  createInitializeInstruction as createInitializeTokenMetadataInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
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
// Public Devnet RPC rate-limits bursts. The built-in retry gives up after about
// seven seconds; back off longer (honouring Retry-After) before failing a step.
async function patientFetch(input, init) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(input, init);
    if (response.status !== 429 || attempt === 7) return response;
    const after = Number(response.headers.get("retry-after"));
    const delay =
      after > 0 ? after * 1000 : Math.min(500 * 2 ** attempt, 16000);
    await new Promise((r) => setTimeout(r, delay));
  }
}
export const connection = new Connection(RPC, {
  commitment: "confirmed",
  fetch: patientFetch,
  disableRetryOnRateLimit: true,
});
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
export async function state(config = readConfig(), rpc = connection) {
  const info = await rpc.getAccountInfo(new PublicKey(config.state));
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
    label = { name: "Steppe Energy 2028", symbol: "STPE.28" },
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
        { face: BigInt(face), couponBps, frequency, label },
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
  if (data[0] === 8)
    return [
      meta(vaultAuthority(config)),
      meta(cashMint),
      meta(vault, true),
      meta(TOKEN_PROGRAM_ID),
      meta(
        getAssociatedTokenAddressSync(
          new PublicKey(cashMint),
          loadKey("issuer.json").publicKey,
        ),
        true,
      ),
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
  const signatures = [];
  // Wallets show the bond by name: Token-2022 metadata lives in the mint itself.
  // The issuer initializes it, then hands mint authority to the program PDA.
  const length = getMintLen([
    ExtensionType.PermanentDelegate,
    ExtensionType.MetadataPointer,
  ]);
  const name = clip(terms.label?.name || "KASE Flow bond", 32),
    symbol = clip(terms.label?.symbol || "BOND", 10);
  const metadataLength =
    4 +
    32 +
    32 +
    [name, symbol, ""].reduce((n, v) => n + 4 + Buffer.byteLength(v), 0) +
    4;
  signatures.push(
    await confirmSend(
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: issuer.publicKey,
          newAccountPubkey: bond.publicKey,
          space: length,
          lamports: await connection.getMinimumBalanceForRentExemption(
            length + metadataLength,
          ),
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializePermanentDelegateInstruction(
          bond.publicKey,
          pda,
          TOKEN_2022_PROGRAM_ID,
        ),
        createInitializeMetadataPointerInstruction(
          bond.publicKey,
          issuer.publicKey,
          bond.publicKey,
          TOKEN_2022_PROGRAM_ID,
        ),
        createInitializeMint2Instruction(
          bond.publicKey,
          0,
          issuer.publicKey,
          pda,
          TOKEN_2022_PROGRAM_ID,
        ),
        createInitializeTokenMetadataInstruction({
          programId: TOKEN_2022_PROGRAM_ID,
          metadata: bond.publicKey,
          updateAuthority: issuer.publicKey,
          mint: bond.publicKey,
          mintAuthority: issuer.publicKey,
          name,
          symbol,
          uri: "",
        }),
        createSetAuthorityInstruction(
          bond.publicKey,
          issuer.publicKey,
          AuthorityType.MintTokens,
          pda,
          [],
          TOKEN_2022_PROGRAM_ID,
        ),
      ),
      [issuer, bond],
    ),
  );
  signatures.push(
    await confirmSend(
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: issuer.publicKey,
          newAccountPubkey: cash.publicKey,
          space: 82,
          lamports: await connection.getMinimumBalanceForRentExemption(82),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(
          cash.publicKey,
          6,
          issuer.publicKey,
          null,
        ),
      ),
      [issuer, cash],
    ),
  );
  const named = await nameCashMint(cash.publicKey, issuer);
  if (named) signatures.push(named);
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
  const budget =
    funding === null
      ? escrowBudget({ units, periods, ...terms }).total
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
export async function tokenBalances(config, rpc = connection) {
  if (!config.tokens) return null;
  const t = config.tokens;
  const keys = [t.vault, t.bondMint, ...t.bonds, ...t.cash].map(
    (a) => new PublicKey(a),
  );
  const infos = await rpc.getMultipleAccountsInfo(keys, "confirmed");
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
const clip = (value, bytes) => {
  let v = String(value).trim();
  while (Buffer.byteLength(v) > bytes) v = v.slice(0, -1);
  return v;
};
const METADATA_PROGRAM = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);
// Classic SPL mints are named through Metaplex Token Metadata (CreateMetadataAccountV3).
// Naming is cosmetic, so a failure never blocks issuance.
async function nameCashMint(mint, issuer) {
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM,
  );
  const text = (v) => {
    const b = Buffer.from(v, "utf8");
    return Buffer.concat([u32(b.length), b]);
  };
  const data = Buffer.concat([
    u8(33),
    text("KASE Flow TEST USD"),
    text("TESTUSD"),
    text(""),
    u16(0),
    u8(0), // creators
    u8(0), // collection
    u8(0), // uses
    u8(1), // mutable
    u8(0), // collection details
  ]);
  try {
    return await confirmSend(
      new Transaction().add(
        new TransactionInstruction({
          programId: METADATA_PROGRAM,
          keys: [
            { pubkey: metadata, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: issuer.publicKey, isSigner: true, isWritable: false },
            { pubkey: issuer.publicKey, isSigner: true, isWritable: true },
            { pubkey: issuer.publicKey, isSigner: true, isWritable: false },
            {
              pubkey: SystemProgram.programId,
              isSigner: false,
              isWritable: false,
            },
          ],
          data,
        }),
      ),
      [issuer],
    );
  } catch (e) {
    console.warn("TEST USD metadata skipped:", explain(e));
    return null;
  }
}
export async function withdrawEscrow(config) {
  if (!config.tokens) throw Error("Escrow недоступен");
  const issuer = loadKey("issuer.json");
  const cash = new PublicKey(config.tokens.cashMint);
  await confirmSend(
    new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        issuer.publicKey,
        getAssociatedTokenAddressSync(cash, issuer.publicKey),
        issuer.publicKey,
        cash,
      ),
    ),
    [issuer],
  );
  return send(config, u8(8));
}
const MESSAGES = {
  "Record-date transfer lock":
    "Переводы заблокированы: наступила дата фиксации реестра",
  "Instrument matured": "Срок обращения облигаций истёк",
  "Holder signature required": "Нужна подпись держателя-отправителя",
  "Issuer authority required": "Нужна подпись эмитента",
  "Active action or no capacity/supply":
    "Сначала завершите или отмените текущее действие",
  "Invalid kind or historical record date": "Дата фиксации уже в прошлом",
  "Coupon period invalid or already used": "Этот купон уже выплачен",
  "Coupon period not due": "Дата фиксации раньше даты купона",
  "Record date too far after due date":
    "Дата фиксации позже даты купона более чем на 30 дней",
  "Record date too far after maturity":
    "Дата фиксации позже погашения более чем на 30 дней",
  "Coupon uses instrument rate": "Купон использует ставку выпуска",
  "Redemption before maturity": "Погашение возможно только с даты погашения",
  "Settle all coupon periods before final redemption":
    "Перед погашением выплатите все купоны",
  "Invalid partial redemption":
    "Частичное погашение: 1-99% и дата до срока погашения",
  "Partial redemption retires no whole bond":
    "При такой доле ни одна целая облигация не погашается",
  "Reserve capacity for coupons and final redemption":
    "Не осталось слотов для купонов и погашения",
  "Snapshot not due or already taken":
    "Реестр ещё нельзя зафиксировать или он уже зафиксирован",
  "Snapshot required; cannot initiate twice": "Сначала зафиксируйте реестр",
  "Settlement not initiated": "Расчёт не инициирован",
  "Already settled": "Выплата уже проведена",
  "Only an unpaid action can be cancelled":
    "Отменить можно только действие без проведённых выплат",
  "Escrow is released only after full redemption":
    "Остаток escrow доступен только после полного погашения",
  "Escrow is empty": "Escrow пуст",
  "Unexpected bond mint extensions": "Недопустимые расширения mint облигации",
};
export function explain(error) {
  const logs = error.logs || [];
  const line = logs.find(
    (l) => l.startsWith("Program log:") && !l.includes("Instruction:"),
  );
  const text =
    line?.replace("Program log: ", "") ||
    error.message ||
    "Транзакция не выполнена";
  if (MESSAGES[text]) return MESSAGES[text];
  if (/insufficient funds/i.test(text))
    return "Недостаточно средств в escrow. Пополните тестовый баланс.";
  return text;
}
