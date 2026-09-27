// Read-only smoke check; no chain transactions or key material.
import assert from "node:assert/strict";
const base = process.argv[2] || "http://127.0.0.1:5174";
async function get(path, options) {
  const response = await fetch(new URL(path, base), {
    ...options,
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(
    response.status,
    200,
    `${path}: HTTP ${response.status}: ${await response.clone().text()}`,
  );
  return { body: await response.json(), response };
}
const { body: workspace } = await get("/api/workspace");
assert.ok(workspace.issues.length >= 2);
let reference;
for (const issue of workspace.issues) {
  const { body, response } = await get(`/api/state?issue=${issue.id}`);
  assert.equal(body.config.state, issue.id);
  assert.equal(body.config.network, "devnet");
  assert.ok(body.slot > 0 && body.chainTime > 0);
  assert.equal(body.supply, body.balances.supply);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(
    issue.statsStale,
    false,
    "Catalog should read current Devnet values",
  );
  assert.equal(issue.stats.supply, body.supply);
  reference ??= body;
  const legacy = await get("/api/state", {
    headers: { "X-Instrument-ID": issue.id },
  });
  assert.equal(
    legacy.body.config.state,
    issue.id,
    "Header-scoped responses must not be mixed by CDN",
  );
}
const { body: audit } = await get(
  `/api/export?issue=${reference.config.state}`,
);
assert.equal(audit.config.state, reference.config.state);
assert.ok(audit.transactions.length);
const { body: tx } = await get(
  `/api/transaction/${reference.journal[0].signature}`,
);
assert.ok(tx.slot > 0);
assert.equal(tx.meta.err, null);
const missing = await fetch(new URL("/api/state?issue=missing", base));
assert.equal(missing.status, 404);
assert.equal(typeof (await missing.json()).error, "string");
const denied = await fetch(new URL("/api/action", base), { method: "POST" });
assert.equal(denied.status, 403);
console.log(
  `Hosted checks passed: ${workspace.issues.length} issues, header/query isolation, live catalog, balances, audit, transaction, 404, denied writes. ${base}`,
);
