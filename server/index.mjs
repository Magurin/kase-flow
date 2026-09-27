import path from "node:path";
import { issueContext } from "./context.mjs";
import { WorkspaceStore, writeJson, draftBudget, micro } from "./workspace.mjs";
import express from "express";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { PublicKey, Transaction } from "@solana/web3.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  connection,
  LOCAL,
  ROOT,
  readConfig,
  state,
  send,
  u8,
  u16,
  u64,
  i64,
  loadKey,
  explain,
  createInstrument,
  saveKey,
  RPC,
  tokenBalances,
  instruction,
  fundVault,
  assertTestNetwork,
} from "./chain.mjs";
const app = express();
app.use(express.json({ limit: "10kb" }));
const workspace = new WorkspaceStore(fileURLToPath(LOCAL));
const currentDir = () => issueContext.getStore()?.dir ?? fileURLToPath(LOCAL);
const journalFile = () => path.join(currentDir(), "journal.json");
const journal = () =>
  fs.existsSync(journalFile())
    ? JSON.parse(fs.readFileSync(journalFile(), "utf8"))
    : [];
const autoFile = () => path.join(currentDir(), "automation.json");
const readAuto = () =>
  fs.existsSync(autoFile())
    ? JSON.parse(fs.readFileSync(autoFile(), "utf8"))
    : { enabled: false, error: null, lastRun: null };
const saveAuto = (automation) => writeJson(autoFile(), automation);
const snapshots = new Map();
function record(type, signature, extra = {}) {
  snapshots.clear();
  const entries = journal();
  entries.unshift({
    type,
    signature,
    time: new Date().toISOString(),
    ...extra,
  });
  writeJson(journalFile(), entries);
}
app.use("/api", (req, res, next) => {
  if (req.method === "POST")
    res.on("finish", () => {
      snapshots.clear();
    });
  if (
    req.method !== "GET" &&
    req.headers.origin &&
    ![
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      "http://127.0.0.1:3001",
      "http://localhost:3001",
    ].includes(req.headers.origin)
  )
    return res.status(403).json({ error: "Origin denied" });
  next();
});
app.use("/api", (req, res, next) => {
  try {
    const id =
      req.headers["x-instrument-id"] || req.query.issue || readConfig().state;
    if (typeof id !== "string") throw Error("Invalid instrument ID");
    const context = workspace.context(id);
    issueContext.run(context, next);
  } catch (e) {
    res.status(404).json({ error: explain(e) });
  }
});
async function snapshot(config = readConfig()) {
  const id = config.state;
  const cached = snapshots.get(id);
  if (cached && Date.now() - cached.at < 8000) return cached.promise;
  const promise = (async () => {
    const [instrument, slot] = await Promise.all([
      state(config),
      connection.getSlot(),
    ]);
    const chainTime = await connection.getBlockTime(slot);
    if (chainTime === null) throw Error("Время сети временно недоступно");
    const balances = await tokenBalances(config);
    const item = workspace.data.issues.find((i) => i.id === id);
    if (item) {
      item.stats = {
        supply: instrument.supply,
        paid: String(
          instrument.actions
            .flatMap((a) => a.rows)
            .filter((r) => r.settled)
            .reduce((n, r) => n + BigInt(r.amount), 0n),
        ),
        escrow: balances?.escrow ?? "0",
        maturity: instrument.maturity,
        updatedAt: new Date().toISOString(),
      };
      workspace.save();
    }
    return {
      ...instrument,
      config,
      slot,
      chainTime,
      journal: journal(),
      settlementMode: "spl-test-cash",
      tokenModel: "Token-2022 restricted bonds",
      balances,
      automation: readAuto(),
    };
  })();
  snapshots.set(id, { at: Date.now(), promise });
  try {
    return await promise;
  } catch (e) {
    snapshots.delete(id);
    throw e;
  }
}
app.get("/api/state", async (req, res) => {
  try {
    res.json(await snapshot());
  } catch (e) {
    res.status(503).json({ error: explain(e) });
  }
});
let pending = false;
app.get("/api/workspace", (req, res) =>
  res.json({
    issues: workspace.data.issues,
    drafts: workspace.data.drafts.map((d) => ({
      ...d,
      budget: draftBudget(d.terms),
    })),
    pending,
  }),
);
app.post("/api/drafts", (req, res) => {
  try {
    res.json(
      workspace.saveDraft(req.body.terms, req.body.id, req.body.revision),
    );
  } catch (e) {
    res.status(400).json({ error: explain(e) });
  }
});
app.post("/api/drafts/:id/approve", (req, res) => {
  try {
    res.json(workspace.approve(req.params.id, req.body.revision));
  } catch (e) {
    res.status(400).json({ error: explain(e) });
  }
});
app.post("/api/drafts/:id/publish", async (req, res) => {
  if (pending)
    return res
      .status(409)
      .json({ error: "Дождитесь завершения текущей операции" });
  pending = true;
  let draft;
  try {
    await assertTestNetwork();
    draft = workspace.beginPublish(req.params.id, req.body.revision);
    const t = draft.terms,
      provisioning = path.join(fileURLToPath(LOCAL), "provisioning", draft.id);
    const metadata = {
      issuer: t.issuer,
      name: t.name,
      symbol: t.symbol,
      draftId: draft.id,
      termsHash: draft.approval.hash,
      document: t.document,
    };
    const result = await createInstrument(readConfig().programId, {
      duration: t.duration,
      periods: t.periods,
      frequency: t.frequency,
      couponBps: t.couponBps,
      face: micro(t.face),
      units: t.applications.map((a) => a.units),
      names: t.applications.map((a) => a.name),
      holderWallets: t.applications.map((a) => a.wallet),
      metadata,
      checkpoint: async ({ config, holders, account, setupSignatures }) => {
        draft.provisioning = { config, setupSignatures };
        workspace.save();
        writeJson(path.join(provisioning, "state-key.json"), [
          ...account.secretKey,
        ]);
        holders.forEach((h, i) => {
          if (h.publicKey.toBase58() === config.wallets[i])
            writeJson(path.join(provisioning, `holder-${i}.json`), [
              ...h.secretKey,
            ]);
        });
      },
    });
    const entries = result.setupSignatures.map((signature) => ({
      type: "Instrument setup",
      signature,
      time: new Date().toISOString(),
    }));
    workspace.register(result.config, metadata, entries);
    result.holders.forEach((h, i) => {
      if (h.publicKey.toBase58() === result.config.wallets[i])
        writeJson(
          path.join(workspace.dir(result.config.state), `holder-${i}.json`),
          [...h.secretKey],
        );
    });
    draft.status = "published";
    draft.issueId = result.config.state;
    draft.publishedAt = new Date().toISOString();
    draft.history.push({
      event: "Размещён в Solana Devnet",
      at: draft.publishedAt,
      state: draft.issueId,
    });
    workspace.save();
    res.json({ issueId: draft.issueId, signature: result.signature });
  } catch (e) {
    if (draft) {
      draft.status = draft.provisioning ? "needs_review" : "approved";
      draft.error = explain(e);
      workspace.save();
    }
    res.status(400).json({ error: explain(e) });
  } finally {
    pending = false;
  }
});
// Reconcile a completed issuance after an ambiguous response; this sends no transactions.
app.post("/api/drafts/:id/reconcile", async (req, res) => {
  if (pending)
    return res
      .status(409)
      .json({ error: "Дождитесь завершения текущей операции" });
  pending = true;
  try {
    const d = workspace.getDraft(req.params.id);
    if (d.status !== "needs_review" || !d.provisioning?.config)
      throw Error("Нет прерванного размещения для проверки");
    const config = d.provisioning.config,
      live = await state(config),
      balances = await tokenBalances(config);
    if (
      !live.tokens.enabled ||
      live.tokens.bondMint !== config.tokens?.bondMint ||
      live.tokens.cashMint !== config.tokens?.cashMint ||
      live.face !== String(micro(d.terms.face)) ||
      live.couponBps !== d.terms.couponBps ||
      live.frequency !== d.terms.frequency ||
      live.periods !== d.terms.periods ||
      live.holders.length !== config.wallets.length ||
      live.holders.some((h, i) => h.wallet !== config.wallets[i]) ||
      !balances ||
      balances.supply !== live.supply
    )
      throw Error(
        "Размещение в сети не завершено. Автоматический повтор заблокирован; сохранённые ключи и аккаунты требуют технической проверки.",
      );
    if (!workspace.data.issues.some((i) => i.id === config.state))
      workspace.register(
        config,
        config.metadata,
        d.provisioning.setupSignatures.map((signature) => ({
          type: "Recovered setup",
          signature,
          time: new Date().toISOString(),
        })),
      );
    const staging = path.join(fileURLToPath(LOCAL), "provisioning", d.id);
    config.wallets.forEach((wallet, i) => {
      const file = path.join(staging, `holder-${i}.json`);
      if (fs.existsSync(file))
        fs.copyFileSync(
          file,
          path.join(workspace.dir(config.state), `holder-${i}.json`),
        );
    });
    d.status = "published";
    d.issueId = config.state;
    d.error = null;
    d.history.push({
      event: "Размещение сверено с сетью",
      at: new Date().toISOString(),
    });
    workspace.save();
    res.json({ issueId: config.state });
  } catch (e) {
    res.status(400).json({ error: explain(e) });
  } finally {
    pending = false;
  }
});
app.post("/api/demo", async (req, res) => {
  if (pending)
    return res.status(409).json({ error: "Another transaction is confirming" });
  pending = true;
  try {
    await assertTestNetwork();
    const old = readConfig();
    const wallet = req.body.wallet
      ? new PublicKey(req.body.wallet).toBase58()
      : null;
    const { config, holders, signature, setupSignatures } =
      await createInstrument(old.programId, {
        tokenized: true,
        duration: 600,
        wallet,
      });
    const metadata = {
      issuer: "Steppe Energy",
      name: "Steppe Energy",
      symbol: "STPE.28",
    };
    const entries = setupSignatures.map((signature) => ({
      type: "Instrument setup",
      signature,
      time: new Date().toISOString(),
    }));
    workspace.register(config, metadata, entries);
    holders.forEach((h, i) => {
      if (h.publicKey.toBase58() === config.wallets[i]) {
        saveKey(`holder-${i}.json`, h);
        writeJson(path.join(workspace.dir(config.state), `holder-${i}.json`), [
          ...h.secretKey,
        ]);
      }
    });
    writeJson(fileURLToPath(new URL("config.json", LOCAL)), config);
    writeJson(fileURLToPath(new URL("journal.json", LOCAL)), entries);
    res.json({ signature, issueId: config.state });
  } catch (e) {
    res.status(400).json({ error: explain(e) });
  } finally {
    pending = false;
  }
});
app.post("/api/action", async (req, res) => {
  if (pending)
    return res.status(409).json({ error: "Another transaction is confirming" });
  pending = true;
  try {
    const config = readConfig();
    const { operation } = req.body;
    let data;
    let signer;
    const integer = (v, min, max) => {
      if (!Number.isInteger(v) || v < min || v > max)
        throw new Error("Invalid integer input");
      return v;
    };
    if (operation === "schedule") {
      const { kind, period = 0, bps = 0, recordAt } = req.body;
      data = Buffer.concat([
        u8(1),
        u8(integer(kind, 0, 2)),
        u8(integer(period, 0, 32)),
        u16(integer(bps, 0, 10000)),
        i64(integer(recordAt, 0, Number.MAX_SAFE_INTEGER)),
      ]);
    } else if (operation === "snapshot") data = u8(2);
    else if (operation === "initiate") data = u8(3);
    else if (operation === "confirm")
      data = Buffer.concat([u8(4), u8(integer(req.body.holder, 0, 15))]);
    else if (operation === "transfer") {
      const from = integer(req.body.from, 0, 15),
        to = integer(req.body.to, 0, 15),
        units = integer(req.body.units, 1, 1e9);
      signer = loadKey(
        pathToFileURL(path.join(currentDir(), `holder-${from}.json`)).href,
      );
      if (
        signer.publicKey.toBase58() !==
        (await state(config)).holders[from]?.wallet
      )
        throw Error("Use the connected wallet to sign this transfer");
      data = Buffer.concat([u8(5), u8(from), u8(to), u64(units)]);
    } else throw new Error("Unknown operation");
    const signature = await send(config, data, signer);
    const entries = journal();
    entries.unshift({
      type: operation,
      signature,
      time: new Date().toISOString(),
      holder: req.body.holder,
    });
    writeJson(journalFile(), entries);
    res.json({ signature });
  } catch (e) {
    res.status(400).json({ error: explain(e) });
  } finally {
    pending = false;
  }
});
app.post("/api/automation", (req, res) => {
  if (typeof req.body.enabled !== "boolean")
    return res.status(400).json({ error: "Expected enabled boolean" });
  const automation = readAuto();
  automation.enabled = req.body.enabled;
  automation.error = null;
  saveAuto(automation);
  res.json(automation);
});
app.post("/api/fund", async (req, res) => {
  if (pending)
    return res.status(409).json({ error: "Another transaction is confirming" });
  pending = true;
  try {
    await assertTestNetwork();
    const signature = await fundVault(readConfig(), 100_000_000_000n);
    record("Test escrow funded", signature);
    res.json({ signature });
  } catch (e) {
    res.status(400).json({ error: explain(e) });
  } finally {
    pending = false;
  }
});

// Only server-built messages can receive fee sponsorship. The holder signs;
// neither a private key nor a caller-supplied instruction is accepted by the API.
const proposals = new Map();
app.post("/api/wallet/prepare", async (req, res) => {
  try {
    const config = readConfig(),
      s = await state(config);
    const publicKey = new PublicKey(req.body.wallet);
    const holder = s.holders.findIndex(
      (h) => h.wallet === publicKey.toBase58(),
    );
    if (holder < 0 || !s.tokens.enabled)
      throw Error("Wallet is not a holder in this tokenized issue");
    const a = s.actions.at(-1);
    if (
      !a ||
      ![2, 3].includes(a.status) ||
      !a.rows.some((r) => r.holder === holder && !r.settled)
    )
      throw Error("No payable entitlement");
    const issuer = loadKey("issuer.json");
    const tx = new Transaction({
      feePayer: issuer.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    }).add(instruction(config, Buffer.from([4, holder]), { publicKey }));
    tx.partialSign(issuer);
    const id = randomUUID();
    for (const [key, value] of proposals)
      if (value.expires < Date.now()) proposals.delete(key);
    if (proposals.size >= 100) throw Error("Too many pending wallet requests");
    proposals.set(id, {
      message: tx.serializeMessage().toString("base64"),
      state: config.state,
      holder,
      action: a.id,
      expires: Date.now() + 120_000,
    });
    res.json({
      id,
      transaction: tx
        .serialize({ requireAllSignatures: false })
        .toString("base64"),
      network: config.network,
    });
  } catch (e) {
    res.status(400).json({ error: explain(e) });
  }
});
app.post("/api/wallet/submit", async (req, res) => {
  if (pending)
    return res.status(409).json({ error: "Another transaction is confirming" });
  pending = true;
  try {
    const p = proposals.get(req.body.id);
    if (!p || p.expires < Date.now() || p.state !== readConfig().state)
      throw Error("Wallet request expired; prepare again");
    const tx = Transaction.from(Buffer.from(req.body.transaction, "base64"));
    if (
      tx.serializeMessage().toString("base64") !== p.message ||
      !tx.verifySignatures()
    )
      throw Error(
        "Transaction or signatures do not match the prepared request",
      );
    const live = await state();
    if (live.actions.at(-1)?.id !== p.action)
      throw Error("Corporate action changed; prepare again");
    await assertTestNetwork();
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
    });
    const { waitSignature } = await import("./chain.mjs");
    await waitSignature(signature);
    proposals.delete(req.body.id);
    record("Wallet claim", signature, { holder: p.holder });
    res.json({ signature });
  } catch (e) {
    res.status(400).json({ error: explain(e) });
  } finally {
    pending = false;
  }
});

// One on-chain step per tick; durable chain status is the retry checkpoint.
// A timeout may be retried but the program rejects a second payment.
async function automate() {
  const automation = readAuto();
  if (!automation.enabled) return;
  try {
    const config = readConfig(),
      s = await state(config);
    if (!s.tokens.enabled) throw Error("Automation requires token settlement");
    const now = await connection.getBlockTime(await connection.getSlot());
    const a = s.actions.at(-1);
    let data, type;
    if (a && a.status < 4) {
      if (a.status === 0 && now >= a.recordAt) {
        data = u8(2);
        type = "Auto snapshot";
      } else if (a.status === 1) {
        data = u8(3);
        type = "Auto initiate";
      } else if ([2, 3].includes(a.status)) {
        const row = a.rows.find((r) => !r.settled);
        const balances = await tokenBalances(config);
        if (BigInt(balances.escrow) < BigInt(row.amount))
          throw Error(
            "Недостаточно TEST USD в escrow. Пополните тестовый баланс.",
          );
        data = Buffer.from([4, row.holder]);
        type = "Auto payment";
      }
    } else if (BigInt(s.supply) > 0n) {
      const period = Array.from({ length: s.periods }, (_, i) => i + 1).find(
        (p) => !(BigInt(s.couponMask) & (1n << BigInt(p))),
      );
      if (period) {
        const due =
          s.issuedAt +
          Math.floor(((s.maturity - s.issuedAt) * period) / s.periods);
        if (now >= due) {
          data = Buffer.concat([
            u8(1),
            u8(0),
            u8(period),
            u16(0),
            i64(now + 30),
          ]);
          type = "Auto coupon scheduled";
        }
      } else if (now >= s.maturity) {
        data = Buffer.concat([u8(1), u8(1), u8(0), u16(10000), i64(now + 30)]);
        type = "Auto redemption scheduled";
      }
    }
    if (data) {
      const signature = await send(config, data);
      record(type, signature);
      automation.lastRun = new Date().toISOString();
    }
    automation.error = null;
    automation.enabled = readAuto().enabled;
    saveAuto(automation);
  } catch (e) {
    automation.error = explain(e);
    automation.enabled = readAuto().enabled;
    saveAuto(automation);
  }
}
let nextIssue = 0;
setInterval(async () => {
  if (pending || !workspace.data.issues.length) return;
  pending = true;
  try {
    const issue =
      workspace.data.issues[nextIssue++ % workspace.data.issues.length];
    await issueContext.run(workspace.context(issue.id), automate);
  } finally {
    pending = false;
  }
}, 2500).unref();

app.get("/api/transaction/:signature", async (req, res) => {
  try {
    const tx = await connection.getTransaction(req.params.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx) return res.status(404).json({ error: "Transaction unavailable" });
    res.json(tx);
  } catch (e) {
    res.status(400).json({ error: explain(e) });
  }
});
app.get("/api/export", async (req, res) => {
  try {
    const config = readConfig();
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="kase-flow-audit.json"',
    );
    res.json({
      exportedAt: new Date().toISOString(),
      settlement: config.tokens
        ? "Actual transfers of unbacked SPL TEST USD; Token-2022 bonds; no real money"
        : "Simulated fiat acknowledgements; no money transferred",
      runtime: "Solana Devnet; unbacked test tokens, no real money",
      ...config,
      state: await state(config),
      balances: await tokenBalances(config),
      transactions: journal(),
      termsRecord:
        workspace.data.drafts.find((d) => d.issueId === config.state) ?? null,
    });
  } catch (e) {
    res.status(503).json({ error: explain(e) });
  }
});
app.use(express.static(fileURLToPath(new URL("dist/", ROOT))));
app.get("/{*path}", (req, res) =>
  res.sendFile(fileURLToPath(new URL("dist/index.html", ROOT))),
);
const port = Number(process.env.API_PORT || 3001);
app.listen(port, "127.0.0.1", () =>
  console.log(`KASE Flow API: http://127.0.0.1:${port}`),
);
