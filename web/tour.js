/**
 * Spotlight overlay over the live app. Hash-route only.
 * Next/Skip/Exit never click, submit, or sign anything in the app.
 */
export const STEPS = [
  { id: "addEvidence", label: "Add sample evidence", route: "#/workspace", selectors: ["#load-sample"], instruction: "Click here to add the investigation's sample file." },
  { id: "viewEvidence", label: "View evidence", route: "#/workspace", selectors: [".lcol > .card.tbl"], instruction: "Open the file that started this investigation." },
  { id: "reviewFinding", label: "Review finding", route: "#/finding", selectors: [".find-card", ".content > .lede.empty"], instruction: "See why this file needs an investigator's attention." },
  { id: "genReceipt", label: "Generate demo receipt", route: "#/receipt", selectors: [".content > .card.lim"], instruction: "Create a demo record linking this finding to its evidence." },
  { id: "viewCustody", label: "View custody chain", route: "#/cases", selectors: [".content > .card.tbl"], instruction: "Follow the evidence and finding through the investigation." },
  { id: "accessHistory", label: "Access history", route: "#/access", selectors: ["#open-form + .card.tbl"], instruction: "Check who accessed the case and whose request was denied." },
  { id: "approveAction", label: "Approve demo action", route: "#/approvals", selectors: [".content > article.card", ".content > .card"], instruction: "Approve the sample host-isolation recommendation." },
  { id: "openReport", label: "Open report", route: "#/reports", selectors: [".content > .kpis"], instruction: "Read the report bringing the evidence and decisions together." },
  { id: "security", label: "Security controls", route: "#/security", selectors: ["section.card.lim"], instruction: "See the controls designed to limit actions and protect the investigation." },
];

const PAD = 8;
const GAP = 12;
const MARGIN = 12;

const onRoute = (route) =>
  !route ||
  typeof location === "undefined" ||
  location.hash === route ||
  location.hash.startsWith(`${route}/`);

export function hashRoutePrepare(step, { signal }) {
  if (onRoute(step.route)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      window.removeEventListener("hashchange", done);
      signal.removeEventListener("abort", stop);
      requestAnimationFrame(() => resolve());
    };
    const stop = () => {
      window.removeEventListener("hashchange", done);
      reject(new DOMException("Aborted", "AbortError"));
    };
    window.addEventListener("hashchange", done);
    signal.addEventListener("abort", stop, { once: true });
    location.hash = step.route;
  });
}

export function findTarget(step) {
  if (typeof document === "undefined" || !onRoute(step.route)) return null;
  const sels = [`[data-tour-id="${step.id}"]`, ...(step.selectors || [])];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    const r = el && el.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export function holeFor(r, vw, vh) {
  const clamp = (v, max) => Math.min(Math.max(0, v), max);
  const top = clamp(r.top - PAD, vh);
  const left = clamp(r.left - PAD, vw);
  const bottom = clamp(r.bottom + PAD, vh);
  const right = clamp(r.right + PAD, vw);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function placeCard(hole, card, vw, vh) {
  const clampX = (x) => Math.min(Math.max(MARGIN, x), Math.max(MARGIN, vw - card.width - MARGIN));
  const clampY = (y) => Math.min(Math.max(MARGIN, y), Math.max(MARGIN, vh - card.height - MARGIN));
  if (!hole || !hole.width || !hole.height) {
    return { top: clampY((vh - card.height) / 2), left: clampX((vw - card.width) / 2) };
  }
  const left = clampX(hole.left + hole.width / 2 - card.width / 2);
  if (hole.top + hole.height + GAP + card.height <= vh - MARGIN) {
    return { top: hole.top + hole.height + GAP, left };
  }
  if (hole.top - GAP - card.height >= MARGIN) {
    return { top: hole.top - GAP - card.height, left };
  }
  const side =
    hole.left + hole.width + GAP + card.width <= vw - MARGIN
      ? hole.left + hole.width + GAP
      : hole.left - GAP - card.width;
  if (side >= MARGIN) return { top: clampY(hole.top), left: side };
  return { top: clampY(vh - card.height - MARGIN), left };
}

const sameBox = (a, b) =>
  a === b || (a && b && ["top", "left", "width", "height"].every((k) => Math.abs(a[k] - b[k]) < 0.5));

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

let active = null;

export function stopGuidedTour() {
  if (active) {
    active.destroy();
    active = null;
  }
}

export function startGuidedTour(opts = {}) {
  stopGuidedTour();
  active = new GuidedTour(opts);
  active.mount();
  return active;
}

class GuidedTour {
  constructor({
    steps = STEPS,
    prepareStep = hashRoutePrepare,
    resolveTarget = findTarget,
    onStepChange,
    onComplete,
    onExit,
    allowTargetClicks = false,
    timeoutMs = 5000,
  } = {}) {
    this.steps = steps;
    this.prepareStep = prepareStep;
    this.resolveTarget = resolveTarget;
    this.onStepChange = onStepChange;
    this.onComplete = onComplete;
    this.onExit = onExit;
    this.allowTargetClicks = allowTargetClicks;
    this.timeoutMs = timeoutMs;
    this.index = 0;
    this.attempt = 0;
    this.status = steps.length ? "preparing" : "done";
    this.target = null;
    this.hole = null;
    this.pos = null;
    this.outcomes = steps.map(() => "not reached");
    this.seq = 0;
    this.busy = false;
    this.root = null;
    this.card = null;
    this.nextBtn = null;
    this.retryBtn = null;
    this.returnFocus = document.activeElement;
    this.cleanupEnter = null;
    this.cleanupTrack = null;
    this.raf = 0;
  }

  get step() {
    return this.steps[this.index];
  }

  mount() {
    this.root = document.createElement("div");
    this.root.dataset.guidedTour = "";
    this.root.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none";
    document.body.appendChild(this.root);
    this.onResize = () => this.layoutCard();
    window.addEventListener("resize", this.onResize);
    this.enterStep();
  }

  destroy() {
    this.seq += 1;
    this.cleanupEnter?.();
    this.cleanupTrack?.();
    window.removeEventListener("resize", this.onResize);
    this.root?.remove();
    this.root = null;
    const el = this.returnFocus;
    this.returnFocus = null;
    if (el && el.isConnected && el.focus) el.focus();
  }

  restoreFocus() {
    const el = this.returnFocus;
    this.returnFocus = null;
    if (el && el.isConnected && el.focus) el.focus();
  }

  enterStep() {
    this.cleanupEnter?.();
    this.cleanupTrack?.();
    if (this.status === "done" || this.status === "closed" || !this.step) {
      this.paint();
      return;
    }
    const my = ++this.seq;
    const ctrl = new AbortController();
    let obs = null;
    let settled = false;
    this.busy = false;
    this.target = null;
    this.hole = null;
    this.status = "preparing";
    this.onStepChange?.(this.index, this.step);
    this.paint();
    const timer = setTimeout(() => {
      const el = this.resolveTarget(this.step);
      ctrl.abort();
      finish(el);
    }, this.timeoutMs);
    const finish = (el) => {
      if (settled || my !== this.seq) return;
      settled = true;
      obs?.disconnect();
      clearTimeout(timer);
      if (!el) {
        this.status = "missing";
        this.paint();
        this.focusCard();
        return;
      }
      el.scrollIntoView?.({
        block: "center",
        inline: "nearest",
        behavior: reducedMotion() ? "auto" : "smooth",
      });
      this.target = el;
      this.status = "ready";
      this.trackTarget();
      this.paint();
      this.focusCard();
    };
    Promise.resolve()
      .then(() => this.prepareStep(this.step, { signal: ctrl.signal }))
      .then(() => {
        if (my !== this.seq) return;
        const now = this.resolveTarget(this.step);
        if (now) return finish(now);
        obs = new MutationObserver(() => {
          const el = this.resolveTarget(this.step);
          if (el) finish(el);
        });
        obs.observe(document.body, { childList: true, subtree: true, attributes: true });
      })
      .catch((err) => {
        if (err?.name !== "AbortError" && my === this.seq) {
          this.status = "missing";
          this.paint();
          this.focusCard();
        }
      });
    this.cleanupEnter = () => {
      settled = true;
      this.seq += 1;
      ctrl.abort();
      obs?.disconnect();
      clearTimeout(timer);
    };
  }

  trackTarget() {
    this.cleanupTrack?.();
    if (this.status !== "ready" || !this.target) return;
    let el = this.target;
    const measure = () => {
      this.raf = 0;
      if (!el.isConnected) {
        const fresh = this.resolveTarget(this.step);
        if (!fresh) {
          this.hole = null;
          this.target = null;
          this.status = "missing";
          this.paint();
          return;
        }
        el = fresh;
        this.target = fresh;
        ro.disconnect();
        ro.observe(el);
      }
      const next = holeFor(el.getBoundingClientRect(), window.innerWidth, window.innerHeight);
      if (!sameBox(this.hole, next)) {
        this.hole = next;
        this.paint();
      } else {
        this.layoutCard();
      }
    };
    const schedule = () => {
      if (!this.raf) this.raf = requestAnimationFrame(measure);
    };
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(schedule)
        : { observe() {}, disconnect() {} };
    ro.observe(el);
    const mo = new MutationObserver((recs) => {
      if (recs.some((r) => !this.card?.contains(r.target))) schedule();
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    measure();
    this.cleanupTrack = () => {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }

  layoutCard() {
    if (!this.card) return;
    const next = placeCard(
      this.status === "ready" ? this.hole : null,
      this.card.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight
    );
    if (
      this.pos &&
      Math.abs(this.pos.top - next.top) < 0.5 &&
      Math.abs(this.pos.left - next.left) < 0.5
    ) {
      return;
    }
    this.pos = next;
    this.card.style.top = `${next.top}px`;
    this.card.style.left = `${next.left}px`;
    this.card.style.opacity = "1";
  }

  focusCard() {
    requestAnimationFrame(() => {
      if (this.status === "ready" || this.status === "done") this.nextBtn?.focus({ preventScroll: true });
      else if (this.status === "missing") this.retryBtn?.focus({ preventScroll: true });
      else this.card?.focus({ preventScroll: true });
    });
  }

  summary() {
    return this.steps.map((s, i) => ({ id: s.id, outcome: this.outcomes[i] }));
  }

  mark(value) {
    this.outcomes = this.outcomes.map((v, i) => (i === this.index ? value : v));
  }

  advance(value) {
    if (this.busy) return;
    this.busy = true;
    this.mark(value);
    if (this.index >= this.steps.length - 1) {
      this.seq += 1;
      this.target = null;
      this.hole = null;
      this.status = "done";
      const final = this.steps.map((s, i) => ({
        id: s.id,
        outcome: i === this.index ? value : this.outcomes[i],
      }));
      this.paint();
      this.focusCard();
      this.onComplete?.(final);
    } else {
      this.index += 1;
      this.enterStep();
    }
  }

  exit(reason) {
    this.busy = true;
    this.seq += 1;
    this.status = "closed";
    const summary = this.summary();
    this.restoreFocus();
    this.destroy();
    active = null;
    this.onExit?.(reason, summary);
  }

  onKeyDown(e) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      this.exit(this.status === "done" ? "complete" : "escape");
      return;
    }
    if (
      e.key === "Enter" &&
      this.status === "ready" &&
      !e.target.closest("button,a,input,textarea,select,[contenteditable='true']")
    ) {
      e.preventDefault();
      this.advance("viewed");
      return;
    }
    if (e.key === "Tab" && !this.allowTargetClicks && this.card) {
      const items = [...this.card.querySelectorAll("button:not([disabled])")];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && i === items.length - 1) {
        e.preventDefault();
        items[0].focus();
      }
    }
  }

  keepFocus(e) {
    e.preventDefault();
  }

  paint() {
    if (!this.root || this.status === "closed") return;
    const step = this.step;
    const done = this.status === "done";
    const viewed = this.outcomes.filter((o) => o === "viewed").length;
    const skipped = this.outcomes.filter((o) => o === "skipped").length;
    const announce = done
      ? `Tour complete. ${viewed} of ${this.steps.length} steps viewed, ${skipped} skipped.`
      : this.status === "missing"
        ? `Step ${this.index + 1} of ${this.steps.length}: ${step.label}. This part of the app could not be found.`
        : this.status === "ready"
          ? `Step ${this.index + 1} of ${this.steps.length}: ${step.label}. ${step.instruction}`
          : `Step ${this.index + 1} of ${this.steps.length}: finding this part of the app.`;
    const h = this.status === "ready" ? this.hole : null;
    const panels = h
      ? [
          { top: 0, left: 0, right: 0, height: `${h.top}px` },
          { top: `${h.top + h.height}px`, left: 0, right: 0, bottom: 0 },
          { top: `${h.top}px`, left: 0, width: `${h.left}px`, height: `${h.height}px` },
          { top: `${h.top}px`, left: `${h.left + h.width}px`, right: 0, height: `${h.height}px` },
        ]
      : [{ inset: 0 }];
    const fade = reducedMotion() ? "none" : "opacity 150ms ease";
    const desc =
      this.status === "missing"
        ? "This part of the app could not be found on screen, so nothing is highlighted. Retry, skip this step, or exit."
        : this.status === "preparing"
          ? "Finding this part of the app…"
          : step?.instruction || "";
    const top = this.pos?.top ?? -9999;
    const left = this.pos?.left ?? -9999;

    this.root.innerHTML = `
      ${panels
        .map(
          (p) =>
            `<div class="tour-dim" aria-hidden="true" style="${styleBox(p)}"></div>`
        )
        .join("")}
      ${
        h && !this.allowTargetClicks
          ? `<div class="tour-block" aria-hidden="true" style="position:fixed;top:${h.top}px;left:${h.left}px;width:${h.width}px;height:${h.height}px;pointer-events:auto"></div>`
          : ""
      }
      ${
        h
          ? `<div aria-hidden="true" style="position:fixed;top:${h.top}px;left:${h.left}px;width:${h.width}px;height:${h.height}px;border-radius:8px;box-shadow:0 0 0 3px #1F4FD1, 0 0 0 7px rgba(31,79,209,.35);pointer-events:none"></div>`
          : ""
      }
      <div role="status" aria-live="polite" aria-atomic="true" class="tour-sr">${esc(announce)}</div>
      <div class="tour-card" role="dialog" aria-modal="false" aria-labelledby="guided-tour-title" aria-describedby="guided-tour-desc" tabindex="-1"
        style="top:${top}px;left:${left}px;opacity:${this.pos ? 1 : 0};transition:${fade}">
        ${
          done
            ? `<h2 id="guided-tour-title">Tour complete</h2>
          <p id="guided-tour-desc">${viewed} of ${this.steps.length} steps viewed${
              skipped ? `, ${skipped} skipped` : ""
            }. Nothing was changed in the app by this tour.</p>
          <button type="button" class="tour-btn primary" data-tour="close">Close</button>`
            : `<div class="tour-kicker">Step ${this.index + 1} of ${this.steps.length}</div>
          <h2 id="guided-tour-title">${esc(step.label)}</h2>
          <p id="guided-tour-desc">${esc(desc)}</p>
          <div class="tour-actions">
            ${this.status === "missing" ? `<button type="button" class="tour-btn" data-tour="retry">Retry</button>` : ""}
            <button type="button" class="tour-btn primary" data-tour="next" ${
              this.status !== "ready" ? "disabled" : ""
            }>${this.index === this.steps.length - 1 ? "Finish" : "Next"}</button>
            <button type="button" class="tour-btn" data-tour="skip">Skip step</button>
            <button type="button" class="tour-btn" data-tour="exit">Exit tour</button>
          </div>`
        }
      </div>`;

    this.card = this.root.querySelector(".tour-card");
    this.nextBtn = this.root.querySelector('[data-tour="next"], [data-tour="close"]');
    this.retryBtn = this.root.querySelector('[data-tour="retry"]');
    this.root.querySelectorAll(".tour-dim, .tour-block").forEach((el) => {
      el.onmousedown = (e) => this.keepFocus(e);
    });
    this.card.onkeydown = (e) => this.onKeyDown(e);
    this.root.querySelectorAll("[data-tour]").forEach((btn) => {
      btn.onclick = () => {
        const act = btn.dataset.tour;
        if (act === "next") this.advance("viewed");
        if (act === "skip") this.advance("skipped");
        if (act === "exit") this.exit("exit");
        if (act === "close") this.exit("complete");
        if (act === "retry") {
          this.attempt += 1;
          this.enterStep();
        }
      };
    });
    this.layoutCard();
  }
}

function styleBox(p) {
  const dim = "position:fixed;background:rgba(15,23,42,0.62);pointer-events:auto";
  return (
    dim +
    ";" +
    Object.entries(p)
      .map(([k, v]) => `${k}:${typeof v === "number" ? `${v}px` : v}`)
      .join(";")
  );
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
