// Read-only connectivity check. Credentials never leave the server-side profile.
import fs from "node:fs";
import WebSocket from "ws";
const file = new URL("../.local/rpc-supanode.json", import.meta.url);
const config = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
if (
  new URL(config.httpUrl).protocol !== "https:" ||
  new URL(config.wsUrl).protocol !== "wss:"
) {
  throw new Error("Authenticated remote probes require TLS");
}
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${config.token}`,
};
let id = 0;
async function rpc(
  method,
  params = [],
  url = config.httpUrl,
  authenticated = true,
) {
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: authenticated ? headers : { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return { ok: false, httpStatus: response.status };
    const body = await response.json();
    if (body.error)
      return {
        ok: false,
        code: body.error.code,
        message: String(body.error.message).replaceAll(
          config.token,
          "[redacted]",
        ),
      };
    return { ok: true, result: body.result };
  } catch (e) {
    return {
      ok: false,
      error: e.name,
      cause: e.cause?.code ?? "request failed",
    };
  }
}
const checks = await Promise.all(
  ["getHealth", "getVersion", "getGenesisHash", "getSlot"].map(
    async (method) => [method, await rpc(method)],
  ),
);
const report = {
  checkedAt: new Date().toISOString(),
  endpoint: config.httpUrl,
  checks: Object.fromEntries(checks),
};
const genesis = report.checks.getGenesisHash.result;
if (genesis) {
  const clusters = await Promise.all(
    [
      ["mainnet-beta", "https://api.mainnet-beta.solana.com"],
      ["devnet", "https://api.devnet.solana.com"],
      ["testnet", "https://api.testnet.solana.com"],
    ].map(async ([name, url]) => [
      name,
      await rpc("getGenesisHash", [], url, false),
    ]),
  );
  report.cluster =
    clusters.find(([, r]) => r.ok && r.result === genesis)?.[0] ??
    "unknown/custom";
  report.clusterReferences = Object.fromEntries(clusters);
  const localFile = new URL("../.local/config.json", import.meta.url);
  if (fs.existsSync(localFile)) {
    const local = JSON.parse(fs.readFileSync(localFile, "utf8"));
    const info = await rpc("getAccountInfo", [
      local.programId,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    report.demoProgram = {
      address: local.programId,
      exists: info.ok ? info.result.value !== null : null,
      executable: info.ok ? (info.result.value?.executable ?? false) : null,
    };
  }
}
report.websocket = await new Promise((resolve) => {
  let finished = false;
  const socket = new WebSocket(config.wsUrl, {
    headers: { Authorization: `Bearer ${config.token}` },
    handshakeTimeout: 12000,
    followRedirects: false,
  });
  const finish = (result) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    socket.terminate();
    resolve(result);
  };
  const timer = setTimeout(
    () => finish({ ok: false, error: "timeout" }),
    15000,
  );
  socket.on("open", () =>
    socket.send(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "slotSubscribe" }),
    ),
  );
  socket.on("message", (raw) => {
    try {
      const body = JSON.parse(raw.toString());
      if (body.error) finish({ ok: false, code: body.error.code });
      else if (body.method === "slotNotification")
        finish({ ok: true, slot: body.params.result.slot });
    } catch {
      finish({ ok: false, error: "invalid response" });
    }
  });
  socket.on("error", (e) =>
    finish({ ok: false, error: e.code ?? "websocket connection failed" }),
  );
});
fs.mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
fs.writeFileSync(
  new URL("../artifacts/rpc-check.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
