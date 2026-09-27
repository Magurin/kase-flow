import { readJson } from "./http";
/** Mutations are never retried automatically: their chain outcome may be ambiguous. */
export async function post(path: string, body: object = {}, issueId?: string) {
  const r = await fetch(`/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(issueId ? { "X-Instrument-ID": issueId } : {}),
    },
    body: JSON.stringify(body),
  });
  return readJson(r);
}
export const explorer = (kind: "tx" | "address", id: string) =>
  `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
