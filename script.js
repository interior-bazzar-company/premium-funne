      (function () {
        "use strict";

        /* ════════════════════════════════════════════════════════════
   CONFIG — set these to wire the form to your systems.
   leadEndpoint : Formspree form endpoint (JSON POST). Same form the generic
                  funnel uses — premium leads carry funnel:"premium-funnel"
                  and a _subject line so they filter cleanly in the inbox.
   Call and WhatsApp both dial whichever rep (rajni/seema) this lead was
   round-robin routed to — see callNumber(). No shared fallback number.
   ════════════════════════════════════════════════════════════ */
        var CONFIG = {
          leadEndpoint: "https://formspree.io/f/xwvjvrjr",
          /* Set `phone` to pin every call button to one fixed line instead,
             overriding round-robin routing. `phoneLabel`, when set, also shows
             the "we will call you from" card above the buttons. */
          phone: "",
          phoneLabel: "",
          storageKey: "ib_premium_funnel_v1",
          /* Paste your Google Business Profile review URL here and the "★ 4.5 on
             Google" chip becomes a clickable proof link. Left empty on purpose —
             an unverifiable rating is a claim, a linked one is evidence, but a
             BROKEN link is worse than either, so nothing renders until it's set. */
          googleReviewsUrl: "",
          // Mobile form opens as a bottom sheet from every CTA. Set to e.g. 60 to ALSO
          // auto-open it once per session after the visitor passes 60% of the page.
          // 0 = never auto-open (recommended for a high-ticket B2B offer).
          autoOpenAfterPct: 0,
        };

        /* ONE call does both jobs now: it creates the deal in the admin pipeline
           and answers with the rep this lead was routed to, so "routed_phone" /
           "lead_for" below and the Call/WhatsApp buttons all point at the person
           who actually owns it. Replaces the old GET /round-robin-phone/, which
           only ever handed back a number.

           The rotation is PER FUNNEL and lives server-side: a generic-funnel
           submission never spends a premium turn, and a number that already has
           an open deal comes back with the rep it already has — same customer,
           same salesperson, no second pipeline, no turn spent. That is why the
           `funnel` key on the payload matters and must stay "premium-funnel".

           Fails soft on purpose: a network error leaves routedPhone null, the
           buttons fall back, and the Formspree submit below still runs — a dead
           API must never cost us the lead.

           LIVE (2026-08-22): PROD is the only answer that counts — the rep,
           the ref and the number on the success screen all come from here.
           DEAL_API_TEST is a copy of the same submission to dev so the flow
           stays observable there; its response is DISCARDED and its failure is
           invisible. Never read a routed number off it: dev runs its own
           rotation and would hand the customer the wrong rep. */
        var DEAL_API = "https://prod.interiorbazzar.com/api/v1/funnel-lead/";
        var DEAL_API_TEST = "https://dev.interiorbazzar.com/api/v1/funnel-lead/";
        var routedPhone = null,
          routedOwner = "",
          dealRef = "";
        function createDeal(lead) {
          /* Fire-and-forget mirror to dev. Deliberately not awaited and not
             chained into the promise below: a dev outage must not delay or
             fail a prod submission. */
          try {
            fetch(DEAL_API_TEST, {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(lead),
              keepalive: true,
            }).catch(function () {});
          } catch (e) {}
          /* keepalive + ONE retry, because this is where a lead was lost on
             6 Sep: prod answered the preflight, then the Facebook in-app
             webview dropped the POST that followed, and the dev mirror above —
             which has had keepalive all along — was the only copy that
             survived. The retry is safe: the intake dedupes on phone, so a
             retry after a response we never saw lands on the deal already
             created, as a remark, with the same rep. */
          function postDeal() {
            return fetch(DEAL_API, {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(lead),
              keepalive: true,
            });
          }
          return postDeal()
            .catch(function () {
              return postDeal();
            })
            .then(function (r) {
              if (!r.ok) throw new Error("HTTP " + r.status);
              return r.json();
            })
            .then(function (json) {
              /* Every refusal on this API is an HTTP 200 carrying
                 response:false — a bad number, no stage vocabulary, an
                 unhandled error. The envelope is the ONLY place a lost lead
                 says it was lost, so it is what we read. REJECTS on it, so
                 submit() can fall back to the inbox rather than call a lead
                 delivered because the mirror went through. */
              if (!json || json.response !== true)
                throw new Error((json && json.message) || "refused");
              var d = json.data || {};
              if (d.phoneNumber)
                routedPhone = String(d.phoneNumber).replace(/\D/g, "");
              if (d.leadOwner) routedOwner = d.leadOwner;
              if (d.ref) dealRef = d.ref;
            });
        }
        // Fallback owner lookup for when the API answered with a number but no
        // name (an older build), or did not answer at all.
        var PHONE_TO_LEAD = {
          "9315663588": "rajni",
          "8920898168": "seema",
        };
        function routedPhone10() {
          var p = (routedPhone || "").replace(/\D/g, "");
          if (p.length === 12 && p.indexOf("91") === 0) p = p.slice(2);
          else if (p.length > 10) p = p.slice(-10);
          return p;
        }
        function routedLeadOwner() {
          return routedOwner || PHONE_TO_LEAD[routedPhone10()] || "unknown";
        }

        var $ = function (s, c) {
          return (c || document).querySelector(s);
        };
        var $$ = function (s, c) {
          return Array.prototype.slice.call(
            (c || document).querySelectorAll(s),
          );
        };
        var buzz = function (ms) {
          try {
            navigator.vibrate && navigator.vibrate(ms || 8);
          } catch (e) {}
        };

        /* ───────── event spine ─────────
   Vendor-agnostic: everything lands in dataLayer (GTM listens), mirrors to gtag
   when present. Every event carries funnel:"premium-funnel" so this page can be
   split out from ib_sales_funnel in reporting. Safe no-op without any IDs. */
        var FUNNEL_ID = "premium-funnel";
        function track(name, params) {
          var p = { event: name, funnel: FUNNEL_ID };
          if (params)
            for (var k in params) {
              if (params.hasOwnProperty(k)) p[k] = params[k];
            }
          try {
            window.dataLayer = window.dataLayer || [];
            window.dataLayer.push(p);
          } catch (e) {}
          try {
            if (typeof window.gtag === "function")
              window.gtag("event", name, p);
          } catch (e) {}
        }
        track("ib_page_view", { page_variant: "premium" });

        /* Ratings convert far better as verifiable links than as claims. */
        (function () {
          var chip = $("#googleChip");
          if (!chip || !CONFIG.googleReviewsUrl) return;
          var a = document.createElement("a");
          a.className = "chip chip-link";
          a.id = "googleChip";
          a.href = CONFIG.googleReviewsUrl;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = "★ 4.5 on Google →";
          chip.replaceWith(a);
        })();

        function toast(msg, ms) {
          var t = $("#toast");
          t.textContent = msg;
          t.classList.add("on");
          clearTimeout(toast._t);
          toast._t = setTimeout(function () {
            t.classList.remove("on");
          }, ms || 2600);
        }

        /* ───────── data ───────── */
        var LOGOS = [
          ["Hashmi Infrabuild", "HI"],
          ["Hightech Windows", "HW"],
          ["AR Furnishing", "AR"],
          ["Ecovision", "EV"],
          ["Furnin Interior", "FI"],
          ["Vishal Interior", "VI"],
          ["Ayan Interior", "AI"],
          ["Hindustan Interiors", "HN"],
          ["PSC Studio", "PS"],
        ];

        var REVIEWS = [
          [
            "Vishal Interior",
            "Turnkey Interiors",
            "VI",
            "Mr. Vishal Sharma",
            "Faridabad · Jan 2026",
            "★ 5.0",
            "Two full-home projects closed in our first quarter — ₹19L between them. The subscription paid back on the first one.",
          ],
          [
            "Hashmi Infrabuild",
            "Interior Design",
            "HI",
            "Mr. Hashmi",
            "Noida · Feb 2026",
            "★ 4.5",
            "Pehle 200 leads aate the aur 5 kaam ke nikalte the. Ab jo aata hai wo genuine hota hai, so my team's whole day changed.",
          ],
          [
            "Hightech Windows Blind",
            "Interior Decor",
            "HW",
            "Mr. Vinod Gupta",
            "Ghaziabad · Apr 2026",
            "★ 4.5",
            "The verification is real. Nobody has told me 'I only enquired by mistake' since we joined — that used to be half my calls.",
          ],
          [
            "AR Furnishing",
            "Furnishing",
            "AR",
            "Mr. Arshad Rehman",
            "Gurugram · Feb 2026",
            "★ 4.0",
            "Volume is lower than the directories, no doubt. But we're not fighting three competitors on price any more, so margins are healthier.",
          ],
        ];

        var FAQS = [
          [
            "Do I have to change how my team works?",
            "No. There is nothing to install and nothing to learn. We run our own process to find and qualify clients, then assign them to you — your team simply calls the people we send and closes.",
          ],
          [
            "How do you qualify a client before sending?",
            "Every enquiry passes checks on interest, intent, urgency, city and scope, and is then confirmed by a direct call from our desk. Most enquiries never survive it — that filtering is exactly what you are paying for. We do not put a verified rupee figure on a client — numbers only become real once you sit with them — so we qualify the things that can be checked honestly.",
          ],
          [
            "Is the client really exclusive to me?",
            "Yes. One client is assigned to one business, never resold to the firm down the road. That is the whole difference between us and a directory.",
          ],
          [
            "How many clients will I actually get?",
            "It depends on genuine demand in your city and category, and we won't pretend otherwise. On the call we give you the honest number for your area before you pay anything.",
          ],
          [
            "Do you guarantee I'll close these clients?",
            "No — and be wary of anyone who does. We guarantee qualification, not closure. Every client we assign has confirmed interest, intent, urgency, city and scope, and has agreed to a site visit before you ever hear the name. We do not claim to have verified their budget — nobody honestly can over a phone call, and the real number only settles once you sit with them. Whether the project signs depends on your design, your pricing and how fast your team follows up — that part is your business, and we won't pretend to control it. What we take off your plate is the part you should never have been paying for: chasing people who were never going to buy.",
          ],
          [
            "How soon do clients start arriving?",
            "Once your profile and portfolio are verified, assignments begin as clients come in — there is no waiting list.",
          ],
          [
            "What if my area is already taken?",
            "We tell you on the call and stop there. One slot per area is the point — we won't sell you a plan that competes with a member we already have.",
          ],
          [
            "How is this different from JustDial or IndiaMART?",
            "They sell the same enquiry to eight businesses, so you compete on price from the first call. We assign each verified client to one business, and we build your profile and visibility alongside it — not just a stream of numbers.",
          ],
          [
            "What if an assigned client goes cold?",
            "Tell your account contact. We re-verify, and if the client turns out to be unreachable or not genuine, it does not count against your allocation.",
          ],
          [
            "Can I pause or get a refund?",
            "The subscription is annual because exclusivity means we hold your area for the full year. Pause and cancellation terms are written into your agreement — we walk through them on the call before you pay anything.",
          ],
        ];

        var SLOTS = [
          ["Gurugram", "Turnkey interiors", "1 LEFT", "left"],
          ["Noida", "Modular kitchen", "TAKEN", "taken"],
          ["Ghaziabad", "Furnishing", "1 LEFT", "left"],
          ["Delhi", "Turnkey interiors", "1 LEFT", "left"],
          ["Faridabad", "All segments", "TAKEN", "taken"],
          ["Jaipur", "All segments", "OPEN", "open"],
          ["Lucknow", "All segments", "OPEN", "open"],
          ["Chandigarh", "Modular kitchen", "1 LEFT", "left"],
        ];

        var CHAT = [
          /* The desk asks what it can actually verify — interest, intent and
             urgency. Money is deliberately not scripted here: we don't claim a
             confirmed budget, and the demo shouldn't imply one. */
          [
            "them",
            "Hi Rohan — you enquired about full interiors for a 3BHK in Gurugram. Quick one: how soon are you planning to start?",
          ],
          ["me", "3 hafte me start karna hai, poora ghar karwana hai"],
          [
            "them",
            "Perfect. Our designer can visit your site tomorrow at 5pm and take the numbers with you directly — shall I confirm?",
          ],
          ["me", "Haan, confirm kar dijiye"],
          ["tag", "VERIFIED · VISIT BOOKED · ASSIGNED TO ONE BUSINESS"],
        ];

        /* ───────── logos marquee ───────── */
        (function () {
          var t = $("#logoTrack"),
            html = "";
          LOGOS.concat(LOGOS).forEach(function (l) {
            html +=
              '<div class="logo"><i>' +
              l[1] +
              "</i><span>" +
              l[0] +
              "</span></div>";
          });
          t.innerHTML = html;
        })();

        /* ───────── reviews carousel ───────── */
        (function () {
          var rail = $("#rail"),
            dots = $("#dots");
          rail.innerHTML = REVIEWS.map(function (r) {
            return (
              '<div class="review">' +
              '<div class="top"><div><i>' +
              r[2] +
              '</i><div><div class="co">' +
              r[0] +
              '</div><div class="cat">' +
              r[1] +
              '</div></div></div><span class="stars">' +
              r[5] +
              "</span></div>" +
              '<div class="txt">' +
              r[6] +
              "</div>" +
              '<div class="ft"><b>' +
              r[3] +
              "</b><span>" +
              r[4] +
              "</span></div></div>"
            );
          }).join("");
          carousel(rail, dots, ".review", "Review");
        })();

        /* ───────── shared carousel: dots, snap-tracking, desktop drag ───────── */
        function carousel(rail, dots, cardSel, label, opts) {
          opts = opts || {};
          var autoSnap = opts.snap !== false; // rails may scroll completely freely
          var cards = $$(cardSel, rail);
          if (!cards.length) return;
          if (dots) {
            dots.innerHTML = cards
              .map(function (_, i) {
                return (
                  '<button type="button" aria-label="' +
                  label +
                  " " +
                  (i + 1) +
                  '"' +
                  (i === 0 ? ' class="on"' : "") +
                  "></button>"
                );
              })
              .join("");
          }
          var btns = dots ? $$("button", dots) : [];
          btns.forEach(function (b, i) {
            b.addEventListener("click", function () {
              rail.scrollTo({
                left: cards[i].offsetLeft - rail.offsetLeft - 14,
                behavior: "smooth",
              });
              buzz(6);
            });
          });
          var tick;
          function sync() {
            var mid = rail.scrollLeft + rail.clientWidth / 2,
              best = 0,
              bd = 1e9;
            cards.forEach(function (c, i) {
              var cc = c.offsetLeft - rail.offsetLeft + c.offsetWidth / 2,
                d = Math.abs(cc - mid);
              if (d < bd) {
                bd = d;
                best = i;
              }
            });
            btns.forEach(function (b, i) {
              b.classList.toggle("on", i === best);
            });
            cards.forEach(function (c, i) {
              c.classList.toggle("near", i === best);
            });
          }
          rail.addEventListener(
            "scroll",
            function () {
              clearTimeout(tick);
              tick = setTimeout(sync, 60);
            },
            { passive: true },
          );
          sync();
          /* ── smooth pointer drag with release inertia ──
             Native touch scrolling already has momentum; this gives the mouse the
             same feel instead of stopping dead the instant the button is released. */
          var down = false,
            sx = 0,
            sl = 0,
            moved = false,
            vel = 0,
            lastX = 0,
            lastT = 0,
            glide = 0;

          function stopGlide() {
            if (glide) {
              cancelAnimationFrame(glide);
              glide = 0;
            }
          }
          function coast() {
            vel *= 0.94;
            rail.scrollLeft -= vel;
            if (Math.abs(vel) > 0.4) glide = requestAnimationFrame(coast);
            else {
              glide = 0;
              snapNearest();
            }
          }
          /* proximity snapping is done here rather than by the CSS engine, so a
             flick glides to rest instead of being yanked to the nearest card */
          function snapNearest() {
            if (!autoSnap) return; // free rail: never move on its own
            var mid = rail.scrollLeft + rail.clientWidth / 2,
              best = null,
              bd = 1e9;
            cards.forEach(function (c) {
              var cc = c.offsetLeft - rail.offsetLeft + c.offsetWidth / 2,
                d = Math.abs(cc - mid);
              if (d < bd) {
                bd = d;
                best = c;
              }
            });
            if (!best) return;
            var target =
              best.offsetLeft -
              rail.offsetLeft -
              (rail.clientWidth - best.offsetWidth) / 2;
            target = Math.max(0, Math.min(target, rail.scrollWidth - rail.clientWidth));
            if (Math.abs(target - rail.scrollLeft) > 2)
              rail.scrollTo({ left: target, behavior: "smooth" });
          }

          /* any element can start a native drag (images especially) — that drag
             swallows the pointer stream and the rail stops responding */
          rail.addEventListener("dragstart", function (e) {
            e.preventDefault();
          });
          rail.addEventListener("pointerdown", function (e) {
            if (e.pointerType === "touch") return; // native momentum is better
            stopGlide();
            /* capture so the drag survives the cursor leaving the rail */
            try {
              rail.setPointerCapture(e.pointerId);
            } catch (err) {}
            down = true;
            moved = false;
            vel = 0;
            sx = lastX = e.pageX;
            sl = rail.scrollLeft;
            lastT = e.timeStamp;
            rail.style.cursor = "grabbing";
            rail.style.scrollSnapType = "none";
          });
          rail.addEventListener("pointermove", function (e) {
            if (!down) return;
            e.preventDefault();
            if (Math.abs(e.pageX - sx) > 3) moved = true;
            var dt = e.timeStamp - lastT || 16;
            vel = (e.pageX - lastX) / dt * 16; // px per frame
            lastX = e.pageX;
            lastT = e.timeStamp;
            rail.scrollLeft = sl - (e.pageX - sx);
          });
          function release(e) {
            if (!down) return;
            down = false;
            if (e && e.pointerId != null) {
              try {
                rail.releasePointerCapture(e.pointerId);
              } catch (err) {}
            }
            rail.style.cursor = "";
            rail.style.scrollSnapType = "";
            if (Math.abs(vel) > 1) coast();
            else snapNearest();
          }
          window.addEventListener("pointerup", release);
          window.addEventListener("pointercancel", release);

          /* a vertical wheel over a horizontal rail should move the rail, but only
             while it still has room — otherwise the page must keep scrolling */
          rail.addEventListener(
            "wheel",
            function (e) {
              if (e.ctrlKey) return;
              var dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
              if (!dx) return;
              var max = rail.scrollWidth - rail.clientWidth;
              if (max <= 0) return;
              var atStart = rail.scrollLeft <= 0 && dx < 0;
              var atEnd = rail.scrollLeft >= max - 1 && dx > 0;
              if (atStart || atEnd) return; // let the page take over
              e.preventDefault();
              stopGlide();
              rail.scrollLeft += dx;
              clearTimeout(rail._wheelT);
              rail._wheelT = setTimeout(snapNearest, 120);
            },
            { passive: false },
          );

          /* keyboard: the dots are focusable, so arrows should work too */
          rail.setAttribute("tabindex", "0");
          rail.addEventListener("keydown", function (e) {
            var i = cards.findIndex(function (c) {
              return c.classList.contains("near");
            });
            if (e.key === "ArrowRight" && i < cards.length - 1) {
              e.preventDefault();
              cards[i + 1].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
            } else if (e.key === "ArrowLeft" && i > 0) {
              e.preventDefault();
              cards[i - 1].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
            }
          });

          rail.addEventListener(
            "click",
            function (e) {
              if (moved) {
                e.preventDefault();
                e.stopPropagation();
              }
            },
            true,
          );

          /* ── arrow navigation (pointer devices) ──
             One card + gap per press, and the arrows disappear at each end so you
             never press a dead control. */
          if (opts.prev && opts.next) {
            var prev = $(opts.prev),
              next = $(opts.next);
            function step(dir) {
              var gap = parseFloat(getComputedStyle(rail).columnGap || "14") || 14;
              stopGlide();
              rail.scrollBy({
                left: dir * (cards[0].offsetWidth + gap),
                behavior: "smooth",
              });
            }
            function ends() {
              var max = rail.scrollWidth - rail.clientWidth;
              if (prev) prev.hidden = rail.scrollLeft <= 2;
              if (next) next.hidden = rail.scrollLeft >= max - 2 || max <= 0;
            }
            if (prev)
              prev.addEventListener("click", function () {
                step(-1);
                buzz(6);
              });
            if (next)
              next.addEventListener("click", function () {
                step(1);
                buzz(6);
              });
            rail.addEventListener("scroll", ends, { passive: true });
            addEventListener("resize", ends, { passive: true });
            ends();
          }
        }

        /* leak-section rail */
        carousel($("#leakRail"), $("#leakDots"), ".hcard", "Point", {
          snap: false,
          prev: "#leakPrev",
          next: "#leakNext",
        });

        /* ───────── FAQ accordion ───────── */
        (function () {
          var w = $("#faqs");
          w.innerHTML = FAQS.map(function (f, i) {
            return (
              '<div class="faq' +
              (i === 0 ? " on" : "") +
              '"><button type="button" aria-expanded="' +
              (i === 0) +
              '"><span>' +
              f[0] +
              "</span><i>+</i></button>" +
              '<div class="a"><p>' +
              f[1] +
              "</p></div></div>"
            );
          }).join("");
          var items = $$(".faq", w);
          function setOpen(el, on) {
            el.classList.toggle("on", on);
            $("button", el).setAttribute("aria-expanded", String(on));
            var a = $(".a", el);
            a.style.maxHeight = on ? a.scrollHeight + "px" : "0px";
          }
          items.forEach(function (el) {
            $("button", el).addEventListener("click", function () {
              var willOpen = !el.classList.contains("on");
              items.forEach(function (o) {
                setOpen(o, false);
              });
              if (willOpen) setOpen(el, true);
              buzz(6);
            });
          });
          setOpen(items[0], true);
          window.addEventListener("resize", function () {
            items.forEach(function (el) {
              if (!el.classList.contains("on")) return;
              var a = $(".a", el);
              a.style.maxHeight = "none";
              var h = a.scrollHeight;
              a.style.maxHeight = h + "px";
            });
          });
        })();

        /* ───────── slot checker ───────── */
        (function () {
          var list = $("#slotList");
          function badgeCls(k) {
            return k === "taken"
              ? "b-taken"
              : k === "open"
                ? "b-open"
                : "b-left";
          }
          function render(rows) {
            list.innerHTML = rows.length
              ? rows
                  .map(function (s) {
                    return (
                      '<div class="slot"><span' +
                      (s[3] === "taken" ? ' style="color:#8c8c8c"' : "") +
                      ">" +
                      s[0] +
                      " · " +
                      s[1] +
                      "</span>" +
                      '<span class="badge ' +
                      badgeCls(s[3]) +
                      '">' +
                      s[2] +
                      "</span></div>"
                    );
                  })
                  .join("")
              : '<div class="slot"><span style="color:#8c8c8c">No city matched — it is most likely still open.</span></div>';
          }
          render(SLOTS.slice(0, 4));
          $("#lookForm").addEventListener("submit", function (e) {
            e.preventDefault();
            var q = $("#lookCity").value.trim();
            var out = $("#lookOut");
            if (!q) {
              render(SLOTS.slice(0, 4));
              out.innerHTML = "";
              return;
            }
            var hits = SLOTS.filter(function (s) {
              return s[0].toLowerCase().indexOf(q.toLowerCase()) > -1;
            });
            render(hits.length ? hits : []);
            if (!hits.length) {
              out.innerHTML =
                "<b>" +
                esc(q) +
                "</b> is not on our taken list — likely open. Fill the form below and we will confirm on the call.";
            } else if (
              hits.every(function (h) {
                return h[3] === "taken";
              })
            ) {
              out.innerHTML =
                "<b>" +
                esc(hits[0][0]) +
                "</b> is taken in that category. Ask us about the nearest open area.";
            } else {
              out.innerHTML =
                "<b>" +
                esc(hits[0][0]) +
                "</b> still has room — check availability below before it goes.";
            }
            buzz(10);
            wizard.state.city = wizard.state.city || q;
          });
          function esc(s) {
            return s.replace(/[&<>"]/g, function (c) {
              return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[
                c
              ];
            });
          }
        })();

        /* ───────── EMI calculators ───────── */
        $$(".emi").forEach(function (box) {
          var total = parseInt(box.getAttribute("data-total"), 10);
          var out = $("b", $(".emi-out", box));
          var note = $(".emi-note", box);
          var save = parseInt(box.getAttribute("data-save"), 10);
          var totalFmt = "₹" + total.toLocaleString("en-IN");
          /* The total already has the founding discount taken off it. Naming the
             saving on the same line stops the figure reading as full price. */
          var afterDiscount =
            " total incl. GST" +
            (save
              ? ", after your ₹" +
                save.toLocaleString("en-IN") +
                " founding discount. "
              : ". ");
          function calc(m) {
            out.textContent =
              "₹" + Math.round(total / m).toLocaleString("en-IN");
            if (!note) return;
            /* One Time shows the full amount — calling that "per instalment"
               would read as a monthly figure and misprice the plan. */
            note.textContent =
              m === 1
                ? "paid once · " +
                  totalFmt +
                  afterDiscount +
                  "Any major credit card, UPI or bank transfer."
                : "per instalment · " +
                  totalFmt +
                  afterDiscount +
                  "No-cost EMI on major credit cards, subject to your issuer.";
          }
          var btns = $$("button", box);
          btns.forEach(function (b) {
            b.addEventListener("click", function () {
              btns.forEach(function (x) {
                x.classList.remove("on");
              });
              b.classList.add("on");
              calc(parseInt(b.getAttribute("data-m"), 10));
              buzz(6);
            });
          });
          /* seed from whichever button the markup marks as selected, so the
             default duration lives in one place */
          var first = $("button.on", box) || btns[0];
          if (first) calc(parseInt(first.getAttribute("data-m"), 10));
        });

        /* ───────── reveal on scroll + counters + chat ───────── */
        (function () {
          if (!("IntersectionObserver" in window)) {
            $$(".rv").forEach(function (e) { e.classList.add("in"); });
            playChat();
            return;
          }
          var io = new IntersectionObserver(function (es) {
            es.forEach(function (en) {
              if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
            });
          }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
          $$(".rv").forEach(function (e) { io.observe(e); });

          var co = new IntersectionObserver(function (es) {
            es.forEach(function (en) {
              if (en.isIntersecting) { count(en.target); co.unobserve(en.target); }
            });
          }, { threshold: 0.6 });
          $$("[data-count]").forEach(function (e) { co.observe(e); });
          function count(el) {
            var to = parseInt(el.getAttribute("data-count"), 10),
              sfx = el.getAttribute("data-suffix") || "",
              t0 = null;
            function fr(ts) {
              if (!t0) t0 = ts;
              var p = Math.min((ts - t0) / 900, 1);
              el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + sfx;
              if (p < 1) requestAnimationFrame(fr);
            }
            requestAnimationFrame(fr);
          }

          var ch = new IntersectionObserver(function (es) {
            es.forEach(function (en) { if (en.isIntersecting) { playChat(); ch.disconnect(); } });
          }, { threshold: 0.25 });
          ch.observe($("#chat"));
        })();

        var chatPlayed = false;
        function playChat() {
          if (chatPlayed) return;
          chatPlayed = true;
          var box = $("#chat"), i = 0;
          function typing() {
            var t = document.createElement("div");
            t.className = "typing";
            t.innerHTML = "<i></i><i></i><i></i>";
            box.appendChild(t);
            return t;
          }
          function step() {
            if (i >= CHAT.length) return;
            var m = CHAT[i], t = null, wait = m[0] === "them" ? 900 : 600;
            if (m[0] !== "tag") t = typing();
            setTimeout(function () {
              if (t) t.remove();
              var d = document.createElement("div");
              d.className = "msg " + m[0];
              d.textContent = m[1];
              box.appendChild(d);
              requestAnimationFrame(function () { d.classList.add("in"); });
              i++;
              setTimeout(step, 520);
            }, wait);
          }
          step();
        }

        /* ───────── smooth anchor scroll with header offset ───────── */
        $$("[data-go]").forEach(function (a) {
          a.addEventListener("click", function (e) {
            var id = a.getAttribute("href");
            if (!id || id.charAt(0) !== "#") return;
            var el = $(id);
            if (!el) return;
            e.preventDefault();
            /* on phones the form lives in a bottom sheet — open it instead of jumping */
            if (id === "#slot" && Sheet && Sheet.mobile()) {
              Sheet.open();
              return;
            }
            buzz(8);
            var top =
              el.getBoundingClientRect().top +
              window.pageYOffset -
              $("header").offsetHeight -
              8;
            window.scrollTo({ top: top, behavior: "smooth" });
            history.replaceState(null, "", id);
          });
        });

        /* ───────── scroll progress + bottom bar visibility ───────── */
        (function () {
          var p = $("#progress"), bar = $("#bar"), last = 0, ticking = false;
          function upd() {
            var h = document.documentElement.scrollHeight - window.innerHeight;
            var y = window.pageYOffset;
            p.style.width = (h > 0 ? Math.min((y / h) * 100, 100) : 0) + "%";
            var slotBox = $("#slot").getBoundingClientRect();
            var inForm = slotBox.top < window.innerHeight * 0.75 && slotBox.bottom > 120;
            var sheetOpen = Sheet && Sheet.isOpen();
            bar.classList.toggle("hide", sheetOpen || inForm || y < 40);
            last = y;
            ticking = false;
          }
          window.addEventListener("scroll", function () {
            if (!ticking) { requestAnimationFrame(upd); ticking = true; }
          }, { passive: true });
          window.addEventListener("resize", upd);
          upd();
        })();

        /* ════════════════════════════════════════════════════════════
   WIZARD
   ════════════════════════════════════════════════════════════ */
        var wizard = (function () {
          var VOLS = ["Under 50", "50 – 200", "200+", "We don't track it yet"];
          var SRCS = [
            "Meta / Instagram ads",
            "Google ads",
            "JustDial, IndiaMART & similar",
            "Website enquiries",
            "Referrals & walk-ins",
          ];
          var SPENDS = [
            "Under ₹25k",
            "₹25k – 75k",
            "₹75k – 2L",
            "Nothing right now",
          ];
          /* Project size bands. Interior work clusters below ₹15L, so the two
             bands that decide whether this pays back sit in the middle — a
             single "₹3–8L" bucket hid that. Labels are also what score() and
             the sales _subject line read, so they must match exactly. */
          var TICKETS = [
            "Under ₹5 lakh",
            "₹5 – 15 lakh",
            "₹15 – 25 lakh",
            "₹25 – 50 lakh",
            "₹50 lakh+",
          ];
          var SYSTEMS = [
            "Excel / notebook",
            "WhatsApp only",
            "A CRM",
            "Nothing fixed",
          ];
          /* Business type, not product category — the values sales routes on.
             Multi-select: most owners run more than one segment (residential +
             turnkey is the norm), and forcing one answer made them under-report
             what they can actually take on. The payload key stays `segment` so
             Formspree filters, the _subject line and every lead_* analytics
             param keep working — it is joined to a string in payload(). */
          var SEGS = [
            "Residential",
            "Commercial",
            "Industrial",
            "Turnkey",
            "Sanitary Related",
          ];
          var TIMES = ["This month", "In 1–3 months", "Just exploring"];
          var CAPS = ["Yes, always", "Usually", "No, we're stretched"];
          var ROLES = [
            "Owner / founder",
            "Partner / director",
            "Sales head",
            "Team member",
          ];
          var NAMES = [
            "VOLUME",
            "LEAD SOURCES",
            "PROJECT SIZE",
            "AREA & TIMING",
            "CONTACT",
          ];
          var HELP = [
            "No email, no long form. Contact details come last.",
            "Helps us compare your current cost per client with ours.",
            "Honest answers here mean an honest number on the call.",
            "One slot per city and category. Yours may already be gone.",
            "Used only for this enquiry. Never sold, never shared with your competitors.",
          ];

          var s = {
            step: 1,
            volume: "",
            sources: [],
            spend: "",
            ticket: "",
            system: "",
            city: "",
            segment: [],
            timeline: "",
            capacity: "",
            role: "",
            approver: "",
            business: "",
            name: "",
            phone: "",
            consent: false,
            done: false,
            sentAt: "",
          };
          var dir = 1,
            tracking = {},
            t0 = Date.now();

          /* restore draft */
          try {
            var raw = localStorage.getItem(CONFIG.storageKey);
            if (raw) {
              var d = JSON.parse(raw);
              if (d) {
                Object.keys(s).forEach(function (k) {
                  if (k in d) s[k] = d[k];
                });
                /* A request sent more than 24h ago is treated as history: they get
                   a fresh form. Inside 24h they see "we already have this" instead
                   of silently sending a duplicate. */
                if (d.done) {
                  var age = d.sentAt
                    ? Date.now() - new Date(d.sentAt).getTime()
                    : NaN;
                  if (!(age >= 0 && age < 864e5)) {
                    s.done = false;
                    s.step = 1;
                    s.sentAt = "";
                  }
                }
                /* Old drafts carry retired answers — a single-choice segment
                   string, or a project band from the previous ladder. They pass
                   valid() but match no button, so the visitor would see an
                   unanswered step and submit a dead value. Migrate what still
                   exists, drop what doesn't, and re-ask. */
                if (typeof s.segment === "string")
                  s.segment = s.segment ? [s.segment] : [];
                if (!Array.isArray(s.segment)) s.segment = [];
                s.segment = s.segment.filter(function (v) {
                  return SEGS.indexOf(v) > -1;
                });
                if (s.ticket && TICKETS.indexOf(s.ticket) === -1) s.ticket = "";
                /* Clearing an answer on a step they had already passed would
                   otherwise sail through — valid() is only checked on the step
                   in front of them. Walk them back to the earliest step that is
                   now unanswered so nothing reaches sales blank. */
                if (!s.ticket && s.step > 3) s.step = 3;
                else if (!s.segment.length && s.step > 4) s.step = 4;
              }
            }
          } catch (e) {}

          try {
            var q = new URLSearchParams(location.search);
            tracking = {
              utm_source: q.get("utm_source") || "",
              utm_medium: q.get("utm_medium") || "",
              utm_campaign: q.get("utm_campaign") || "",
              utm_content: q.get("utm_content") || "",
              gclid: q.get("gclid") || "",
              fbclid: q.get("fbclid") || "",
              landedAt: new Date().toISOString(),
              referrer: document.referrer || "",
            };
          } catch (e) {
            tracking = {};
          }

          function save() {
            try {
              localStorage.setItem(CONFIG.storageKey, JSON.stringify(s));
            } catch (e) {}
          }

          function digits(v) {
            return (v || "").replace(/\D/g, "");
          }
          /* Indian mobiles are 10 digits starting 6-9. People paste +91, 0091 and
             leading zeros — strip those rather than rejecting a valid number. */
          function mobile10(v) {
            var d = digits(v).replace(/^0+/, ""); // 0…, 00… trunk/IDD prefixes
            if (d.length > 10 && d.indexOf("91") === 0) d = d.slice(2);
            return d;
          }
          /* 9999999999 and 9876543210 are valid on paper and fake in practice —
             one repeated digit, or a straight run up or down the keypad. */
          function allSame(w) {
            for (var i = 1; i < w.length; i++) if (w[i] !== w[0]) return false;
            return true;
          }
          function tripled(w) {
            for (var i = 2; i < w.length; i++)
              if (w[i] === w[i - 1] && w[i] === w[i - 2]) return true;
            return false;
          }
          var ASC = "01234567890123456789",
            DESC = "98765432109876543210";
          function runOrRepeat(d) {
            /* doubled ladders so wrap-arounds like 6789012345 count as runs too */
            return allSame(d) || ASC.indexOf(d) > -1 || DESC.indexOf(d) > -1;
          }
          function phoneOk(v) {
            var d = mobile10(v);
            return d.length === 10 && /^[6-9]/.test(d) && !runOrRepeat(d);
          }

          /* Keyboard mash, cheaply: real words in every Indian language written
             in Latin script carry a vowel, never run a letter three times, and
             are not a slice of one keyboard row. Catches asdf / qwerty / sdfgh /
             aaaa without a dictionary. It is a filter, not a proof — "Xyz Ltd"
             would be rejected and a determined faker types "abcd" and passes. */
          var ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
          function mash(v) {
            var w = String(v).toLowerCase().replace(/[^a-z]/g, "");
            if (w.length < 2) return true;
            if (!/[aeiou]/.test(w)) return true;
            if (tripled(w)) return true;
            return ROWS.some(function (r) {
              return r.indexOf(w) > -1;
            });
          }
          /* People's names: letters plus the joiners real names use. No digits,
             no symbols — "Name 123" and "..." are not names. */
          function nameOk(v) {
            v = String(v || "").trim();
            return v.length >= 2 && v.length <= 40 &&
              /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ .'-]*$/.test(v) &&
              !mash(v);
          }
          /* Business names legitimately carry digits and & — "3D Interiors",
             "S&K Decor" — so only the letter core is checked for mash. */
          function bizOk(v) {
            v = String(v || "").trim();
            return v.length >= 2 && v.length <= 60 &&
              /^[A-Za-z0-9À-ɏ][A-Za-z0-9À-ɏ &.,'-]*$/.test(v) &&
              (v.match(/[A-Za-zÀ-ɏ]/g) || []).length >= 2 &&
              !mash(v);
          }
          /* No whitelist: our SLOTS list is four cities and the market is tier-2. */
          function cityOk(v) {
            v = String(v || "").trim();
            return v.length >= 3 && v.length <= 30 &&
              /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ -]*$/.test(v) &&
              !mash(v);
          }
          /* ponytail: this funnel has no email field ("No email, no long form") —
             nothing calls this yet. Wire it to the input if one is ever added. */
          function emailOk(v) {
            return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(v || "").trim());
          }

          function valid(step) {
            if (step === 1) return !!s.volume;
            if (step === 2) return s.sources.length > 0 && !!s.spend;
            if (step === 3) return !!s.ticket && !!s.system;
            if (step === 4)
              return (
                cityOk(s.city) &&
                s.segment.length > 0 &&
                !!s.timeline &&
                !!s.capacity
              );
            var approverOk = s.role !== "Team member" || nameOk(s.approver);
            return (
              !!s.role &&
              approverOk &&
              bizOk(s.business) &&
              nameOk(s.name) &&
              phoneOk(s.phone) &&
              s.consent === true
            );
          }

          function missing(step) {
            if (step === 1) return "Pick one option to continue.";
            if (step === 2)
              return s.sources.length
                ? "Pick your monthly ad spend."
                : "Select at least one lead source.";
            if (step === 3)
              return !s.ticket
                ? "Pick a typical project value."
                : "Tell us how follow-up is handled.";
            if (step === 4) {
              if (!s.city.trim()) return "Enter your city.";
              if (!cityOk(s.city)) return "Enter a real city name.";
              if (!s.segment.length)
                return "Pick at least one segment you deal in.";
              if (!s.timeline) return "Pick a timeline.";
              return "Answer the 48-hour visit question.";
            }
            if (!s.role) return "Tell us your role.";
            if (s.role === "Team member" && !nameOk(s.approver))
              return "Add the full name of who signs off.";
            if (!bizOk(s.business)) return "Enter your real business name.";
            if (!nameOk(s.name)) return "Enter your full name.";
            if (!phoneOk(s.phone))
              return "Enter a valid 10-digit mobile number.";
            return "Please tick the consent box so we can call you.";
          }

          function esc(t) {
            return String(t).replace(/[&<>"]/g, function (c) {
              return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[
                c
              ];
            });
          }

          function optList(items, key, opts) {
            opts = opts || {};
            return items
              .map(function (label) {
                var on = opts.multi
                  ? s[key].indexOf(label) > -1
                  : s[key] === label;
                return (
                  '<button type="button" class="opt' +
                  (opts.sm ? " sm" : "") +
                  (on ? " on" : "") +
                  '" data-key="' +
                  key +
                  '" data-val="' +
                  esc(label) +
                  '"' +
                  (opts.multi ? ' data-multi="1"' : "") +
                  ' aria-pressed="' +
                  on +
                  '">' +
                  (opts.multi
                    ? '<span class="box">' + (on ? "✓" : "") + "</span>"
                    : "") +
                  "<span>" +
                  esc(label) +
                  "</span>" +
                  (opts.mark ? '<span class="mark">SELECTED</span>' : "") +
                  "</button>"
                );
              })
              .join("");
          }

          function approverField() {
            return (
              '<input class="field reveal" id="fApprover" value="' +
              esc(s.approver) +
              '" aria-label="Who signs off" placeholder="Who signs off? Name &amp; designation" style="margin-bottom:11px">'
            );
          }

          function body() {
            if (s.step === 1)
              return (
                "" +
                '<div class="q">How many enquiries land with you in a month?</div>' +
                '<div class="qs">Ads, platforms, website — sab milaake.</div>' +
                '<div class="opts">' +
                optList(VOLS, "volume", { mark: true }) +
                "</div>"
              );

            if (s.step === 2)
              return (
                "" +
                '<div class="q">Where do those enquiries come from?</div>' +
                '<div class="qs">Pick all that apply — this tells us what you\'re spending on today.</div>' +
                '<div class="opts">' +
                optList(SRCS, "sources", { multi: true, sm: true }) +
                "</div>" +
                '<div class="qs2">What do you spend a month on ads and paid leads?</div>' +
                '<div class="opts wrap">' +
                optList(SPENDS, "spend", { sm: true }) +
                "</div>"
              );

            if (s.step === 3)
              return (
                "" +
                '<div class="q">What size project do you usually take?</div>' +
                '<div class="qs">Your average project size decides whether this pays for itself in one deal or ten. Pick the band most of your work falls in.</div>' +
                '<div class="opts">' +
                optList(TICKETS, "ticket", { mark: true, sm: true }) +
                "</div>" +
                '<div class="qs2">How is follow-up handled today?</div>' +
                '<div class="opts wrap">' +
                optList(SYSTEMS, "system", { sm: true }) +
                "</div>"
              );

            if (s.step === 4)
              return (
                "" +
                '<div class="q">Where do you work, and what do you build?</div>' +
                '<div class="qs">Slots are held city by city, category by category.</div>' +
                '<input class="field" id="fCity" aria-label="Your city" value="' +
                esc(s.city) +
                '" placeholder="City — e.g. Gurugram" autocomplete="address-level2" style="margin-bottom:16px">' +
                '<div class="qs2" style="margin-top:0">What do you deal in?</div>' +
                '<div class="qs">Pick all that apply — most businesses run more than one segment, and we hold your slot in each.</div>' +
                '<div class="opts wrap" style="margin-bottom:4px">' +
                optList(SEGS, "segment", { multi: true, sm: true }) +
                "</div>" +
                '<div class="qs2">How soon do you want this running?</div>' +
                '<div class="opts wrap">' +
                optList(TIMES, "timeline", { sm: true }) +
                "</div>" +
                '<div class="qs2">Can your team visit a client\'s site within 48 hours?</div>' +
                '<div class="qs">Honest answer, please — it decides whether we can help you at all.</div>' +
                '<div class="opts wrap">' +
                optList(CAPS, "capacity", { sm: true }) +
                "</div>"
              );

            return (
              "" +
              '<div class="q">Last bit — who do we speak to?</div>' +
              '<div class="qs">We only call the person who can actually say yes. One call, no automated spam.</div>' +
              '<div class="opts wrap" style="margin-bottom:16px">' +
              optList(ROLES, "role", { sm: true }) +
              "</div>" +
              /* The approver field appears and disappears with the role answer.
                 It lives in a permanent wrapper that is filled in place — see
                 syncApprover(). Re-rendering the whole step to reveal it made
                 the form flash and replay its slide-in, which reads as a page
                 reload and, inside the mobile sheet, threw the visitor back to
                 the top of the step. */
              '<div id="approverWrap">' +
              (s.role === "Team member" ? approverField() : "") +
              "</div>" +
              '<div class="opts">' +
              '<input class="field" id="fBusiness" aria-label="Business name" value="' +
              esc(s.business) +
              '" placeholder="Business name" autocomplete="organization">' +
              '<input class="field" id="fName" aria-label="Your name" value="' +
              esc(s.name) +
              '" placeholder="Your name" autocomplete="name">' +
              '<input class="field" id="fPhone" aria-label="Mobile number" value="' +
              esc(s.phone) +
              '" type="tel" inputmode="numeric" placeholder="Mobile (WhatsApp)" autocomplete="tel" maxlength="17">' +
              "</div>" +
              /* Explicit, unticked consent — required under DPDP and by Meta/Google
                 ad policy before we call or WhatsApp them. The policy link sits
                 OUTSIDE the button: an <a> can't nest inside a <button> — invalid
                 HTML, and the tap would toggle the checkbox instead of navigating. */
              '<button type="button" id="fConsent" class="consent' +
              (s.consent ? " on" : "") +
              '" aria-pressed="' +
              (s.consent ? "true" : "false") +
              '"><span class="box">' +
              (s.consent ? "✓" : "") +
              "</span><span>I agree that Interior bazzar may call and WhatsApp me about this enquiry.</span></button>" +
              '<div class="consent-fine">My details are used only for this enquiry, never sold. See our <a href="https://www.interiorbazzar.com/privacy-policy" target="_blank" rel="noopener">Privacy Policy</a> &amp; <a href="https://www.interiorbazzar.com/terms-and-conditions" target="_blank" rel="noopener">Terms</a>.</div>'
            );
          }

          function doneView() {
            var city = s.city.trim() || "your area";
            var rows = [
              ["Business", s.business],
              ["Contact", s.name + " · " + s.phone],
              ["City", s.city],
              ["Deals in", s.segment.join(" · ")],
              ["Monthly enquiries", s.volume],
              ["Typical project", s.ticket],
              ["Start", s.timeline],
            ].filter(function (r) {
              return r[1];
            });
            return (
              '<div class="done">' +
              '<div class="tick">✓</div>' +
              '<h2 style="text-align:center;margin-bottom:8px">Checking ' +
              esc(city) +
              " for you.</h2>" +
              '<p class="lead" style="text-align:center">A senior member of our team will call you within one working hour with a straight answer on availability — and the founding price for your area.</p>' +
              '<div class="card" style="text-align:left">' +
              '<div class="kicker">WHAT WE\'LL DISCUSS</div>' +
              '<div class="stack" style="gap:8px">' +
              '<div style="font:400 12.5px/1.55 Archivo;color:#c2c2c2">Whether ' +
              esc(city) +
              " still has an open slot in your category</div>" +
              '<div style="font:400 12.5px/1.55 Archivo;color:#c2c2c2">Realistic monthly numbers for your area — before you pay anything</div>' +
              '<div style="font:400 12.5px/1.55 Archivo;color:#c2c2c2">Which plan fits, and your founding discount</div>' +
              "</div>" +
              '<div style="margin-top:13px;border-top:1px solid var(--line3);padding-top:12px;font:400 12px/1.6 Archivo;color:var(--mut)">Keep your portfolio and average project value handy. The call takes about 12 minutes.</div>' +
              "</div>" +
              '<div class="summary">' +
              '<div class="kicker" style="margin-bottom:8px">YOUR ANSWERS</div>' +
              rows
                .map(function (r) {
                  return (
                    '<div class="r"><span>' +
                    r[0] +
                    "</span><b>" +
                    esc(r[1]) +
                    "</b></div>"
                  );
                })
                .join("") +
              "</div>" +
              (CONFIG.phoneLabel
                ? '<div class="whocalls"><span>We will call you from</span><b>' +
                  CONFIG.phoneLabel +
                  "</b><span>Save it so you don't miss the call.</span></div>"
                : "") +
              (callNumber()
                ? '<button type="button" class="btn btn-primary" id="waBtn" style="margin-top:16px">Send on WhatsApp too →</button>'
                : "") +
              /* Call now sits directly under WhatsApp — full width, same 10px
                 rhythm as the buttons around it, so the two channels read as
                 one pair and "start a new enquiry" stays visibly tertiary. */
              (callNumber()
                ? '<a class="btn btn-call" id="callBtn" style="margin-top:10px" href="tel:' +
                  callNumber() +
                  '">Call now · ' +
                  callLabel() +
                  "</a>"
                : "") +
              '<button type="button" class="btn btn-ghost" id="againBtn" style="margin-top:10px">Start a new enquiry</button>' +
              "</div>"
            );
          }

          function render() {
            var el = $("#wizard");
            if (s.done) {
              el.innerHTML = doneView();
              bindDone();
              syncBar();
              return;
            }
            el.innerHTML =
              '<div class="wz-intro">' +
              '<div class="kicker">CHECK SLOT AVAILABILITY</div>' +
              "<h2>Is your area still open?</h2>" +
              '<p class="lead">Five quick steps. We only take on businesses we can genuinely fill a pipeline for — so these answers decide whether we call you at all.</p>' +
              "</div>" +
              '<div class="bars">' +
              [1, 2, 3, 4, 5]
                .map(function (i) {
                  return '<i class="' + (s.step >= i ? "on" : "") + '"></i>';
                })
                .join("") +
              "</div>" +
              '<div class="steprow"><span>STEP ' +
              s.step +
              " OF 5</span><span>" +
              NAMES[s.step - 1] +
              "</span></div>" +
              '<div class="step' +
              (dir < 0 ? " rev" : "") +
              '" id="stepBody">' +
              body() +
              "</div>" +
              '<div class="nav">' +
              (s.step > 1
                ? '<button type="button" class="btn back" id="backBtn">Back</button>'
                : "") +
              '<button type="button" class="btn btn-primary' +
              (valid(s.step) ? "" : " off") +
              '" id="nextBtn">' +
              (s.step === 5 ? "Check my area & lock 12% off →" : "Continue →") +
              "</button>" +
              "</div>" +
              '<div class="helper">' +
              HELP[s.step - 1] +
              "</div>";
            bind();
            syncBar();
          }

          function bindText(el, key) {
            if (!el) return;
            el.addEventListener("input", function () {
              markStart();
              s[key] = el.value;
              el.classList.remove("err");
              save();
              refreshCta();
            });
          }

          function onEnter(e) {
            if (e.key === "Enter") {
              e.preventDefault();
              next();
            }
          }

          /* Show or hide the approver field in place — no re-render, so the
             answered options, the step's scroll position and any open keyboard
             all survive. Switching away from "Team member" also clears the
             answer, otherwise a name typed by mistake still reaches sales. */
          function syncApprover() {
            var wrap = $("#approverWrap");
            if (!wrap) return;
            var need = s.role === "Team member",
              has = !!$("#fApprover");
            if (need === has) return;
            if (need) {
              wrap.innerHTML = approverField();
              var el = $("#fApprover");
              bindText(el, "approver");
              el.addEventListener("keydown", onEnter);
            } else {
              wrap.innerHTML = "";
              s.approver = "";
            }
          }

          function bind() {
            $$("#wizard .opt").forEach(function (b) {
              b.addEventListener("click", function () {
                var k = b.getAttribute("data-key"),
                  v = b.getAttribute("data-val");
                buzz(10);
                markStart();
                if (b.hasAttribute("data-multi")) {
                  var i = s[k].indexOf(v);
                  if (i > -1) s[k].splice(i, 1);
                  else s[k].push(v);
                  b.classList.toggle("on");
                  b.setAttribute(
                    "aria-pressed",
                    String(b.classList.contains("on")),
                  );
                  $(".box", b).textContent = b.classList.contains("on")
                    ? "✓"
                    : "";
                } else {
                  s[k] = v;
                  $$('#wizard .opt[data-key="' + k + '"]').forEach(
                    function (o) {
                      var on = o === b;
                      o.classList.toggle("on", on);
                      o.setAttribute("aria-pressed", String(on));
                    },
                  );
                  if (k === "role") syncApprover();
                }
                save();
                refreshCta();
              });
            });

            [
              ["#fCity", "city"],
              ["#fApprover", "approver"],
              ["#fBusiness", "business"],
              ["#fName", "name"],
            ].forEach(function (p) {
              bindText($(p[0]), p[1]);
            });
            var ph = $("#fPhone");
            if (ph) {
              ph.addEventListener("input", function () {
                markStart();
                var d = mobile10(ph.value).slice(0, 10);
                var out = d.length > 5 ? d.slice(0, 5) + " " + d.slice(5) : d;
                ph.value = out;
                s.phone = out;
                ph.classList.remove("err");
                save();
                refreshCta();
              });
            }
            $$("#wizard .field").forEach(function (f) {
              f.addEventListener("keydown", onEnter);
            });

            var cs = $("#fConsent");
            if (cs) {
              cs.addEventListener("click", function () {
                markStart();
                s.consent = !s.consent;
                cs.classList.toggle("on", s.consent);
                cs.setAttribute("aria-pressed", String(s.consent));
                $(".box", cs).textContent = s.consent ? "✓" : "";
                buzz(10);
                save();
                refreshCta();
              });
            }

            var nb = $("#nextBtn");
            if (nb) nb.addEventListener("click", next);
            var bb = $("#backBtn");
            if (bb) bb.addEventListener("click", back);
          }

          function bindDone() {
            var again = $("#againBtn");
            if (again)
              again.addEventListener("click", function () {
                s.step = 1;
                s.done = false;
                s.volume = "";
                s.sources = [];
                s.spend = "";
                s.ticket = "";
                s.system = "";
                s.city = "";
                s.segment = [];
                s.timeline = "";
                s.capacity = "";
                s.role = "";
                s.approver = "";
                s.business = "";
                s.name = "";
                s.phone = "";
                s.consent = false;
                s.sentAt = "";
                save();
                dir = -1;
                render();
                scrollToForm();
              });
            /* Both post-submission channels are tracked, so the success screen
               reports which one a converted lead actually reaches for. */
            var wa = $("#waBtn");
            if (wa)
              wa.addEventListener("click", function () {
                track("ib_wa_click", { where: "success", lead_tier: tier() });
                openWhatsApp();
              });
            var cb = $("#callBtn");
            if (cb)
              cb.addEventListener("click", function () {
                track("ib_call_click", {
                  where: "success",
                  lead_tier: tier(),
                  call_number: callNumber(),
                });
                buzz(10);
              });
          }

          function refreshCta() {
            var b = $("#nextBtn");
            if (!b) return;
            b.classList.toggle("off", !valid(s.step));
          }

          function scrollToForm() {
            if (Sheet && Sheet.isOpen()) {
              Sheet.toTop();
              return;
            }
            var top =
              $("#slot").getBoundingClientRect().top +
              window.pageYOffset -
              $("header").offsetHeight -
              8;
            window.scrollTo({ top: top, behavior: "smooth" });
          }

          function flagEmpty() {
            var map = {
              4: [["#fCity", "city"]],
              5: [
                ["#fApprover", "approver"],
                ["#fBusiness", "business"],
                ["#fName", "name"],
                ["#fPhone", "phone"],
              ],
            };
            (map[s.step] || []).forEach(function (p) {
              var el = $(p[0]);
              if (!el) return;
              /* approver only counts when their role demands one */
              var chk = {
                phone: phoneOk,
                city: cityOk,
                business: bizOk,
                approver: function (v) {
                  return s.role !== "Team member" || nameOk(v);
                },
                name: nameOk,
              }[p[1]];
              var bad = !chk(s[p[1]]);
              el.classList.toggle("err", bad);
            });
          }

          /* Lead value for value-based bidding: project size is the strongest signal,
     nudged by whether they can actually service a visit and how soon. */
          function score() {
            var v = 0;
            v +=
              {
                "Under ₹5 lakh": 0,
                "₹5 – 15 lakh": 2,
                "₹15 – 25 lakh": 3,
                "₹25 – 50 lakh": 4,
                "₹50 lakh+": 5,
              }[s.ticket] || 0;
            v +=
              { "This month": 3, "In 1–3 months": 1, "Just exploring": 0 }[
                s.timeline
              ] || 0;
            v +=
              { "Yes, always": 2, Usually: 1, "No, we're stretched": -1 }[
                s.capacity
              ] || 0;
            v +=
              {
                "200+": 2,
                "50 – 200": 1,
                "Under 50": 0,
                "We don't track it yet": 0,
              }[s.volume] || 0;
            v +=
              s.role === "Owner / founder" || s.role === "Partner / director"
                ? 2
                : 0;
            return v;
          }
          function tier() {
            var v = score();
            return v >= 10 ? "A" : v >= 6 ? "B" : "C";
          }
          function valueFor(t) {
            return t === "A" ? 6000 : t === "B" ? 3000 : 1000;
          }

          var started = false;
          function markStart() {
            if (!started) {
              started = true;
              track("ib_form_start", { step: s.step });
            }
          }

          function next() {
            if (!valid(s.step)) {
              var b = $("#stepBody");
              b.classList.remove("shake");
              void b.offsetWidth;
              b.classList.add("shake");
              flagEmpty();
              toast(missing(s.step));
              buzz([12, 60, 12]);
              track("ib_step_blocked", { step: s.step });
              return;
            }
            buzz(14);
            if (s.step === 5) {
              submit();
              return;
            }
            dir = 1;
            s.step++;
            save();
            render();
            scrollToForm();
            track("ib_step_view", {
              step: s.step,
              step_name: NAMES[s.step - 1],
            });
          }

          function back() {
            if (s.step <= 1) return;
            buzz(8);
            dir = -1;
            s.step--;
            save();
            render();
            scrollToForm();
            track("ib_step_back", { step: s.step });
          }

          function payload() {
            var o = {};
            Object.keys(s).forEach(function (k) {
              o[k] = s[k];
            });
            delete o.step;
            delete o.done;
            o.sources = s.sources.join(", ");
            o.segment = s.segment.join(", ");
            o.phone = "+91" + mobile10(s.phone);
            o.consent = s.consent ? "yes" : "no";
            o.submittedAt = new Date().toISOString();
            o.page = location.href;
            /* Formspree: a dedicated tag field plus a subject line that leads
               with it, so sales can tell at a glance this came from the Elite
               funnel and isn't mixed in with generic-funnel mail. */
            o.lead_tag = "Elite Lead";
            o.funnel = FUNNEL_ID;
            o.lead_tier = tier();
            o.lead_score = score();
            o.routed_phone = routedPhone || "";
            o.lead_for = routedLeadOwner();
            o._subject =
              "🟡 ELITE LEAD · " +
              (s.business || "Unknown business") +
              " · " +
              (s.city || "city?") +
              " · " +
              (s.ticket || "") +
              " · tier " +
              tier();
            Object.keys(tracking).forEach(function (k) {
              o[k] = tracking[k];
            });
            return o;
          }

          function waText() {
            var p = payload();
            return (
              "🟡 ELITE LEAD — new slot check\n" +
              "Business: " +
              p.business +
              "\nName: " +
              p.name +
              "\nPhone: " +
              p.phone +
              "\nCity: " +
              p.city +
              "\nDeals in: " +
              p.segment +
              "\nEnquiries/mo: " +
              p.volume +
              "\nSources: " +
              p.sources +
              "\nAd spend: " +
              p.spend +
              "\nTypical project: " +
              p.ticket +
              "\nFollow-up: " +
              p.system +
              "\nStart: " +
              p.timeline +
              "\n48h visit: " +
              p.capacity +
              "\nRole: " +
              p.role +
              (p.approver ? "\nApprover: " + p.approver : "")
            );
          }

          /* Number behind every call AND WhatsApp button, most specific first:
             a pinned CONFIG.phone, then the rep (rajni/seema) this lead was
             routed to, then the rep stored on the last submission (a reload
             clears `routedPhone` but the success screen still has to dial
             someone). No desk fallback — every lead belongs to one of the two. */
          function callNumber() {
            var p = (CONFIG.phone || routedPhone || "").replace(/\D/g, "");
            if (!p) {
              try {
                var last = JSON.parse(
                  localStorage.getItem(CONFIG.storageKey + "_last") || "null",
                );
                p = ((last && last.routed_phone) || "").replace(/\D/g, "");
              } catch (e) {}
            }
            if (!p) return "";
            if (p.length === 10) p = "91" + p;
            return "+" + p;
          }
          function callLabel() {
            if (CONFIG.phoneLabel) return CONFIG.phoneLabel;
            var n = callNumber(),
              d = n.replace(/^\+91/, "");
            return d.length === 10
              ? "+91 " + d.slice(0, 5) + " " + d.slice(5)
              : n;
          }

          function openWhatsApp() {
            var n = callNumber().replace(/\D/g, "");
            if (!n) {
              toast("No number available yet.");
              return;
            }
            window.open(
              "https://wa.me/" + n + "?text=" + encodeURIComponent(waText()),
              "_blank",
              "noopener",
            );
          }

          /* One in-flight submission at a time. Without this guard a second tap
             before the response lands sends a duplicate lead AND a duplicate
             conversion to Ads/Meta. */
          var sending = false;

          function submit() {
            if (sending || s.done) return;
            sending = true;
            var btn = $("#nextBtn");
            if (btn) {
              btn.textContent = "Sending…";
              btn.classList.add("off");
            }
            var fail = $("#sendFail");
            if (fail) fail.remove();

            /* The deal is created here and nowhere else — once per actual
               submission, which is also the only thing that advances the premium
               rotation. The routed rep comes back on that same call, so the
               payload is stamped with it before anything else reads it. */
            var data = payload();
            /* TWO channels, one lead. The pipeline is the real destination;
               Formspree is an inbox copy. The visitor sees a failure only when
               BOTH refuse — Formspree's spam filter marks real leads often
               enough that letting it decide alone told people their slot check
               had failed while the deal was already in the pipeline. */
            var dealOk = false;
            createDeal(data).then(
              function () { dealOk = true; },
              function (err) {
                /* Not silent any more: a lead that only exists in the inbox is
                   a lead nobody is routed to. */
                track("ib_deal_error", { reason: (err && err.message) || "network", step: 5 });
              },
            ).then(function () {
              data.routed_phone = routedPhone || "";
              data.lead_for = routedLeadOwner();
              data.deal_ref = dealRef;
            window.__ibLead = data;
            try {
              localStorage.setItem(
                CONFIG.storageKey + "_last",
                JSON.stringify(data),
              );
            } catch (e) {}

            /* Conversions fire ONLY on a delivered lead. Reporting one that never
               arrived teaches Google and Meta to buy more traffic that doesn't
               convert, and tells the visitor we have their number when we don't. */
            function succeeded() {
              sending = false;
              s.done = true;
              s.sentAt = new Date().toISOString();
              save();
              render();
              scrollToForm();
              toast(
                "Request received. We'll call within one working hour.",
                3400,
              );
              var t = tier(),
                leadValue = valueFor(t);
              track("ib_lead_submit", {
                conversion: true,
                currency: "INR",
                value: leadValue,
                lead_tier: t,
                lead_score: score(),
                lead_city: data.city,
                lead_segment: data.segment,
                lead_volume: data.volume,
                lead_ticket: data.ticket,
                lead_spend: data.spend,
                lead_sources: data.sources,
                lead_system: data.system,
                lead_timeline: data.timeline,
                lead_capacity: data.capacity,
                lead_role: data.role,
                form_seconds: Math.round((Date.now() - t0) / 1000),
              });
              try {
                if (window.fbq)
                  fbq("track", "Lead", { value: leadValue, currency: "INR" });
              } catch (e) {}
              try {
                if (window.gtag)
                  gtag("event", "generate_lead", {
                    currency: "INR",
                    value: leadValue,
                  });
              } catch (e) {}
            }

            /* Failure is shown AS failure. Answers stay on the device, the button
               becomes Retry, and WhatsApp / phone are offered as second channels. */
            function failed(reason) {
              sending = false;
              save();
              track("ib_lead_error", { reason: reason || "network", step: 5 });
              var b = $("#nextBtn");
              if (b) {
                b.textContent = "Retry — send my slot check";
                b.classList.remove("off");
              }
              var host = $("#stepBody");
              if (host && !$("#sendFail")) {
                var d = document.createElement("div");
                d.id = "sendFail";
                d.className = "fail";
                d.innerHTML =
                  "<b>That didn't go through.</b> Your answers are saved — tap retry, or send them to us directly and we'll take it from there.";
                if (callNumber()) {
                  var wa = document.createElement("button");
                  wa.type = "button";
                  wa.className = "btn btn-primary";
                  wa.style.marginTop = "12px";
                  wa.textContent = "Send on WhatsApp instead →";
                  wa.addEventListener("click", openWhatsApp);
                  d.appendChild(wa);
                }
                if (callNumber()) {
                  var cl = document.createElement("a");
                  cl.className = "btn btn-call";
                  cl.style.marginTop = "10px";
                  cl.href = "tel:" + callNumber();
                  cl.textContent = "Or call us: " + callLabel();
                  cl.addEventListener("click", function () {
                    track("ib_call_click", { where: "send_failure" });
                  });
                  d.appendChild(cl);
                }
                host.appendChild(d);
              }
            }

            if (!CONFIG.leadEndpoint) {
              setTimeout(dealOk ? succeeded : function () { failed("no_endpoint"); }, 450);
              return;
            }

            /* Deal is in the pipeline: the visitor is done waiting. The inbox
               copy still goes out, unwatched — it can no longer cost us a lead
               we already have. */
            if (dealOk) {
              try {
                fetch(CONFIG.leadEndpoint, {
                  method: "POST",
                  headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(data),
                  keepalive: true,
                }).catch(function () {});
              } catch (e) {}
              succeeded();
              return;
            }

            /* The pipeline refused it, so Formspree is the only channel left and
               it decides. */
            var settled = false,
              timer = setTimeout(function () {
                if (!settled) {
                  settled = true;
                  failed("timeout");
                }
              }, 12000);
            /* fetch() only rejects on a network failure — a 4xx/5xx from Formspree
               resolves normally, so r.ok is what decides success. */
            fetch(CONFIG.leadEndpoint, {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(data),
            })
              .then(function (r) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (r.ok) succeeded();
                else failed("http_" + r.status);
              })
              .catch(function () {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                failed("network");
              });
            });
          }

          function syncBar() {
            var t = $("#barTxt"),
              c = $("#barCta");
            if (s.done) {
              t.textContent =
                "Request received — our team will call you shortly.";
              c.textContent = "Done";
            } else if (s.step > 1) {
              t.textContent =
                "Step " + s.step + " of 5 — finish your slot check";
              c.textContent = "Resume →";
            } else {
              t.textContent = "₹42,480 off · EMI in 3 parts · 1 slot per area";
              c.textContent = "Check my area";
            }

            var st = $("#sheetStep"),
              ti = $("#sheetTitle");
            if (st) {
              if (s.done) {
                ti.textContent = "Request received";
                st.textContent = "WE'LL CALL YOU SHORTLY";
              } else {
                ti.textContent = "Is your area still open?";
                st.textContent =
                  "STEP " + s.step + " OF 5 · " + NAMES[s.step - 1];
              }
            }
            var tn = $("#teaserNote");
            if (tn)
              tn.textContent = s.done
                ? "Request received — our team will call you shortly."
                : s.step > 1
                  ? "You're on step " +
                    s.step +
                    " of 5 — pick up where you left off."
                  : HELP[0];
            var tb = $("#teaserBtn");
            if (tb)
              tb.textContent = s.done
                ? "View your request"
                : s.step > 1
                  ? "Resume step " + s.step + " of 5 →"
                  : "Check if my area is open →";
          }

          render();
          /* Without this the funnel report starts at step 2 and the biggest
             drop-off — step 1 to step 2 — is invisible. */
          if (!s.done) track("ib_step_view", { step: s.step, step_name: NAMES[s.step - 1], first: true });
          return { state: s, render: render };
        })();

        /* ════════════════════════════════════════════════════════════
   MOBILE BOTTOM SHEET — hosts the one and only wizard instance
   ════════════════════════════════════════════════════════════ */
        var Sheet = (function () {
          var sheet = $("#sheet"),
            scrim = $("#scrim"),
            body = $("#sheetBody"),
            host = $("#wizardHost"),
            wiz = $("#wizard"),
            grip = $("#sheetGrip");
          var mq = window.matchMedia("(max-width:599px)");
          var open = false,
            scrollY = 0,
            pushed = false;

          function mobile() {
            return mq.matches;
          }

          /* the wizard element physically moves — never duplicated, so state,
     handlers and the draft stay on one node. */
          function place() {
            var target = mobile() ? body : host;
            if (wiz.parentNode !== target) target.appendChild(wiz);
            if (!mobile() && open) close(true);
          }

          function lock(on) {
            if (on) {
              scrollY = window.pageYOffset;
              document.body.classList.add("locked");
              document.body.style.top = -scrollY + "px";
              document.body.style.position = "fixed";
              document.body.style.width = "100%";
            } else {
              document.body.classList.remove("locked");
              document.body.style.position = "";
              document.body.style.top = "";
              document.body.style.width = "";
              window.scrollTo(0, scrollY);
            }
          }

          function openSheet() {
            if (open || !mobile()) return;
            open = true;
            lock(true);
            sheet.setAttribute("aria-hidden", "false");
            scrim.classList.add("on");
            sheet.classList.add("on");
            $("#bar").classList.add("hide");
            body.scrollTop = 0;
            buzz(12);
            track("ib_modal_open", { step: wizard.state.step });
            try {
              history.pushState({ ibSheet: 1 }, "");
              pushed = true;
            } catch (e) {}
            setTimeout(function () {
              var f = $("#sheetBody .field");
              if (f && !("ontouchstart" in window)) f.focus();
            }, 420);
          }

          function close(silent) {
            if (!open) return;
            open = false;
            scrim.classList.remove("on");
            sheet.classList.remove("on");
            sheet.style.transform = "";
            sheet.classList.remove("drag");
            sheet.setAttribute("aria-hidden", "true");
            lock(false);
            if (pushed && !silent) {
              pushed = false;
              try {
                history.back();
              } catch (e) {}
            } else pushed = false;
            setTimeout(function () {
              place();
              window.dispatchEvent(new Event("resize"));
            }, 380);
          }

          /* android / browser back gesture closes the sheet instead of leaving */
          window.addEventListener("popstate", function () {
            if (open) {
              pushed = false;
              close(true);
            }
          });

          $("#sheetClose").addEventListener("click", function () {
            close();
          });
          scrim.addEventListener("click", function () {
            close();
          });
          document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && open) close();
          });

          /* drag the grip down to dismiss */
          (function () {
            var y0 = null,
              dy = 0;
            function start(e) {
              if (!open) return;
              y0 = e.touches ? e.touches[0].clientY : e.clientY;
              dy = 0;
              sheet.classList.add("drag");
            }
            function move(e) {
              if (y0 === null) return;
              var y = e.touches ? e.touches[0].clientY : e.clientY;
              dy = Math.max(0, y - y0);
              sheet.style.transform = "translateY(" + dy + "px)";
              if (e.cancelable) e.preventDefault();
            }
            function end() {
              if (y0 === null) return;
              y0 = null;
              sheet.classList.remove("drag");
              if (dy > 96) {
                sheet.style.transform = "";
                close();
              } else sheet.style.transform = "";
            }
            grip.addEventListener("touchstart", start, { passive: true });
            grip.addEventListener("touchmove", move, { passive: false });
            grip.addEventListener("touchend", end);
            grip.addEventListener("mousedown", start);
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", end);
          })();

          var rt;
          window.addEventListener("resize", function () {
            clearTimeout(rt);
            rt = setTimeout(place, 150);
          });
          place();

          /* optional one-shot auto-open at a scroll depth (off by default) */
          if (CONFIG.autoOpenAfterPct > 0) {
            var fired = false;
            window.addEventListener(
              "scroll",
              function () {
                if (fired || !mobile() || open || wizard.state.done) return;
                var h =
                  document.documentElement.scrollHeight - window.innerHeight;
                if (
                  h > 0 &&
                  (window.pageYOffset / h) * 100 >= CONFIG.autoOpenAfterPct
                ) {
                  fired = true;
                  try {
                    if (sessionStorage.getItem("ib_sheet_auto")) return;
                    sessionStorage.setItem("ib_sheet_auto", "1");
                  } catch (e) {}
                  openSheet();
                }
              },
              { passive: true },
            );
          }

          return {
            open: openSheet,
            close: close,
            isOpen: function () {
              return open;
            },
            mobile: mobile,
            toTop: function () {
              body.scrollTo({ top: 0, behavior: "smooth" });
            },
          };
        })();

        $("#teaserBtn").addEventListener("click", function () {
          Sheet.open();
        });

        /* keep sticky CTA in sync + warn on unfinished draft leaving */
        window.addEventListener("beforeunload", function (e) {
          var st = wizard.state;
          if (!st.done && st.step > 2 && (st.business || st.name || st.phone)) {
            e.preventDefault();
            e.returnValue = "";
          }
        });

        /* fill wizard city from the lookup box if the user typed one there first */
        $("#lookCity").addEventListener("change", function () {
          if (!wizard.state.city) {
            wizard.state.city = this.value.trim();
            wizard.render();
          }
        });
      })();
