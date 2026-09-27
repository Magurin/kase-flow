import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import {
  WorkspaceStore,
  normalizeDraft,
  draftBudget,
  micro,
} from "../server/workspace.mjs";
import { issueContext } from "../server/context.mjs";
import { readConfig } from "../server/chain.mjs";
const terms = () => ({
  issuer: "Test issuer",
  name: "Series 01",
  symbol: "TEST.01",
  face: "123.456789",
  couponBps: 750,
  frequency: 4,
  periods: 2,
  duration: 600,
  supply: 30,
  applications: [
    { name: "One", wallet: "", units: 10, admitted: true },
    { name: "Two", wallet: "", units: 20, admitted: true },
  ],
  document: "Terms v1",
});
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kase-workspace-test-"));
  t.after(() => {
    assert.ok(
      path
        .resolve(dir)
        .startsWith(path.join(os.tmpdir(), "kase-workspace-test-")),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return new WorkspaceStore(dir);
}
test("micro amounts are exact, coupon budget rounds per holder", () => {
  assert.equal(micro("123.456789"), 123456789n);
  assert.throws(() => micro("1e3"));
  assert.throws(() => micro("0"));
  const d = normalizeDraft(terms());
  const b = draftBudget(d);
  assert.equal(b.coupon, "69444442");
  assert.equal(b.principal, "3703703670");
  assert.equal(b.total, "3842592554");
});
test("allocation, duplicate wallet and unsupported parameters rejected", () => {
  const d = terms();
  assert.throws(() => normalizeDraft({ ...d, supply: 31 }));
  assert.throws(() => normalizeDraft({ ...d, frequency: 0 }));
  assert.throws(() => normalizeDraft({ ...d, periods: 13 }));
  const wallet = Keypair.generate().publicKey.toBase58();
  assert.throws(() =>
    normalizeDraft({
      ...d,
      applications: d.applications.map((a) => ({ ...a, wallet })),
    }),
  );
});
test("approval requires admission and editing invalidates approval; stale revisions rejected", (t) => {
  const store = setup(t);
  const d = store.saveDraft({
    ...terms(),
    applications: terms().applications.map((a) => ({ ...a, admitted: false })),
  });
  assert.throws(() => store.approve(d.id, 1));
  store.saveDraft(terms(), d.id, 1);
  store.approve(d.id, 2);
  assert.equal(d.status, "approved");
  assert.throws(() => store.saveDraft(terms(), d.id, 1));
  store.saveDraft({ ...terms(), name: "Revised" }, d.id, 2);
  assert.equal(d.status, "draft");
  assert.equal(d.approval, null);
  assert.throws(() => store.beginPublish(d.id, 3));
  store.approve(d.id, 3);
  store.beginPublish(d.id, 3);
  assert.throws(() => store.beginPublish(d.id, 3));
  assert.throws(() => store.saveDraft(terms(), d.id, 3));
});
test("interrupted issuance is durable and never automatically repeated", (t) => {
  const store = setup(t);
  const d = store.saveDraft(terms());
  store.approve(d.id, 1);
  store.beginPublish(d.id, 1);
  const restored = new WorkspaceStore(store.root);
  assert.equal(restored.getDraft(d.id).status, "needs_review");
  assert.throws(() => restored.beginPublish(d.id, 1));
});
test("instrument context stays isolated across interleaved async requests", async () => {
  const results = await Promise.all(
    ["issue-a", "issue-b"].map((id, i) =>
      issueContext.run({ config: { state: id } }, async () => {
        await new Promise((r) => setTimeout(r, i ? 1 : 10));
        return readConfig().state;
      }),
    ),
  );
  assert.deepEqual(results, ["issue-a", "issue-b"]);
});
test("catalog preserves each instrument and rejects arbitrary paths", (t) => {
  const store = setup(t);
  for (const id of ["a", "b"])
    store.register(
      { state: id, createdAt: "2026-01-01", wallets: [] },
      { name: id, issuer: "Test", symbol: id },
    );
  assert.equal(store.context("a").config.metadata.name, "a");
  assert.equal(store.context("b").config.metadata.name, "b");
  assert.throws(() => store.context("../issuer.json"));
  assert.throws(() => store.register({ state: "a" }, {}));
});
