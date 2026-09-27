import assert from "node:assert/strict";
import fs from "node:fs";
const base = "http://127.0.0.1:3001";
async function api(path, body, id) {
  const r = await fetch(base + "/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(id ? { "X-Instrument-ID": id } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await r.json();
  if (!r.ok) throw Error(`${path}: ${value.error}`);
  return value;
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(check, label, limit = 420000) {
  const start = Date.now();
  let reported = 0;
  while (Date.now() - start < limit) {
    const s = await api("state", null, id);
    if (check(s)) return s;
    if (Date.now() - reported > 25000) {
      console.log(
        label,
        `${Math.floor((Date.now() - start) / 1000)}s`,
        s.actions.map((a) => `${a.kind}:${a.status}`).join(","),
      );
      reported = Date.now();
    }
    await pause(3000);
  }
  throw Error("Timed out: " + label);
}
const previous = await api("state");
const terms = {
  issuer: "KASE Flow QA",
  name: "Проверка полного цикла — серия 02",
  symbol: "QA.02",
  face: "123.456789",
  couponBps: 750,
  frequency: 4,
  periods: 1,
  duration: 300,
  supply: 30,
  document:
    "Devnet verification: custom terms, multi-issue isolation, transfer, partial redemption, coupon and final redemption.",
  applications: [
    { name: "QA Investor A", wallet: "", units: 10, admitted: true },
    { name: "QA Investor B", wallet: "", units: 20, admitted: true },
  ],
};
const draft = await api("drafts", { terms });
await api(`drafts/${draft.id}/approve`, { revision: draft.revision });
console.log("Approved draft", draft.id);
const publication = await api(`drafts/${draft.id}/publish`, {
  revision: draft.revision,
});
const id = publication.issueId;
console.log("Published", id);
let s = await api("state", null, id);
assert.equal(s.face, "123456789");
assert.equal(s.frequency, 4);
assert.equal(s.couponBps, 750);
assert.equal(s.config.metadata.symbol, "QA.02");
assert.equal(s.balances.escrow, "3773148112");
const journalBefore = previous.journal.length;
await api("action", { operation: "transfer", from: 0, to: 1, units: 1 }, id);
s = await api("state", null, id);
assert.equal(s.holders[0].units, "9");
assert.equal(s.holders[1].units, "21");
await api(
  "action",
  {
    operation: "schedule",
    kind: 2,
    period: 0,
    bps: 2000,
    recordAt: s.chainTime + 10,
  },
  id,
);
await wait(
  (v) => v.chainTime >= v.actions.at(-1).recordAt,
  "Waiting for partial record date",
);
await api("action", { operation: "snapshot" }, id);
await api("action", { operation: "initiate" }, id);
await api("action", { operation: "confirm", holder: 0 }, id);
await api("action", { operation: "confirm", holder: 1 }, id);
s = await api("state", null, id);
assert.equal(s.supply, "25");
assert.equal(s.balances.supply, "25");
assert.deepEqual(
  s.holders.map((h) => h.units),
  ["8", "17"],
);
console.log("Transfer and partial redemption passed");
await api("automation", { enabled: true }, id);
s = await wait(
  (v) =>
    v.supply === "0" &&
    v.actions.length === 3 &&
    v.actions.every((a) => a.status === 4),
  "Autopilot coupon and final redemption",
);
assert.equal(s.balances.supply, "0");
assert.deepEqual(
  s.actions.map((a) => a.kind),
  [2, 0, 1],
);
assert.equal(s.actions[1].rows[0].amount, "18518518");
assert.equal(s.actions[1].rows[1].amount, "39351851");
assert.equal(s.balances.holders[0].cash, "1129629619");
assert.equal(s.balances.holders[1].cash, "2631944420");
const unchanged = await api("state", null, previous.config.state);
assert.equal(unchanged.config.state, previous.config.state);
assert.equal(unchanged.journal.length, journalBefore);
assert.deepEqual(unchanged.holders, previous.holders);
const report = await api("export?issue=" + id);
assert.equal(report.state.supply, "0");
assert.equal(report.termsRecord.id, draft.id);
await api("automation", { enabled: false }, id);
const evidence = {
  checkedAt: new Date().toISOString(),
  issueId: id,
  draftId: draft.id,
  originalIssue: previous.config.state,
  checks: [
    "custom terms",
    "per-holder integer rounding",
    "scoped transfer keys",
    "partial burn",
    "automatic coupon",
    "automatic final redemption",
    "other issue unchanged",
    "versioned terms export",
  ],
  state: s,
  report,
};
fs.writeFileSync(
  "artifacts/workspace-lifecycle-evidence.json",
  JSON.stringify(evidence, null, 2),
);
console.log("PASS: full workspace lifecycle and isolation. Evidence saved.");
