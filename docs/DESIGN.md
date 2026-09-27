# KASE-inspired interface

Reference: https://kase.kz/kz, inspected on 27 September 2026.

The interface follows the exchange's white masthead, horizontal navigation, green active underline, graphite text, thin dividers and restrained corners. It retains the KASE Flow prototype identity and explicit Solana Devnet / TEST USD disclosures.

`src/kase-theme.css` defines the visual tokens and responsive theme over the layout primitives in `src/style.css`. The primary green is `#028A29`, text is `#1E212B`, secondary surface is `#F1F3F4`. System Segoe UI / Arial fonts avoid requiring the reference site's proprietary Museo Sans Cyrl font or a remote font request.

All six dropdown fields use `src/CustomSelect.tsx`, backed by Radix Select: action type, coupon period, redemption percentage, sender, recipient and test investor. New dropdowns should use this component. It provides keyboard navigation, typeahead, disabled options, focus restoration, a selected checkmark, collision-aware placement and a portal above dialogs. Browser tests must select `combobox` / `option` roles instead of calling native `selectOption`.

Validation: TypeScript/Vite production build passed. Browser checks covered the investor selection with arrows and Enter, Escape/focus restoration, action type and percentage selection, paid coupon periods disabled and skipped by Home, and menus inside dialogs. Responsive checks passed at 390px and 320px without page-wide horizontal overflow. Tables and navigation scroll within their own containers. Transfer dropdowns use the same component; their live form could not be exercised because the current issue had matured. No transaction was submitted for this design verification.

Existing videos/screenshots in `artifacts/` predate this redesign; regenerate them before using them to present the current interface.
