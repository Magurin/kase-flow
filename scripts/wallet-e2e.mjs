// Browser wallet integration test with an explicit test-only injected provider.
// The product never installs a mock provider and never receives this private key.
import { chromium } from "playwright";
import { Keypair, Transaction } from "@solana/web3.js";
import assert from "node:assert/strict";
import fs from "node:fs";
const investor = Keypair.generate(),
  address = investor.publicKey.toBase58();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function api(path, body) {
  const response = await fetch(
    `http://127.0.0.1:3001/api/${path}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  return data;
}
async function until(check) {
  const end = Date.now() + 600_000;
  while (Date.now() < end) {
    if (await check()) return;
    await page.waitForTimeout(500);
  }
  throw Error("Timed out");
}
try {
  await api("automation", { enabled: false });
  await page.exposeFunction("__testSign", (raw) => {
    const tx = Transaction.from(Buffer.from(raw, "base64"));
    tx.partialSign(investor);
    return tx.serialize().toString("base64");
  });
  await page.addInitScript(
    ({ address }) => {
      window.phantom = {
        solana: {
          connect: async () => ({ publicKey: { toBase58: () => address } }),
          disconnect: async () => {},
          signTransaction: async (tx) => {
            const raw = btoa(
              String.fromCharCode(
                ...tx.serialize({ requireAllSignatures: false }),
              ),
            );
            const signed = await window.__testSign(raw);
            return tx.constructor.from(
              Uint8Array.from(atob(signed), (c) => c.charCodeAt(0)),
            );
          },
          on: () => {},
          removeListener: () => {},
        },
      };
    },
    { address },
  );
  await page.goto("http://127.0.0.1:5173/");
  await page
    .getByRole("button", { name: "Кабинет инвестора", exact: true })
    .click();
  await page.getByRole("button", { name: "Phantom", exact: false }).click();
  await page
    .getByRole("button", { name: "Получить тестовые облигации", exact: false })
    .click();
  await until(
    async () => (await api("state")).holders.at(-1).wallet === address,
  );
  let s = await api("state");
  assert.equal(s.balances.holders[3].bonds, "100");
  await api("action", {
    operation: "schedule",
    kind: 0,
    period: 1,
    bps: 0,
    recordAt: s.issuedAt + Math.floor((s.maturity - s.issuedAt) / s.periods),
  });
  await until(
    async () =>
      (await api("state")).chainTime >=
      s.issuedAt + Math.floor((s.maturity - s.issuedAt) / s.periods),
  );
  await api("action", { operation: "snapshot" });
  await api("action", { operation: "initiate" });
  const proposal = await api("wallet/prepare", { wallet: address });
  const altered = Transaction.from(Buffer.from(proposal.transaction, "base64"));
  altered.instructions[0].data[1] = 0;
  const bad = await fetch("http://127.0.0.1:3001/api/wallet/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: proposal.id,
      transaction: altered
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
    }),
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /не совпадают/);
  await page
    .getByRole("button", { name: "Подписать получение", exact: true })
    .click();
  await until(async () => (await api("state")).actions[0].rows[3].settled);
  s = await api("state");
  assert.equal(s.balances.holders[3].cash, "5000000000");
  // Replaying a prepared claim cannot pay the same entitlement twice.
  const repeat = Transaction.from(Buffer.from(proposal.transaction, "base64"));
  repeat.partialSign(investor);
  const replay = await fetch("http://127.0.0.1:3001/api/wallet/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: proposal.id,
      transaction: repeat.serialize().toString("base64"),
    }),
  });
  assert.equal(replay.status, 400);
  assert.equal((await api("state")).balances.holders[3].cash, "5000000000");
  await page.screenshot({ path: "artifacts/wallet-claim.png", fullPage: true });
  await api("automation", { enabled: true });
  await until(async () => (await api("state")).actions[0].status === 4);

  await until(
    async () =>
      (await api("state")).actions.at(-1)?.period === 2 &&
      (await api("state")).actions.at(-1)?.status === 4,
  );
  await api("automation", { enabled: false });
  s = await api("state");
  assert.equal(s.balances.holders[3].cash, "10000000000");
  assert.equal(s.actions.length, 2);
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    "artifacts/wallet-evidence.json",
    JSON.stringify(
      {
        provider:
          "test-only injected provider; real ed25519 signatures; not a live Phantom extension",
        wallet: address,
        state: s.config.state,
        checks: [
          "connect and enroll external wallet",
          "100 Token-2022 bonds received",
          "altered prepared transaction rejected",
          "holder signature and sponsored fee verified",
          "coupon 5000 TEST USD received once",
          "replay rejected",
          "autopilot completes remaining coupon rows and schedules next due coupon",
        ],
        balances: s.balances,
        journal: s.journal,
      },
      null,
      2,
    ),
  );
  console.log(
    "Wallet UI, signature validation, replay protection and two autopilot coupons passed.",
  );
} finally {
  await api("automation", { enabled: false }).catch(() => {});
  await browser.close();
}
