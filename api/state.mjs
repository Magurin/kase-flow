import { selectedIssue, publicState, fail, readOnly } from "./_shared.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") return readOnly(request, response);
  try {
    const issue = selectedIssue(request);
    // Header-scoped legacy clients must never share a CDN response for another issue.
    response.setHeader("Cache-Control", "private, no-store");
    response.json(await publicState(issue));
  } catch (error) {
    fail(response, error, error.message === "Выпуск не найден" ? 404 : 503);
  }
}
