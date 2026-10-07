# CampusRadar product design

## Audit and direction (2026-10-07, before implementation)

The App Router homepage is a dynamic server component. It reads public occurrences, groups provenance, then reads per-user states with the session client. Career/All views cap at 30; For You ranks the full pool and excludes Not Interested. GET filters are title search and rolling 7/30-day windows. State controls use server actions, explicit toggle requests, refresh, and error feedback. Calendar links preserve UTC instants and use a one-hour fallback for unknown end times. Auth supports signup, confirmation, login and recovery callbacks; recovery initiation is currently external. Account currently exposes debugging IDs and cookie explanations. All screens use an undifferentiated zinc card style; no route loading/error UI exists.

The digest selects at most eight unseen upcoming occurrences per interested user. It currently sends text through Resend, then records occurrence deliveries. This work preserves that behavior and its existing failure/concurrency limits. HTML is an additive email payload; no collector, classification, reconciliation, schema, ranking, or lease changes are needed.

Direction: a campus field guide. Warm paper, near-black ink, Illinois orange, small uppercase section labels, bold editorial headlines, date markers, thin dividers, and compact readable event modules. Source links become a trust-oriented disclosure. A supporting desktop rail explains personalization and aggregation; mobile prioritizes the feed. Forms and all auth states share the same shell.

## System

- Typography: existing self-hosted Geist, 14–16px body, 20–24px event titles, responsive 36–64px editorial heading; 12px uppercase metadata. No new font downloads beyond existing Next font setup.
- Spacing: 4/8/12/16/24/32/48/64px. Maximum page width 1120px; reading feed and narrow account forms.
- Colors: paper #f6f5f0, surface #fffefa, ink #202b29, muted #626b66, accent #b83c16, pale orange #fff0e6, green #245c48. Meaning always includes text.
- Borders: 1px warm gray; 6–12px corners; shadows reserved for hover emphasis. No decorative gradients.
- Controls: filled ink primary, outlined secondary, underlined/text tertiary. Minimum 44px touch height, visible 3px orange focus ring, explicit pressed/disabled/pending/error states.
- Icons: small inline geometric brand mark and text-labelled directional glyphs; no icon dependency.
- Motion: 150ms color/border transitions and quiet loading pulse; reduced-motion disables animation.
- Email: 600px fluid presentation tables, inline styles, system fonts, text fallback, escaped content and HTTP(S)-only links. No external images required.

## Scope decisions

Keep the existing search windows and ranking semantics. Do not call rolling seven days “This Week” or imply that the 30-result public feed is a complete saved collection. No new category inference or personalized claims for anonymous visitors. Preserve external recovery initiation rather than adding an unreviewed email-send endpoint. No production emails or data writes for QA.

## Finished interface

The public feed, auth shell, account surfaces, loading and error states, and the HTML digest share one editorial system: paper, ink, Illinois orange, date markers, and short uppercase labels. Discovery still means Career & Industry, All events, and For You. There is no Saved tab.

Event titles are `h3` under the feed heading. The date marker carries the day; the line under the title shows the time range, and the full start and end stay in the accessible name. Descriptions preview two lines, then open from an “About this event” control whose name is not the whole description. Source disclosures use the native marker. External links, including Google Calendar, keep the arrow on the link itself.

Signed-in plans stay Interested, Going, and Not Interested. A successful save says “Your plan is saved.” Empty feeds do not also print a zero-result counter. Account, interests, login, signup, and recovery use the same fields, notices, and ink buttons as the rest of the product.

The header stays on one line down to a 320px width. Below 760px the sidebar hides and auth drops the story column. At 768px the feed still keeps a narrow rail, with no horizontal overflow checked at 320, 390, 768, 1024, and 1280.

The digest is a 600px fluid table with inline styles, bgcolor fallbacks, a light color scheme, a hidden preheader, and a plain-text alternative. Each item has a date marker, every safe http(s) source and registration link, and the existing interests control. Unsafe URLs are omitted. Send tracking and idempotency are unchanged.
