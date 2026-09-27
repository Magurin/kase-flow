import { state, tokenBalances, explain, RPC } from "../server/chain.mjs";
import { Connection, PublicKey } from "@solana/web3.js";
import { createReadCache } from "../server/read-cache.mjs";
import { publicIssues } from "./_public-data.mjs";

export const connection = new Connection(RPC, {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
  fetch: (input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
});
const readSnapshot = createReadCache(8000);
const readJournal = createReadCache(30000);

export const getIssue = (id) =>
  publicIssues.find((item) => item.config.state === id) ?? publicIssues[0];

export function selectedIssue(request) {
  const url = new URL(request.url, "https://example.invalid");
  const id =
    request.headers["x-instrument-id"] || url.searchParams.get("issue");
  if (id && typeof id !== "string") throw Error("Выпуск не найден");
  const issue = getIssue(id);
  if (id && issue.config.state !== id) throw Error("Выпуск не найден");
  return issue;
}

export async function publicState(issue) {
  const config = issue.config;
  return readSnapshot(config.state, async () => {
    const [instrument, slot, balances, journal] = await Promise.all([
      state(config, connection),
      connection.getSlot(),
      tokenBalances(config, connection),
      readJournal(config.state, async () => {
        const entries = await connection.getSignaturesForAddress(
          new PublicKey(config.state),
          { limit: 100 },
        );
        const known = new Map(
          issue.journal.map((entry) => [entry.signature, entry]),
        );
        for (const entry of entries) {
          if (entry.err || !entry.blockTime || known.has(entry.signature))
            continue;
          known.set(entry.signature, {
            type: "On-chain transaction",
            label: "Операция в Solana",
            signature: entry.signature,
            time: new Date(entry.blockTime * 1000).toISOString(),
          });
        }
        return {
          entries: [...known.values()].sort(
            (a, b) => Date.parse(b.time) - Date.parse(a.time),
          ),
          stale: false,
        };
      }).catch(() => ({ entries: issue.journal, stale: true })),
    ]);
    const chainTime = await connection.getBlockTime(slot);
    if (chainTime === null) throw Error("Время сети временно недоступно");
    return {
      ...instrument,
      config,
      slot,
      chainTime,
      journal: journal.entries,
      journalStale: journal.stale,
      settlementMode: "spl-test-cash",
      tokenModel: "Token-2022 restricted bonds",
      balances,
      automation: { enabled: false, error: null, lastRun: null },
      publicPreview: true,
      observedAt: new Date().toISOString(),
    };
  });
}

export function fail(response, error, status = 503) {
  response.setHeader("Cache-Control", "no-store");
  const message =
    status === 503
      ? "Solana Devnet временно не отвечает. Повторите запрос через несколько секунд."
      : explain(error);
  response.status(status).json({ error: message });
}

export function readOnly(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.status(403).json({
    error:
      "Публичная версия работает только на чтение. Операции доступны в локальной доверенной среде.",
  });
}
