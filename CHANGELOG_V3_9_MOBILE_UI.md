# V3.9 — Mobile-first navigation and button polish

Everything that used to be a wall of tabs on a phone now lives behind one
hamburger button. Nothing was removed from the desktop layout.

## Navigation

**Site header (`App.tsx`)**
- Below 900px the inline nav and the "name · role / Sign out" cluster are replaced by a
  single 44px hamburger.
- Tapping it slides a drawer in from the right with: account card (initial, name, email,
  role), Dashboard, Sign in / Create account, Services, Safety & privacy, Apply for a
  doctor account, and Sign out.
- Closes on backdrop tap, on ✕, and on Escape; the page behind is scroll-locked; the
  drawer respects the safe area on notched phones.

**Dashboard tabs (`common.tsx` → `Tabs`)**
- Patient (11), Doctor (14), Admin (28) and Commercial (10) panels all share this one
  component, so a single change fixes every panel.
- Desktop: the familiar grid of tabs.
- Phone: one compact bar showing "Menu" plus the current section (with its live badge
  count). Tapping opens a bottom sheet listing every tab as a 52px row with icon, label
  and badge.
- More than seven tabs → a search box appears, so a 28-tab admin panel is two taps, not a
  scan of 14 rows.
- Commercial panel now uses the same component instead of its own scrolling strip, and its
  palette was moved onto the design tokens (`#0b5ed6` brand, `#0f172a` ink).

## Buttons

- One scale: 44px primary/secondary, 40px default, 36px compact (`button.small`).
- Radius 12px, 14px/600 labels, 1px press feedback.
- `button.link` finally has a real tap target (36px) instead of `padding:0`.
- `.small` variant added for dense rows.

## Typography and spacing on phones

- Inputs, textareas and selects render at 16px on small screens, which stops mobile
  browsers from zooming the whole page on focus.
- Labels 12.5px, header 56px tall, content padding 14px, cards 14px radius.
- Extra breakpoint at 400px for small phones (360–390px wide).
- Tables now scroll inside `.tablewrap` instead of stretching the page.
- Safe-area padding on the header, drawer, sheet and shell footer.

## Verification

- `tsc --noEmit` clean, production build succeeds.
- Component tests (jsdom + react-dom): sheet opens, lists all 14 tabs, search filters to a
  single result, selecting a row switches tab and closes the sheet, Escape closes it, and
  body scroll is locked then restored.
- Desktop markup unchanged: the grid still renders with `role="tablist"` and
  `aria-selected`.
