# KASE Flow — submission draft

**One line:** A Solana platform that services Token-2022 bonds from record-date entitlement calculation to escrow-funded coupon payments and atomic redemption.

**Problem:** Token issuance alone does not provide a repeatable, auditable process for coupons, redemptions and investor rights.

**Prototype:** A Russian-language operator console and investor dashboard backed by a native Rust Solana program. Restricted Token-2022 accounts preserve an authoritative holder registry. The program fixes record-date balances, calculates entitlements and transfers SPL TEST USD from escrow. Redemption burns bonds atomically with payment.

**Required scenarios:**
1. Coupon payment: exact integer calculation, immutable snapshot and actual transfer of test settlement tokens.
2. Maturity redemption: all coupons must complete before principal; transfer and Token-2022 burn commit together.
3. Partial redemption: a configurable portion of each holder's whole bonds is redeemed, reducing future coupon balances.

**Workspace release:** Multiple retained Devnet issues; custom issuance terms and holder allocations; versioned draft and local operator approval; per-issue automation; entitlement/escrow previews; obligation calendar; token reconciliation and terms-aware reports. Approval and admission metadata are local workflow records, not KYC or multisig.

**Implemented:** Real Solana program; Token-2022 issuance; holder-signed transfers; record-date lock; SPL escrow; coupon, partial and final settlement; investor claims with wallet signatures and fee sponsorship; cancellation of an unpaid action; return of the escrow residual to the issuer after full redemption; record dates bounded to 30 days after the obligation; named tokens in wallets (Token-2022 metadata for bonds, Metaplex metadata for TEST USD); demo or real-calendar issue terms with a consistent nominal tenor; optional per-issue scheduler with state-based retries; transaction logs, public Explorer links and JSON audit export. The program's state machine is covered by fast LiteSVM tests against the real token programs.

**Network:** Solana Devnet only, deployed program [4r48EMFeGkNMyrhEvoZgkmQJrdW9VjaatRpH9y677nq1](https://explorer.solana.com/address/4r48EMFeGkNMyrhEvoZgkmQJrdW9VjaatRpH9y677nq1?cluster=devnet).

**Simulated assets / integrations:** STPE.28 and TEST USD are unbacked test instruments. No real money, KASE API, bank, KYC or regulated custody integration. Local demo keys are held by the server; an external connected wallet signs independently. No Mainnet deployment is claimed.

**Architecture:** `docs/TECHNICAL.md`.

**Demo video:** `artifacts/devnet-tour.webm` is a short Devnet interface walkthrough. Record the full scenarios using `npm run test:e2e` before submission.

**Evidence:** `artifacts/devnet-evidence.json` contains confirmed public transactions for every required scenario.

**Source repository:** Local source prepared; add the public repository URL after publishing.

**Before submission:** Team registration in the main Colosseum hackathon, source/video publication, participant details and official submission remain to be completed by the participant.
