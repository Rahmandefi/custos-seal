/** In-memory fictional guided tour. No network, no chain writes. */

export const STEPS = [
  { id: "addEvidence", label: "Add sample evidence", section: "Evidence", instruction: "Click here to add the investigation's sample file.", resultKey: "evidenceAdded" },
  { id: "viewEvidence", label: "View evidence", section: "Evidence", instruction: "Open the file that started this investigation.", resultKey: "evidenceViewed" },
  { id: "reviewFinding", label: "Review finding", section: "Findings", instruction: "See why this file needs an investigator's attention.", resultKey: "findingViewed" },
  { id: "genReceipt", label: "Generate demo receipt", section: "Receipt", instruction: "Create a demo record linking this finding to its evidence.", resultKey: "receiptCreated" },
  { id: "viewCustody", label: "View custody chain", section: "Custody", instruction: "Follow the evidence and finding through the investigation.", resultKey: "custodyViewed" },
  { id: "accessHistory", label: "Access history", section: "Access", instruction: "Check who accessed the case and whose request was denied.", resultKey: "accessViewed" },
  { id: "approveAction", label: "Approve demo action", section: "Approvals", instruction: "Approve the sample host-isolation recommendation.", resultKey: "approved" },
  { id: "openReport", label: "Open report", section: "Reports", instruction: "Read the report bringing the evidence and decisions together.", resultKey: "reportViewed" },
  { id: "security", label: "Security controls", section: "Security", instruction: "See the controls designed to limit actions and protect the investigation.", resultKey: "securityViewed" },
];

const RESULT_TEXT = {
  evidenceAdded: [
    "Sample evidence added: suspicious-upload.log (demo).",
    "Fictional file held in this tour workspace only.",
  ],
  evidenceViewed: [
    'Sample excerpt: "POST /upload size=2.4MB from 10.0.12.44".',
    "Commitment placeholder, not a real hash: commit-demo-001",
  ],
  findingViewed: [
    "Demo finding: suspicious file upload; recommend host isolation.",
    "Supporting evidence: the sample POST /upload entry.",
  ],
  receiptCreated: [
    "SIMULATED receipt created: receipt-demo-004.",
    "Links the sample finding to sample evidence. Not on-chain.",
  ],
  accessViewed: [
    "Sample access history: Investigator Maya allowed; guest denied.",
    "Fictional records only. No live access changes.",
  ],
  approved: [
    "SIMULATED approval: host-isolation recommendation accepted.",
    "No host isolated. Approval stays inside this demo.",
  ],
  securityViewed: [
    "Demo controls: role checks, approval gates and custody records.",
    "These explanations do not execute real security actions.",
  ],
};

const INITIAL = Object.fromEntries(STEPS.map((step) => [step.resultKey, false]));
const SECTIONS = [...new Set(STEPS.map((step) => step.section))];

export function defaultTour() {
  return {
    phase: "start",
    stepIndex: 0,
    results: { ...INITIAL },
    skipped: [],
    lastResultKey: null,
  };
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function resultLinesFor(tour) {
  const key = tour.lastResultKey;
  if (!key) return null;
  if (key === "custodyViewed") {
    const path = STEPS.slice(0, 5)
      .filter((item) => tour.results[item.resultKey])
      .map((item) => item.label)
      .join(" -> ");
    return [
      "SIMULATED custody timeline, completed events only:",
      path || "(none yet)",
    ];
  }
  if (key === "reportViewed") {
    const list = STEPS.filter((item) => tour.results[item.resultKey])
      .map((item) => item.label)
      .join("; ");
    return [
      "SIMULATED report, actions completed in this tour:",
      list || "(none yet)",
    ];
  }
  return RESULT_TEXT[key] || null;
}

function resultPanel(tour) {
  const lines = resultLinesFor(tour);
  if (!lines) return "";
  return `<aside class="tour-result" aria-live="polite">
    <strong>Latest demo result</strong>
    ${lines.map((line) => `<p>${esc(line)}</p>`).join("")}
  </aside>`;
}

export function renderTour(tour) {
  const step = STEPS[tour.stepIndex];
  const doneCount = Object.values(tour.results).filter(Boolean).length;

  let body = "";
  if (tour.phase === "start") {
    body = `<div class="tour-panel">
      <h2>Take a guided tour</h2>
      <p>Follow one investigation from evidence to a secure final report</p>
      <button class="btn primary" type="button" id="tour-start">Start tour</button>
      <button class="btn" type="button" id="tour-exit">Exit tour</button>
    </div>`;
  } else if (tour.phase === "tour") {
    const nav = SECTIONS.map(
      (name) =>
        `<span class="tour-sec${name === step.section ? " on" : ""}">${esc(name)}</span>`
    ).join("");
    const actions = STEPS.filter((item) => item.section === step.section)
      .map((item) => {
        const active = item.id === step.id;
        return `<button type="button" class="btn${active ? " tour-hit" : ""}" data-tour-act="${item.id}" ${
          active ? 'id="tour-target" aria-current="step"' : "disabled"
        }>${esc(item.label)}</button>`;
      })
      .join("");
    body = `<nav class="tour-nav" aria-label="Demo sections">${nav}</nav>
      <div class="tour-panel">
        <div aria-live="polite">
          <strong>Step ${tour.stepIndex + 1} of 9</strong>
          <p>${esc(step.instruction)}</p>
        </div>
        <h3>${esc(step.section)}</h3>
        <div class="tour-row">${actions}</div>
      </div>
      ${resultPanel(tour)}
      <div class="tour-row">
        <button class="btn" type="button" id="tour-skip">Skip step</button>
        <button class="btn" type="button" id="tour-exit">Exit tour</button>
      </div>`;
  } else {
    const items = STEPS.map((item) => {
      const status = tour.results[item.resultKey]
        ? "done"
        : tour.skipped.includes(item.id)
          ? "skipped"
          : "not done";
      return `<li>${esc(item.label)}: ${status}</li>`;
    }).join("");
    body = `<div class="tour-panel">
      <h2>Tour complete</h2>
      <p>Completed actions: ${doneCount} of 9.</p>
      ${resultPanel(tour)}
      <ul class="tour-list">${items}</ul>
      <button class="btn primary" type="button" id="tour-restart">Restart tour</button>
      <button class="btn" type="button" id="tour-exit">Exit tour</button>
    </div>`;
  }

  return `<section class="tour-root" aria-label="Guided demo tour">
    <header class="tour-banner">
      <strong>Demo data: explore freely</strong>
      <div>Fictional investigation. No real actions.</div>
    </header>
    ${body}
  </section>`;
}

export function resetTour(tour) {
  tour.phase = "start";
  tour.stepIndex = 0;
  tour.results = { ...INITIAL };
  tour.skipped = [];
  tour.lastResultKey = null;
}

function advance(tour) {
  if (tour.stepIndex === STEPS.length - 1) tour.phase = "complete";
  else tour.stepIndex += 1;
}

export function bindTour(tour, { onExitToParent, onChange }) {
  const start = document.getElementById("tour-start");
  if (start) {
    start.onclick = () => {
      tour.phase = "tour";
      onChange();
    };
    start.focus();
  }
  const restart = document.getElementById("tour-restart");
  if (restart) {
    restart.onclick = () => {
      resetTour(tour);
      onChange();
    };
  }
  const skip = document.getElementById("tour-skip");
  if (skip) {
    skip.onclick = () => {
      if (tour.phase !== "tour") return;
      tour.skipped = [...tour.skipped, STEPS[tour.stepIndex].id];
      advance(tour);
      onChange();
    };
  }
  const exit = document.getElementById("tour-exit");
  if (exit) {
    exit.onclick = () => {
      if (tour.phase === "start") {
        if (onExitToParent) onExitToParent();
        else onChange();
        return;
      }
      resetTour(tour);
      onChange();
    };
  }
  document.querySelectorAll("[data-tour-act]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.tourAct;
      const step = STEPS[tour.stepIndex];
      if (tour.phase !== "tour" || step.id !== id) return;
      tour.results = { ...tour.results, [step.resultKey]: true };
      tour.lastResultKey = step.resultKey;
      advance(tour);
      onChange();
    };
  });
  const target = document.getElementById("tour-target");
  if (target) target.focus();
}
