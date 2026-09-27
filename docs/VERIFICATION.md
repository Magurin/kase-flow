# Verification — 27 September 2026

The current application supports **Solana Devnet only** at http://127.0.0.1:5173, API 3001. There is no runtime selector or clock-control endpoint.

## Confirmed public-chain checks

Program: `4r48EMFeGkNMyrhEvoZgkmQJrdW9VjaatRpH9y677nq1`.

The program was upgraded in place on 27 September 2026 (slot 504591436): `Cancel`, `Withdraw`, record-date bounds, the whole-bond check for partial redemption and a metadata-aware mint whitelist. The state layout did not change; instruments issued earlier still decode and operate.

`artifacts/devnet-evidence.json` is from `npm run test:chain` against the upgraded program. Two holders with 10 and 20 bonds:

0. Token metadata: bond mint reads back as "Steppe Energy 2028" / STPE.28 from Token-2022; the TEST USD Metaplex metadata account exists.
1. Cancellation: coupon 1 scheduled and cancelled; the instrument returns to zero actions.
2. Coupon 1: first holder receives 500 TEST USD.
3. Partial redemption 20%: first holder receives 2,000 TEST USD; total mint supply drops from 30 to 24.
4. Coupon 2: first holder receives 400 TEST USD on eight remaining bonds.
5. Final redemption: first holder receives 8,000 TEST USD; token supply becomes zero.
6. Escrow release: exactly 300.000004 TEST USD remained (coupon 2 on the six redeemed bonds plus the 4 micro-unit rounding reserve) and moved to the issuer; the vault is empty.

Final first-holder balance: **10,900 TEST USD**. Token transfers, Token-2022 burn, receipts and registry state were confirmed in Devnet.

The public RPC returned 429 during this run and aborted it once after coupon 2's wait; `npm run test:chain -- --resume` continued from on-chain status without repeating a step. The RPC client now backs off up to ~16 s per request (honouring Retry-After) before failing.

A demo issue created through the upgraded API was also scheduled and cancelled from the browser UI; program errors surface in Russian (for example, scheduling a second action returns "Сначала завершите или отмените текущее действие").

## Program tests (LiteSVM)

`npm run test:program`: 5 unit tests and 7 LiteSVM integration tests passed in under a second, running the compiled SBF program with the real SPL Token and Token-2022 programs: full lifecycle with a transfer, record-date lock, holder self-claim and cross-holder rejection, partial redemption burn, final redemption, residual release (issuer only); record dates bounded to 30 days; cancel before payment and refusal after; partial redemption that retires no whole bond rejected; frozen-account bypass rejected; metadata extensions accepted; other mint extensions rejected.

## Other validation

- Rust unit tests: five passed, including exact coupon arithmetic, rounding, overflow, zero frequency and duplicate holders.
- TypeScript/Vite production build passed.
- Nine node tests passed, including the rounding reserve and demo/calendar terms; npm audit reports zero vulnerabilities.
- API probes: a foreign Host header and a foreign Origin are rejected with 403; unknown `/api/*` routes return JSON 404.
- Devnet UI loaded at desktop and 390px mobile width with no horizontal overflow or uncaught browser errors.
- The full browser lifecycle and injected-wallet signature/autopilot flow were tested before the runtime simplification. Their scripts now target Devnet real time; the full long browser/security suites have not yet been rerun after that conversion. Do not present those earlier runs as Devnet browser tests.

The fast Devnet UI walkthrough video is distinct from a complete scenario recording. Run `npm run test:e2e` to produce the latter. No live Phantom/Solflare extension was automated; wallet tests use an explicit test-only injected provider and real ed25519 signatures.

No Mainnet mutations, real financial settlement, external publication or hackathon submission were performed. Test tokens are unbacked and all keys stay in ignored local files.

## Workspace release verification

`npm run test:workspace` passed against the public Devnet API. Evidence: `artifacts/workspace-lifecycle-evidence.json`. A separate QA.02 instrument used nominal **123.456789 TEST USD**, annual coupon **7.5%**, frequency **4**, one coupon and 30 bonds across two holders. The API test exercised draft validation/approval/publication, a signed holder transfer, 20% partial redemption (five whole bonds), the automated coupon and final redemption. Final mint supply and registry supply both equal **zero**. Coupon receipts were exactly **18.518518** and **39.351851 TEST USD**. The preceding instrument's holders and journal were unchanged; scoped export included the correct terms history.

Seven fast tests passed: integer codec; exact fractional budgets with per-holder rounding; invalid allocations/duplicate wallets/parameters; admission and revision approval guards; interrupted issuance persistence; async request context isolation; catalog separation and unknown-path rejection. Production TypeScript/Vite build passed.

Browser checks exercised catalog selection, persisted wizard data, custom frequency dropdown, manual admissions, approval/hash display, live calendar, dynamic custom terms, entitlement preview and mobile layouts. No real wallet extension was automated in this release. Program bytecode was unchanged. Issuance reconciliation of an ambiguous completed setup is implemented but was not fault-injected on public-chain funds.
