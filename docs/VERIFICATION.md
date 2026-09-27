# Verification — 27 September 2026

The current application supports **Solana Devnet only** at http://127.0.0.1:5173, API 3001. There is no runtime selector or clock-control endpoint.

## Confirmed public-chain checks

Program: `4r48EMFeGkNMyrhEvoZgkmQJrdW9VjaatRpH9y677nq1`.

`artifacts/devnet-evidence.json` contains setup signatures, four actions, balances and five transaction signatures per action. The completed test used two holders with 10 and 20 bonds:

1. Coupon 1: first holder receives 500 TEST USD.
2. Partial redemption 20%: first holder receives 2,000 TEST USD; total mint supply drops from 30 to 24.
3. Coupon 2: first holder receives 400 TEST USD on eight remaining bonds.
4. Final redemption: first holder receives 8,000 TEST USD; token supply becomes zero.

Final first-holder balance: **10,900 TEST USD**. Token transfers, Token-2022 burn, receipts and registry state were confirmed in Devnet. The program has not changed since this public-chain run; subsequent changes removed the alternate runtime and switched the default API to Devnet.

The public RPC sometimes returned 429, handled by client retry. Account batching and an eight-second API snapshot cache reduce request load.

## Other validation

- Rust unit tests: five passed, including exact coupon arithmetic, rounding, overflow, zero frequency and duplicate holders.
- TypeScript/Vite production build passed.
- JS integer-codec test passed; npm audit reports zero vulnerabilities.
- Devnet UI loaded at desktop and 390px mobile width with no horizontal overflow or uncaught browser errors.
- The full browser lifecycle and injected-wallet signature/autopilot flow were tested before the runtime simplification. Their scripts now target Devnet real time; the full long browser/security suites have not yet been rerun after that conversion. Do not present those earlier runs as Devnet browser tests.

The fast Devnet UI walkthrough video is distinct from a complete scenario recording. Run `npm run test:e2e` to produce the latter. No live Phantom/Solflare extension was automated; wallet tests use an explicit test-only injected provider and real ed25519 signatures.

No Mainnet mutations, real financial settlement, external publication or hackathon submission were performed. Test tokens are unbacked and all keys stay in ignored local files.

## Workspace release verification

`npm run test:workspace` passed against the public Devnet API. Evidence: `artifacts/workspace-lifecycle-evidence.json`. A separate QA.02 instrument used nominal **123.456789 TEST USD**, annual coupon **7.5%**, frequency **4**, one coupon and 30 bonds across two holders. The API test exercised draft validation/approval/publication, a signed holder transfer, 20% partial redemption (five whole bonds), the automated coupon and final redemption. Final mint supply and registry supply both equal **zero**. Coupon receipts were exactly **18.518518** and **39.351851 TEST USD**. The preceding instrument's holders and journal were unchanged; scoped export included the correct terms history.

Seven fast tests passed: integer codec; exact fractional budgets with per-holder rounding; invalid allocations/duplicate wallets/parameters; admission and revision approval guards; interrupted issuance persistence; async request context isolation; catalog separation and unknown-path rejection. Production TypeScript/Vite build passed.

Browser checks exercised catalog selection, persisted wizard data, custom frequency dropdown, manual admissions, approval/hash display, live calendar, dynamic custom terms, entitlement preview and mobile layouts. No real wallet extension was automated in this release. Program bytecode was unchanged. Issuance reconciliation of an ambiguous completed setup is implemented but was not fault-injected on public-chain funds.
