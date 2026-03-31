# ARTIZANS.COLLECTIVE — Full Site Review

**Date:** 2026-03-30
**Perspective:** First-time user, returning user, artist, client, admin, mobile user, accessibility evaluator

---

## EXECUTIVE SUMMARY

Artizans Collective is a well-positioned verified human-artist marketplace with a clear mission ("No AI. No middlemen."), solid dark mode theming, and a functional booking/messaging system. The core flows (discover, book, message, manage) all work. The visual design is premium — warm palette, custom easing curves, Inter Tight typography, and a cohesive component system.

**Strongest areas:** Value proposition clarity, dark mode implementation, booking form UX, moderation system architecture, admin tooling

**Weakest areas:** Empty platform bootstrapping, mobile touch targets, contact form (mailto facade), verified-but-undefined trust claim, messaging thread discovery

---

## 1. HOMEPAGE & EXPLORE

### What Works Well
- "Hire human artists. Not AI." — four words, immediately clear
- Category chips on explore provide instant one-click filtering
- URL state synced on filter changes (bookmarkable, shareable)
- Smart empty states with suggested categories
- Hero CTA adapts for signed-in artists ("Go to workspace" / "Finish your profile")
- Save artist button works well with auth redirect for signed-out users
- Discovery insight stats (live profiles, categories, starting price) build trust

### Issues Found
- **"Verified" is never defined.** The word appears everywhere but what verification means (ID check? portfolio review?) is never explained
- **Explore hero copy is over-written.** "proof-led portfolio previews" is jargon no user understands
- **Sort options that don't work are still visible.** "Most popular" and "Highest rated" revert with a toast — should be hidden when no data exists
- **No individual filter chip removal.** Active filters show as chips but can't be removed one at a time — only full reset
- **Artist card bio is computed but never rendered.** `profileCopy` is built in renderers.js but never inserted into the card HTML
- **Search doesn't include bio or location.** Searching "Melbourne" returns nothing unless it's in the artist name/category/mediums
- **No debounce on search input.** Every keystroke triggers a full DOM rebuild
- **Marquee hidden when fewer than 3 artists.** Early-stage platform shows no marquee

---

## 2. ARTIST PROFILE PAGE

### What Works Well
- "Start booking" auto-scrolls to form and prefills category + starting price
- "Prefill example" button helps first-time clients
- Unauthenticated visitors get sign-in redirect with return URL
- Booking form disables during submission and replaces with confirmation
- Availability sidebar gives three clear signals before scrolling
- Tips panel next to booking form is practical
- Profile owner sees "Edit your profile" instead of booking form

### Issues Found
- **"Contact artist" vs "Start booking" distinction is unclear.** First-time users won't know which to use
- **No character counter on textareas.** 2,000-char limit exists but no live counter shown
- **After sending a contact message, no link to the conversation thread.** User gets a toast and that's it
- **"Saved" button has no visual differentiation** — no filled icon or color change, just text swap
- **No individual reviews visible.** Star rating shows but no review text anywhere
- **No turnaround time, service list, or social links** on profiles
- **Related profiles section limited to 3** with no pagination

---

## 3. SIGNUP & ONBOARDING

### What Works Well
- Live password match indicator on signup
- Email auto-filled into verification and login steps
- Progress bar and step counter ("Step 2 of 4")
- "You can change all of this later" messaging reduces pressure
- Back buttons work and progress persists server-side
- Browser notification permission only prompts on explicit opt-in
- Session stored in sessionStorage (more secure than localStorage)

### Issues Found
- **No auto-login after email verification.** User must log in again manually after verifying — unnecessary friction
- **Setup wizard doesn't warn about required fields.** You can complete all 4 steps with only a name filled in, then hit a wall when trying to publish
- **"AI-Assisted" appears as a category.** Direct contradiction with "No AI" brand promise
- **AUD-only rate field.** No currency selector, no explanation of why AUD. Confusing for international artists
- **Name pre-fills from email prefix** (e.g. "john.smith92") — can produce ugly display names
- **No resend verification code button.** If code doesn't arrive, user is stuck
- **No portfolio upload during setup.** Asking for at least one image during onboarding would improve quality
- **No Terms of Service acceptance at signup**

---

## 4. WORKSPACE / ACCOUNT SETTINGS

### What Works Well
- Dual-role awareness — handles users who are both client and artist
- Message polling only runs on the Messages tab (efficient)
- Context-sensitive booking actions (accept/decline/cancel based on role + status)
- Verified profile lock with clear explanation
- Deep-linking via `?section=` URL param
- Portfolio management (add, remove, set cover) with S3 upload

### Issues Found
- **"Alerts" vs "Notifications" naming collision.** Alerts tab heading says "Notifications" — two different concepts share vocabulary
- **No portfolio empty state text.** Empty portfolio shows blank space, no hint to add items
- **No booking-to-message bridge.** Can't jump from a booking to its message thread or vice versa
- **No conversation initiation from Messages tab.** Can only reply to existing threads
- **Data controls is sparse.** No account deletion, no session management
- **Overview shortcuts missing** for Bookings, Messages, Notifications
- **Notifications capped at 24** with no "load more"
- **No booking filtering.** All bookings in one flat list, no status/date/role filter

---

## 5. ABOUT, FAQ, CONTACT, LEGAL

### What Works Well
- Mission positioning is strong and distinct
- FAQ is well-structured across three audience groups
- "What counts as human-made work?" answer is precise about the AI grey area
- Artists retain full copyright — stated clearly in legal terms
- Privacy policy is honest about session-storage-only approach
- Three separate contact email addresses show operational structure

### Issues Found
- **Contact form is a mailto facade.** Opens local email client instead of submitting to a server — fails silently on devices without email configured
- **No team or company identity on About page.** Platform asks for trust but provides no human identity behind it
- **`/about.html#mission` anchor doesn't exist.** Footer "Our mission" link scrolls nowhere
- **Legal page not in main navigation.** Only reachable via FAQ or direct URL
- **No jurisdiction or governing law stated.** No company registration number
- **No response time indication on Contact page**
- **No social media links anywhere** (Instagram, Twitter/X, LinkedIn)

---

## 6. VISUAL DESIGN & DARK MODE

### What Works Well
- Dark mode is first-class — every semantic token has a dark counterpart
- Warm off-white (#f3f0ea) background with radial gradient depth is distinctive
- Custom ease-out-expo curve on card hovers feels premium
- Inter Tight typography with monospace accents is editorial and deliberate
- Fluid clamp()-based type scaling
- Comprehensive status badge system (4 semantic colors, both themes)
- Noise overlay and body gradients add crafted texture
- backdrop-filter blur on sticky header is polished

### Issues Found
- **`--color-white` remapped to `#0e0e0d` in dark mode** — semantically confusing token name
- **`[aria-invalid="true"]:focus` has conflicting border-color** — orange overwrites error red
- **Some hardcoded border-radius values** (14px, 16px, 18px) instead of using tokens
- **`.btn-outline-light` defined in pages.css** instead of with other button variants in components.css
- **`--color-muted` referenced but never defined** — always falls back to hardcoded #888
- **Journey grid stays 3 columns down to 720px** while similar grids switch to 2 at 1100px

---

## 7. BOOKING FLOW

### What Works Well
- Double-guard self-booking prevention (client-side + server-side)
- Content moderation on booking messages
- Full audit trail on every status transition (timestamp, actor, from/to)
- Smart prefill from artist profile data
- Atomic success state (form replaced, prevents double-submission)
- 7 booking statuses with clear transition map

### Issues Found
- **Frontend message maxLength (2000) doesn't match backend (3000)**
- **Prefill button inserts a canned placeholder message** — user may submit it accidentally
- **Client can transition their own booking to `accepted` or `paid`** — no role-based transition enforcement
- **Notification titles show raw booking IDs** ("Booking b_uuid updated")
- **No duplicate booking prevention** — same form can be submitted multiple times
- **Payment flow is undefined.** Status transitions exist but no actual payment integration drives them
- **Artist availability not enforced at booking time** — can book a "closed" artist

---

## 8. MOBILE EXPERIENCE

### What Works Well
- Hamburger menu with proper ARIA (aria-expanded, aria-controls, aria-label)
- Category chips horizontally scrollable with hidden scrollbar
- clamp() fluid sizing scales smoothly to small screens
- Container width formula ensures sensible side gutters
- Footer collapses to single column at 640px
- All breakpoints well-placed (1100, 1020, 720, 640, 480)

### Issues Found
- **Filter sidebar has no "Apply and close" UX.** Opens in-flow, pushes content down, no sticky close button
- **Small touch targets on high-frequency elements:**
  - `.btn-small`: 38px (needs 44px)
  - `.theme-toggle`: 38px
  - `.category-chip`: ~34-36px
  - `.filter-chip`: 30px
- **No explicit close affordance on filter panel** — user must scroll up to find "Hide filters"
- **No focus trap in mobile nav overlay** — keyboard users can tab behind open menu

---

## 9. ACCESSIBILITY

### What Works Well
- Skip-to-content links on all pages
- prefers-reduced-motion kills all animations and marquee
- Toast notifications have proper ARIA (role="status", aria-live="polite")
- Mobile nav toggle has full ARIA attributes
- font-display: swap on all fonts
- type="module" scripts are deferred automatically
- escapeHtml and sanitizeImageUrl used throughout

### Issues Found
- **No `aria-current="page"` on active nav link** — screen readers can't identify current page
- **Input focus ring at 30% opacity likely fails 3:1 contrast** (WCAG 2.2 SC 3.2.4)
- **No fieldset/legend grouping on explore filter groups** — AT users lose group context
- **`--color-text-faint` almost certainly fails AA** in both themes (4.5:1 required)
- **Orange eyebrow text on cream background** likely fails contrast for 0.72rem text
- **Focus not returned to toggle button** after mobile nav closes
- **No aria-busy/loading state** during async data hydration
- **Footer headings use `<p>` instead of proper headings** — not discoverable by landmark nav

---

## 10. ADMIN PANEL & MODERATION

### What Works Well
- Layered moderation: auto-block slurs, auto-flag profanity, human review for flagged content
- Content snapshot on system reports — admins see exactly what triggered the flag
- Reversible actions: soft-delete + restore, reject + re-verify, reopen dismissed reports
- Custom word list management at runtime (no code deploy needed)
- Category control colocated with artist review
- Leet-speak normalization catches basic evasion (@, 4, 0, 1, 3, $, 5, 7)
- Hard delete with confirmation for permanent removal

### Issues Found
- **No audit log visible to admins.** No record of who verified/rejected/suspended
- **Rejection notes are sent but never displayed back** — if artist resubmits, no context for prior rejection
- **window.prompt() for rejection notes** — inconsistent with site UI, can be suppressed
- **No link from report to reported user** — shows raw UUID, no navigation bridge
- **No bulk actions.** 50 spam reports require 50 individual clicks
- **No email notification to users on suspend/reject/content-reset**
- **Word-boundary matching only** — compound slurs (e.g. "fuckface") bypass the filter
- **No image moderation** — entire system is text-only

---

## PRIORITY FIX LIST

### P0 — Broken / Blocking
1. Contact form is a mailto facade (broken on many devices)
2. "AI-Assisted" category contradicts brand promise
3. Client can self-accept/self-pay bookings (role enforcement missing)

### P1 — High Impact UX
4. Define what "verified" means on the homepage/about
5. Auto-login after email verification
6. Setup wizard should warn about required fields
7. Add character counters to textareas
8. Search should include bio and location
9. Message thread link after sending contact message
10. Filter sidebar "Apply and close" button on mobile

### P2 — Polish
11. Hide sort options that have no data
12. Add individual filter chip removal
13. Render artist bio on explore cards
14. Add debounce to search input
15. Fix touch targets to 44px minimum
16. Portfolio empty state text
17. Booking-to-message bridge
18. Account deletion option in Data controls
19. Add social media links

### P3 — Accessibility
20. aria-current="page" on active nav link
21. Increase focus ring contrast
22. fieldset/legend on filter groups
23. Fix color contrast on text-faint and orange-on-cream
24. Focus trap in mobile nav
25. Footer headings as proper heading elements
