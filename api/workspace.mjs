import { publicIssues } from "./_public-data.mjs";
import { readOnly, publicState } from "./_shared.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") return readOnly(request, response);
  response.setHeader("Cache-Control", "private, no-store");
  const readings = await Promise.allSettled(publicIssues.map(publicState));
  response.json({
    issues: publicIssues.map(({ config, stats }, index) => {
      const reading = readings[index];
      const s = reading.status === "fulfilled" ? reading.value : null;
      return {
        id: config.state,
        name: config.metadata?.name,
        issuer: config.metadata?.issuer,
        symbol: config.metadata?.symbol,
        createdAt: config.createdAt,
        status: "active",
        stats: s
          ? {
              supply: s.supply,
              paid: String(
                s.actions
                  .flatMap((a) => a.rows)
                  .filter((r) => r.settled)
                  .reduce((n, r) => n + BigInt(r.amount), 0n),
              ),
              escrow: s.balances?.escrow ?? "0",
              maturity: s.maturity,
              updatedAt: s.observedAt,
            }
          : stats,
        statsStale: !s,
      };
    }),
    drafts: [],
    pending: false,
    publicPreview: true,
  });
}
