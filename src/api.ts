/** POST to the loopback API, scoped to one instrument when given. */
export async function post(path: string, body: object = {}, issueId?: string) {
  const r = await fetch(`/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(issueId ? { "X-Instrument-ID": issueId } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "Запрос не выполнен");
  return result;
}
export const explorer = (kind: "tx" | "address", id: string) =>
  `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
