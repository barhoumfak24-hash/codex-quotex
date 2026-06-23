# Accessibility Compliance Baseline

Quotex targets WCAG 2.2 AA behavior as the product baseline. ADA compliance still requires human review against real production content, but the application now includes shared accessibility controls that every screen inherits.

## Built into the app shell

- Skip links move keyboard users directly to the active page content.
- The main employee and mobile app regions expose stable landmarks.
- Primary navigation surfaces have descriptive `aria-label` values.
- Loading states announce progress through `role="status"`.
- Contained render failures announce through `role="alert"`.

## Built into shared UI primitives

- The shared Button component supports accessible labels for icon-only actions.
- Disabled link-styled buttons are removed from keyboard tab order.
- External links opened in a new tab are protected with `noopener noreferrer`.
- The shared Modal component uses dialog semantics, traps focus while open, supports Escape close, and restores focus after close.

## Built into global styles

- Keyboard focus is visibly marked across the interface.
- Reduced-motion users receive near-instant transitions and no repeated animations.
- Forced-colors/high-contrast environments keep native color adjustment enabled.
- Links use a clearer underline offset where underlined.

## Required before production sign-off

- Run keyboard-only walkthroughs for login, client profile, quote flow, messages, documents, marketing, tasks, calendar, settings, and agency/mobile demo surfaces.
- Run screen-reader checks on the same flows with at least one desktop screen reader.
- Run automated accessibility checks in the browser against the highest-traffic pages.
- Verify every image used in real agency/customer-facing content has appropriate alternative text or is marked decorative.
- Verify color contrast for agency-customized branding before enabling custom themes.
- Verify dynamic quote, PDF, and message previews announce meaningful state changes.

## Merge rule

Accessibility regressions should block deployment the same way failing tests do. Any new reusable component must define keyboard behavior, focus behavior, screen-reader labeling, and disabled/loading semantics before it is merged.
