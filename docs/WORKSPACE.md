# Workspace release — operational model

## Scope

The release adds multiple retained Devnet instruments, a versioned issuance wizard, operator admission flags, preview/approval, actual Token-2022 allocation, an obligation calendar, per-issue automation, entitlement previews and reconciliation/export. It uses the already deployed native Solana program; no program upgrade is needed for custom terms or multiple state accounts.

Issuer names represent metadata under one trusted test operator. They do not create separately authenticated tenants or independent signing authorities. Admission is a manual local workflow, not KYC. The application allocates bonds at issuance; it does not collect subscription money or implement an order book. No Mainnet support or local SVM was added.

## Persistence and routing

- `workspace.json`: issue catalog and versioned drafts. Validated terms include a full allocation, unique external holder addresses, integer units, exact six-decimal nominal values and bounded coupon parameters.
- `issues/<state>/`: immutable issued configuration, per-issue journal, automation state and matching generated holder keys. Legacy `config.json` is a default profile for CLI compatibility, not a global browser selection.
- `provisioning/<draft-id>/`: saved issuance state key and generated holder keys. Public checkpoint addresses and setup signatures are attached to the draft. Secret keys never appear in API responses or exports.
- UI state and mutations carry `X-Instrument-ID`. Download links use `?issue=<state>`. The server rejects unknown identifiers and uses AsyncLocalStorage to bind config, journal and automation to the request. The scheduler enters the same explicit context for each issue.
- State reads are coalesced and cached separately for each issue. Catalog figures are observations from the last state read, not a continuously indexed portfolio feed.
- JSON writes use a sibling temporary file and rename. This is a single-process local store; it is not a distributed database or queue.

## Approval and issuance

Draft saves require the current revision. Editing invalidates approval. Approval requires each investor's admission and records a canonical terms hash, revision and timestamp. Publication checks the same hash and revision and changes state to `publishing` before transactions. Repeated publication of the same draft is rejected.

The Solana initialization instruction receives the actual nominal, coupon basis points, frequency, number of periods, duration and holder allocations. Funding uses integer math with each holder's coupon rounded down separately, matching the program. Test wallets are generated only for blank addresses; externally supplied wallets never have server-side private keys.

An issuance may require several transactions. A process interruption or uncertain result is surfaced as `needs_review`, with its checkpoint preserved; a second issue is not silently created. A failure before a checkpoint can safely remain approved. The reconciliation endpoint sends no transactions: it reads the saved state and token accounts and recovers the catalog only when token attachment and parameters match. Incomplete account/mint preparation still requires technical recovery; automatic resumption of every setup stage is outside this release.

The UI labels the approval/hash as local/off-chain. These metadata are not anchored in the deployed program and are not a second signer's approval. Issued economic terms, holder registry, entitlements, burns and settlement receipts are on-chain.

## Automation and closeout

The scheduler visits catalog issues round-robin and performs one step under a global write lock. Enabled/error/last-run state persists independently per instrument; reopening the UI does not select which issue runs. It resumes from program state and cannot repay a settled entitlement. Disabled state is preserved if the operator turns automation off while a step is confirming.

The calendar forecasts unpaid coupons and principal using current units, accounting for rows already paid in an active coupon. Forecasts exclude future transfers or redemptions. Reconciliation compares registry totals, mint supply and every holder's token balance. Reads are confirmed but not an atomic multi-RPC snapshot; a transient difference requires another read.

Final closure requires zero outstanding bonds, all coupons paid and completed actions. Excess escrow remains locked because the deployed contract has no withdrawal instruction; the UI displays that residual explicitly. Export includes configuration, state, balances, receipts and the approved draft history.

## Boundaries for the next release

16 holders / 16 actions per instrument remain on-chain limits. Separate scalable entitlement PDAs, production authentication and roles, multiple signers, KMS custody, a durable distributed job queue, bank/KASE/KYC connectors, subscription payment collection and term modification voting remain separate work. This release does not claim those features.
