import { selectedIssue, publicState, fail, readOnly } from "./_shared.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") return readOnly(request, response);
  try {
    const issue = selectedIssue(request);
    const data = await publicState(issue);
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="kase-flow-public-audit.json"',
    );
    response.json({
      exportedAt: new Date().toISOString(),
      runtime: "Solana Devnet; unbacked test tokens, no real money",
      config: issue.config,
      state: data,
      transactions: data.journal,
    });
  } catch (error) {
    fail(response, error, error.message === "Выпуск не найден" ? 404 : 503);
  }
}
