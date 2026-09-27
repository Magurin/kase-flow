import { connection, fail } from "../_shared.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET")
    return response
      .status(403)
      .json({ error: "Публичная версия работает только на чтение" });
  try {
    const signature = request.query.signature;
    if (
      typeof signature !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(signature)
    )
      return response
        .status(400)
        .json({ error: "Некорректная подпись транзакции" });
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx)
      return response.status(404).json({ error: "Транзакция не найдена" });
    response.json(tx);
  } catch (error) {
    fail(response, error);
  }
}
