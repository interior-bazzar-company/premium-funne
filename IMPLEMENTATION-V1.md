# Premium Funnel — Version 1 UI/UX Update · Implementation Document

Date: 2026-07-31 · Scope: `funnels/premium-funnel/` only

---

## 1. Architecture (as analysed)

| Aspect | Finding |
| --- | --- |
| Type | Standalone static landing page. No framework, no build step, no package manager. |
| Files | `index.html` (1241 L, all markup), `script.js` (1993 L, one IIFE), `styles.css` (2166 L) |
| Assets | `av-1/2/3.jpg` (leak posters), `logo.png`, `archivo.woff2` |
| Components | All render-time content is JS array data: `LOGOS`, `REVIEWS`, `FAQS`, `SLOTS`, `CHAT`, and the wizard's `VOLS/SRCS/SPENDS/TICKETS/SYSTEMS/SEGS/TIMES/CAPS/ROLES`. Static sections live in `index.html`. |
| Form | 5-step wizard, single instance, physically re-parented between page (`#wizardHost`) and mobile bottom sheet (`#sheet`) — never duplicated. Draft persisted to `localStorage["ib_premium_funnel_v1"]`. |
| Backend | Formspree JSON POST (`/f/xwvjvrjr`) — schemaless, accepts any keys. Round-robin rep lookup at `stage.interiorbazzar.com/api/v1/round-robin-phone/`, called once per submission. |
| Analytics | GTM `GTM-KQHTS87B` + Meta Pixel `1739751447041999`, both lazy-loaded. All events go through `track()` → `dataLayer`, tagged `funnel:"premium-funnel"`. |
| Responsive | Single breakpoint at `599px` (mobile sheet ↔ inline form) plus `600px` card-width bumps. |

**Not in scope:** `funnels/generic-funnel/`, `portal/`, `prototype/`. The EMI selector, the Leak rail and the single-select segment field exist **only** in the premium funnel — the generic funnel uses a different multi-select `segments` field and has no EMI widget.

---

## 2. Impact & dependency analysis

| # | Task | Files | Touches | Risk |
| --- | --- | --- | --- | --- |
| 1 | Call Now button | `script.js`, `styles.css` | `doneView()`, `bindDone()`, `failed()` fallback, `CONFIG` | Medium — success screen is post-conversion, must not break WhatsApp CTA |
| 2 | EMI durations | `index.html`, `script.js` | 2 × `.emi` blocks, EMI calculator IIFE, offer-stack copy | Medium — the note text after `<b>` was static and is wrong for a one-time payment |
| 3 | Testimonial removal | `script.js`, `index.html` | `REVIEWS`, `LOGOS`, inbox quote card | Low — carousel dots and marquee are both count-agnostic |
| 4 | Leak image swap | `index.html` | 2 × `<figure class="hcard shot">` | Low |
| 5 | Deals In field | `script.js` | `SEGS`, step-4 body, `missing()`, `doneView()`, `waText()` | Medium — stale drafts hold retired segment values |

### Dependency notes

- **Carousel** (`carousel()`) builds dots from live DOM cards, so `REVIEWS` can shrink freely.
- **Marquee** animates `translateX(-50%)` over `LOGOS.concat(LOGOS)` — count-agnostic.
- **EMI calculator** reads `data-total` from markup and `data-m` from each button; the *only* hardcoded value is the initial `calc(3)`.
- **Payload key `segment` is retained.** Formspree, `_subject`, `waText()`, `lead_*` analytics params and any existing inbox filters all key off it. Only the visible label and option values change.
- `score()` / `tier()` do **not** read `segment` — lead scoring is unaffected by task 5.
- `SLOTS` (slot-status table) uses its own vocabulary (`Turnkey interiors`, `Modular kitchen`). It is display-only and not joined to the form field — left untouched, flagged as a follow-up.

---

## 3. Decisions taken (confirmed with owner)

1. **Call Now dials the round-robin routed rep**, falling back to the main desk number `918882314255` when the API did not answer. Survives a page reload by reading `routed_phone` back off the stored `_last` payload.
2. **Perfekte Küchen removed from all three premium-funnel placements** — review carousel, logo marquee, and the inbox-section quote card. Generic funnel left alone.
3. **EMI defaults to `3 Months`** — the hero, sticky bar and meta description all lead with "EMI in 3 parts"; defaulting to One Time would headline ₹3,11,519.

---

## 4. Execution order

**Batch A (independent):** EMI durations · Testimonial cleanup · Leak image swap
**Batch B (sequential, same component):** Deals In field → Call Now button
**Merge:** single working tree, no branches — each task verified before the next begins.

---

## 5. Risk assessment & mitigations

| Risk | Mitigation |
| --- | --- |
| "per instalment" text renders under a One Time amount | Note text moved into `.emi-note` and driven by the selected `data-m` |
| Initial EMI state drifts from markup | `calc()` now seeds from the `.on` button instead of a hardcoded `3` |
| Stale localStorage draft holds a retired segment (`Modular kitchen`) — passes `valid()` but shows no selection and submits a dead category | Migration on restore: clear `s.segment` if it is not in the new `SEGS` |
| Routed phone missing on the success screen after reload | Three-level resolution: live `routedPhone` → stored `_last.routed_phone` → `CONFIG.fallbackPhone` |
| Removing the inbox quote leaves an orphan `<hr>` and trailing margin | Divider removed with the quote; caption's `margin-bottom` dropped |
| Duplicate/dead CTA if WhatsApp is disabled | Call Now renders independently of `CONFIG.whatsappNumber` |
| Conversion regression | No change to `submit()`, `succeeded()`, `payload()` keys, or any existing `track()` call. New events are additive only. |

---

## 6. Execution report

### Batch A — independent

**EMI durations** · `index.html` (both plan cards), `script.js`
- `3 parts / 4 parts` → `One Time` (`data-m="1"`) / `3 Months` (`data-m="3"`, default).
- The line under the amount moved into `<span class="emi-note">`, rewritten by `calc()`: *"per instalment · … No-cost EMI …"* for 3 Months, *"paid once · … Any major credit card, UPI or bank transfer."* for One Time. Default copy stays in the markup so the box still reads correctly with JS off.
- `calc()` now seeds from the `.on` button instead of a hardcoded `calc(3)`.
- Offer-stack copy corrected: *"Pay across 3 or 4 instalments"* → *"Pay across 3 instalments"*. Hero strip, sticky bar and meta descriptions still say "EMI in 3 parts" — still accurate, left alone.

**Testimonial cleanup** · `script.js`, `index.html`
- `REVIEWS` 5 → 4 entries; `LOGOS` 10 → 9; inbox-section quote card removed along with its divider, and the caption's trailing `margin-bottom` dropped so the card closes cleanly.

**Leak images** · `index.html` — rail order now `av-1 · av-3 · av-2`. Whole `<figure>` blocks swapped, so `width`/`height` (av-2 is 962px tall, av-3 is 960px), `loading="lazy"`, `decoding="async"` and alt text moved with their images.

### Batch B — sequential, same component

**Deals In** · `script.js`
- `SEGS` → Residential · Commercial · Industrial · Turnkey · Sanitary Related.
- Label `Your main segment` → `Deals In`; validation message, success summary row and WhatsApp handoff line relabelled to "Deals in".
- Payload key `segment` **unchanged** — Formspree, `_subject` and `lead_segment` keep working.
- Migration added: a restored draft holding a retired value is cleared so the step is re-asked rather than silently submitting a dead category.

**Call Now** · `script.js`, `styles.css`
- `<a class="btn btn-call" id="callBtn">Call now · +91 XXXXX XXXXX</a>` renders directly below the WhatsApp button on the success screen, full width, `margin-top:10px` matching the surrounding rhythm.
- `callNumber()` resolves most-specific-first: pinned `CONFIG.phone` → live `routedPhone` → `routed_phone` off the stored `_last` payload (survives reload) → `CONFIG.fallbackPhone` (918882314255). Always normalised to `+91`-prefixed E.164.
- Same button now also appears in the send-failure fallback, which previously never rendered because `CONFIG.phone` was empty.
- New `.btn-call` style: gold outline on a 6% gold wash — reads as the second half of a CTA pair without competing with the filled WhatsApp button, and keeps "Start a new enquiry" visibly tertiary.
- Tracking added: `ib_call_click` (`where: success | send_failure`, `lead_tier`, `call_number`) and `ib_wa_click` (`where`, `lead_tier`) — the WhatsApp button had no event before.

---

## 7. QA report

| Check | Result |
| --- | --- |
| `node --check script.js` | Pass |
| HTML tag balance across `<body>` | Pass — no unclosed or mismatched tags |
| EMI maths | `₹3,11,519` / `₹1,03,840` (Elite) · `₹6,48,999` / `₹2,16,333` (Enterprise) — `en-IN` grouping correct |
| Call number resolution | Verified for all four paths: 10-digit routed, 12-digit routed, reload-from-storage, API failure → desk |
| Leftover references | No `4 parts`, `data-m="4"`, `Perfekte`, `Kamal Mittal` or `main segment` remain |
| Carousel / marquee integrity | Dots are built from live DOM cards; marquee animates `translateX(-50%)` over a duplicated list — both count-agnostic, no change needed |
| Analytics | No existing event or parameter altered; `payload()` keys unchanged; two additive events |
| Backend compatibility | Formspree is schemaless and the `segment` key is preserved — no mapping change required |
| No-JS degradation | EMI note copy present in markup; noscript WhatsApp fallback untouched |
| Console errors | None introduced — IDE diagnostics report style hints only (ES5 idiom kept deliberately to match the file) |
| Responsive | No layout rules changed. `.btn-call` reuses `.btn-ghost`'s 48px metrics; the emi `<span>` is inline inside an existing block; leak/review rails are unchanged structurally |
| **Browser render check** | **Not performed** — Chromium crashes on launch in this environment (network + GPU process exit at startup). Needs a manual pass, see below |

---

## 8. Revision 1.1 — claim accuracy + discount visibility

### A. "Budget" removed as a verification claim

The page claimed in nine places that we confirm a client's **budget**. A budget cannot be honestly verified over a qualification call — it settles once the member sits with the client. Every such claim now names what *is* checkable: **interest, intent and urgency** (plus city and scope), matching the wording the Elite plan already used ("interest check, intent validation, urgency filter").

| Where | Was | Now |
| --- | --- | --- |
| `og:description` | "We verify every client — budget, scope, city, timeline" | "— interest, intent, urgency, city and scope" |
| Hero paragraph | "a human confirms it on call — budget, scope, city, timeline" | "— interest, intent, urgency, city" |
| Proof section lead | "budget, scope and timeline confirmed" | "interest, scope and urgency confirmed" |
| How it works · step 2 | "Interest, intent, budget, city, timeline" | "Interest, intent, urgency, city, scope" |
| How it works · step 3 | "Name, number, scope, budget and timeline" | "Name, number, scope, city and timeline" |
| Inbox · filtered-out line | "wrong city, no budget, no intent" | "wrong city, no intent, no urgency" |
| Directory comparison row | "Budget & timeline known" | "Intent & urgency known" |
| FAQ · "How do you qualify…" | "checks on interest, intent, budget, city and timeline" | "…interest, intent, urgency, city and scope" + explicit note that no verified rupee figure is claimed |
| FAQ · "Do you guarantee…" | "confirmed budget, scope, city and timeline" | "confirmed interest, intent, urgency, city and scope" + "We do not claim to have verified their budget — nobody honestly can over a phone call" |
| Qualification chat demo | desk asks "what budget range are you planning?" | asks "how soon are you planning to start?"; the designer now "take[s] the numbers with you directly" |

Both FAQ edits were applied twice — the `FAQPage` JSON-LD in `index.html` and the `FAQS` array in `script.js` carry the same text and would otherwise drift. A parity check now confirms all 10 answers match.

**Two `budget` mentions remain, deliberately:**
- The FAQ sentence that *disclaims* budget verification.
- `av-1.jpg` alt text — "Wrong city. No budget. Abhi soch rahe hain." This describes the junk leads a member currently buys, not our qualification, and it transcribes words baked into the image.

### B. Founding discount shown with the plan total

The plan totals read as full price. Each `.emi` block now carries `data-save` (the GST-inclusive founding discount) and the note names it on the same line as the total:

| Plan | One Time | 3 Months |
| --- | --- | --- |
| Elite | **₹3,11,519** — paid once · ₹3,11,519 total incl. GST, after your **₹42,480** founding discount. Any major credit card, UPI or bank transfer. | **₹1,03,840** — per instalment · ₹3,11,519 total incl. GST, after your ₹42,480 founding discount. No-cost EMI… |
| Enterprise | **₹6,48,999** — paid once · ₹6,48,999 total incl. GST, after your **₹88,500** founding discount. Any major credit card, UPI or bank transfer. | **₹2,16,333** — per instalment · ₹6,48,999 total incl. GST, after your ₹88,500 founding discount. No-cost EMI… |

Discounts verified against the existing sublines and the GST maths: `₹3,53,999 − ₹3,11,519 = ₹42,480` and `₹7,37,499 − ₹6,48,999 = ₹88,500`. The static markup fallback was updated to match the JS default state exactly.

### Rev 1.1 QA

| Check | Result |
| --- | --- |
| `node --check script.js` | Pass |
| HTML tag balance | Pass |
| JSON-LD parses | Pass |
| FAQ JSON-LD ↔ `FAQS` parity | Pass — all 10 answers identical |
| EMI note output, 4 combinations | Pass — verified against GST maths |
| Static markup ↔ JS default state | Byte-identical |

### Manual verification still required

1. Success screen on a real phone — tap **Call now**, confirm the dialer opens with the routed rep's number.
2. Success screen after a page reload (within 24h) — confirm the number persists from storage.
3. EMI toggle on both plan cards — confirm the note switches between "paid once" and "per instalment".
4. Leak rail at 360px, 430px and desktop — confirm the new `av-1 · av-3 · av-2` order and that arrows/dots still track.
5. Step 4 of the form with an older draft in `localStorage` — confirm the Deals In step is re-asked rather than pre-filled with a retired value.

---

## Rev 1.2 — form fixes

Date: 2026-08-05 · Scope: the 5-step wizard in `script.js` (+ one rule in `styles.css`)

### 1. "Deals In" is now multi-select

An owner who does residential *and* turnkey had to pick one and under-report
what they can take on, which then routed them into a single slot.

- `s.segment` is now an **array**; the option list renders with `{multi:true}`,
  matching the "Where do those enquiries come from?" step.
- `valid(4)` checks `s.segment.length > 0`; `missing(4)` asks for "at least one".
- `payload()` joins it to `"Residential, Turnkey"` — the wire format is a string,
  exactly as before, so **Formspree, `_subject`, `waText()` and `lead_segment`
  are unchanged**. The success summary joins with `·`.

### 2. Project size — five bands

Interior work clusters below ₹15L, and a single `₹3 – 8 lakh` bucket hid the
line where this pays back. `TICKETS` is now:

`Under ₹5 lakh` · `₹5 – 15 lakh` · `₹15 – 25 lakh` · `₹25 – 50 lakh` · `₹50 lakh+`

`score()` maps them `0 / 2 / 3 / 4 / 5` — the same 0–5 range as before, so
`tier()` thresholds and the Ads/Meta conversion values are untouched. Step name
`PROJECT VALUE` → `PROJECT SIZE`; options render `sm` so five rows still fit one
screen.

### 3. The "reload" glitch on the contact step

**Cause:** picking a role ran `if (k === "role") return render();` — a full
`innerHTML` rebuild of the wizard, purely to reveal the approver field for
"Team member". That replayed the `.step` slide-in animation (reads as a page
reload), dropped focus and the mobile keyboard, and reset the bottom sheet's
scroll to the top of the step. The early `return` also skipped `save()`, so the
role never reached the draft.

**Fix:** the approver input lives in a permanent `#approverWrap`, filled and
emptied in place by `syncApprover()`. No re-render, no animation, nothing above
it moves. It fades in via `.field.reveal` (disabled under
`prefers-reduced-motion`). Switching away from "Team member" also clears
`s.approver`, so a name typed by mistake never reaches sales.

### 4. Stale drafts

Restore now migrates an old single-choice `segment` string into the array,
drops any option that no longer exists, and clears a retired project band. If
that leaves a *passed* step unanswered the wizard walks back to it (`step > 3`
with no ticket → step 3), instead of letting a blank field sail through to
sales — `valid()` only ever guards the step in front of the visitor.

### Rev 1.2 QA

Driven through jsdom against the real `index.html` + `script.js`.

| Check | Result |
| --- | --- |
| `node --check script.js` | Pass |
| Multi-select segment: toggle on/off, next gated on ≥1 | Pass |
| 5 project bands, single-select, values match spec | Pass |
| Role click does **not** replace `#stepBody` or `#fBusiness` | Pass |
| Typed contact values survive a role change | Pass |
| Approver appears/disappears in place; gating follows | Pass |
| Role + cleared approver persist to the draft | Pass |
| Legacy draft (string segment, retired band) → walked back to step 3 | Pass |
| Submitted payload: `segment` joined string, band, `+91` phone | Pass |
| Success summary rows: "Deals in", "Typical project" | Pass |

### Manual verification still required

1. Real phone, step 5 — tap through all four roles and confirm nothing flashes
   or scrolls, in both the inline form and the mobile bottom sheet.
2. Keyboard open on "Business name", then tap a role — the keyboard should stay.
3. Step 4 at 360px — confirm the five multi-select segment chips wrap cleanly.
