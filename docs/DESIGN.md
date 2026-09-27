# Interface design

KASE Flow is an operator console for the KASE ecosystem, so it follows the exchange's own visual language rather than a marketing landing page. Reference: https://kase.kz/ru/, inspected on 27 September 2026 (computed styles of the live page).

## Brand values taken from kase.kz

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#1E212B` | Text, headings |
| Secondary | `#45464F` | Secondary text, icons |
| KASE green | `#028A29` | The only accent: primary actions, active navigation, positive values |
| Surface | `#F1F3F4` | Page background, table headers |
| Falling red | `#C00008` | Shortfalls, errors, destructive actions |

kase.kz sets text in Museo Sans Cyrl (weight 300-400), which is proprietary. The app bundles **Golos Text** (`@fontsource-variable/golos-text`, served locally, no external font requests): a Cyrillic-first grotesque with a similar open, friendly character. All figures use tabular numerals.

## Structure

- **Top bar**: product mark, network indicator (Solana Devnet, slot), a permanent "Тестовая среда" badge, "О прототипе", investor cabinet.
- **Market data strip**: modelled on the index ticker under the kase.kz header. Shows the current issue's ticker, face value, coupon, bonds outstanding, escrow, the next event with a countdown (red when the operator must act) and chain time.
- **Sidebar**: current issue card, issue sections (overview, corporate actions, calendar and control, holder registry, journal) and participant sections (issuer catalog, investor cabinet). Collapses into a horizontal tab row under 960 px.
- **Pages** share one pattern: breadcrumb with the ticker, title, one-line purpose, primary action on the right; then a KPI row and panels.

## Conventions

- Numbers follow the exchange's ru-RU format: `1 200 000,00`, units in a smaller muted suffix (`TEST USD`, `обл.`). Money is right-aligned in tables. Dates are `27.09.2026, 05:40:47` in chain time.
- Data lives in tables with light grey headers, not cards. Clicking a row opens details (actions, journal transactions, catalog issues).
- Status badges: green = done or in circulation, amber = waiting for a date, blue = in progress, red = needs attention.
- Corporate actions use a four-step stepper (record date, snapshot, initiation, payments) with the next command next to the status line. Cancellation needs an inline confirmation.
- Dialogs have a header, scrollable body and a footer with the primary action on the right. Escape closes them unless a transaction is confirming.
- Dropdowns use `src/CustomSelect.tsx` (Radix Select). Browser tests select `combobox` / `option` roles.

## Code layout

- `src/app.css`: the whole design system (tokens, frame, panels, tables, badges, buttons, forms, dialogs, responsive rules).
- `src/format.ts`: number, date and countdown formatting.
- `src/domain.ts`: state types and pure helpers mirroring the program rules (entitlements, due dates, next event).
- `src/pages/*`: one component per screen; `src/dialogs.tsx`: action, transfer, about and transaction dialogs; `src/main.tsx`: the shell.
- `node scripts/screens.mjs <dir> [issue] [width]` captures every screen and dialog for review.

Screenshots and videos in `artifacts/` recorded before this redesign show the previous interface.
