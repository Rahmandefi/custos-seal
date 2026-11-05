import {
  loadWalk,
  saveWalk,
  defaultWalk,
  BAR,
  barIndex,
  routeForStep,
  nextStep,
  prevStep,
  nextEnabled,
  nextLabel,
  holdReceipts,
  fileToB64,
} from "./walk.js";
import {
  loadSetup,
  saveSetup,
  defaultSetup,
  SETUP_STEPS,
  setupIndex,
  setupNext,
  setupPrev,
  setupValid,
  shortAccount,
} from "./setup.js";

const P = {
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  block: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  flag: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  hold: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14 9l2 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  report: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  shieldok: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  shieldx: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9.5 9.5 5 5M14.5 9.5l-5 5"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};

const svg = (n, s = 16, w = 2) =>
  `<svg class="i" viewBox="0 0 24 24" width="${s}" height="${s}" stroke-width="${w}" aria-hidden="true">${P[n] || ""}</svg>`;

const state = {
  view: "cases",
  status: null,
  error: null,
  analyze: null,
  verify: null,
  attack: null,
  selectedReceipt: null,
  file: null,
  walk: loadWalk(),
  setup: loadSetup(),
  menuOpen: false,
  grantMsg: null,
  custodyMsg: null,
};

function persistWalk() {
  saveWalk(state.walk);
}

function persistSetup() {
  saveSetup(state.setup);
}

function setupOpen() {
  const s = state.setup;
  return !s.completed && !s.skipped;
}

function route() {
  state.walk = loadWalk();
  state.setup = loadSetup();
  const h = location.hash.replace(/^#\/?/, "");
  if (setupOpen() && (!h || h === "setup" || h === "land")) {
    state.view = "setup";
    state.arg = undefined;
    render();
    return;
  }
  const w = state.walk;
  if (!h && !w.completed && !w.skipped && !setupOpen()) {
    w.step = w.step || "land";
    persistWalk();
    if (w.step === "land") {
      state.view = "land";
      render();
      return;
    }
    location.hash = `#/${routeForStep(w.step)}`;
    return;
  }
  const [view, arg] = (h || "cases").split("/");
  state.view = view || "cases";
  state.arg = arg;
  render();
}

async function loadStatus() {
  try {
    state.status = await (await fetch("/api/status")).json();
  } catch (e) {
    state.error = String(e.message);
  }
  render();
}

function kindLabel(k) {
  if (!k) return "—";
  if (typeof k === "object") return Object.keys(k)[0];
  return String(k);
}

function verdictChip(v) {
  const name = kindLabel(v).toUpperCase();
  const cls =
    name === "ACCEPT" || name === "FINDING"
      ? "accept"
      : name === "HOLD"
        ? "hold"
        : name === "FLAG"
          ? "flag"
          : "block";
  const ic =
    cls === "accept" ? "check" : cls === "hold" ? "hold" : cls === "flag" ? "flag" : "block";
  return `<span class="v ${cls}">${svg(ic, 13, 2.5)}${name}</span>`;
}

function shortHash(h) {
  const s = Array.isArray(h)
    ? Array.from(h)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    : String(h || "");
  if (s.length < 16) return s || "—";
  return `${s.slice(0, 8)}…${s.slice(-8)}`;
}

function hexOf(arr) {
  if (!arr) return "";
  if (typeof arr === "string") return arr;
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function explorerTx(tx) {
  return `https://explorer.testnet.near.org/transactions/${tx}`;
}

function rail(active) {
  const item = (id, icon, label, href, badge) =>
    `<a class="ri${active === id ? " on" : ""}" href="${href}">${svg(icon, 19, 1.8)}<span>${label}</span>${
      badge ? `<span class="dot">${badge}</span>` : ""
    }</a>`;
  return `<nav class="rail" aria-label="Sections">
    <div class="logo">${svg("shield", 20)}</div>
    ${item("cases", "folder", "Cases", "#/cases")}
    ${item("workspace", "file", "Evidence", "#/workspace")}
    ${item("analyze", "list", "Analysis", "#/analyze", "1")}
    ${item("security", "key", "Security", "#/security")}
    ${item("reports", "report", "Reports", "#/reports")}
  </nav>`;
}

function tree(active) {
  const n = state.status?.receipt_count ?? "—";
  return `<aside class="side">
    <div class="sh">
      <div class="k">Case</div>
      <div class="t">${state.setup.caseName || state.walk.caseName || "Larkmoor Records Office"}</div>
      <div class="m">${state.setup.caseDesc || state.walk.caseDesc || "File-transfer breach"} <span class="fx">FICTIONAL</span></div>
    </div>
    <div class="ssearch">${svg("search", 14)}Filter</div>
    <div class="tree">
      <div class="tg">Cases</div>
      <a class="tn${active === "cases" ? " on" : ""}" href="#/cases">${svg("folder", 15)}All cases<span class="c">1</span></a>
      <a class="tn${active === "approvals" ? " on" : ""}" href="#/approvals">${svg("hold", 15)}Approvals<span class="c hold">${holdReceipts(state.status).length}</span></a>
      <a class="tn${active === "access" ? " on" : ""}" href="#/access">${svg("users", 15)}Access</a>
      <a class="tn${active === "security" ? " on" : ""}" href="#/security">${svg("key", 15)}Security</a>
      <div class="tg">Evidence</div>
      <a class="tn${active === "workspace" ? " on" : ""}" href="#/workspace">${svg("file", 15)}Evidence files<span class="c">2</span></a>
      <a class="tn${active === "custody" ? " on" : ""}" href="#/custody">${svg("hash", 15)}Custody check</a>
      <a class="tn${active === "receipt" ? " on" : ""}" href="#/receipt">${svg("link", 15)}Custody log<span class="c">${n}</span></a>
      <div class="tg">Analysis</div>
      <a class="tn${active === "analyze" ? " on" : ""}" href="#/analyze">${svg("list", 15)}Run analysis</a>
      <a class="tn${active === "finding" ? " on" : ""}" href="#/finding">${svg("flag", 15)}Findings</a>
      <div class="tg">Reports</div>
      <a class="tn${active === "reports" ? " on" : ""}" href="#/reports">${svg("report", 15)}Case report</a>
    </div>
    <div class="sfoot">${svg("lock", 13)}Evidence encrypted at rest</div>
  </aside>`;
}

function top(crumb, chip) {
  const w = state.walk;
  const writer = state.status?.writer || "ftwriter15e434.testnet";
  const short = shortAccount(writer);
  return `<header class="top">
    <a class="brand" href="#/cases">
      <span class="brand-name">Custos Seal</span>
      <span class="brand-sub">Private Forensic Triage Assistant</span>
    </a>
    <span class="brand-sep" aria-hidden="true"></span>
    <div class="crumb">${crumb}</div>
    <div class="sp"></div>
    <div class="gsearch">${svg("search", 15)}Search evidence, findings, accounts<kbd>/</kbd></div>
    ${chip || `<span class="chip ok">${svg("shieldok", 13)}Last analysis: Verified</span>`}
    <span class="chip net">${svg("info", 13)}Testnet</span>
    <div class="acct"><span class="av">FT</span>${short}</div>
    ${
      w.completed || w.skipped
        ? `<div class="menuwrap"><button class="btn sm" id="top-menu" type="button">Menu</button>
           <div class="menu" id="top-menu-list" ${state.menuOpen ? "" : "hidden"}>
             <button type="button" id="restart-walk">Restart walkthrough</button>
           </div></div>`
        : ""
    }
  </header>`;
}

function walkBar() {
  const w = state.walk;
  if (setupOpen()) return "";
  if (w.completed || w.skipped || w.step === "land") return "";
  const idx = barIndex(w.step);
  return `<ol class="wbar" aria-label="Walkthrough">
    ${BAR.map((b, i) => {
      const on = i === idx ? "on" : i < idx ? "done" : "";
      return `<li class="${on}"><span>${b.n}</span> ${b.label}</li>`;
    }).join("")}
  </ol>`;
}

function walkDock() {
  const w = state.walk;
  if (setupOpen()) return "";
  if (w.completed || w.skipped || w.step === "land") return "";
  const en = nextEnabled(w);
  const retry = w.step === "analyze" && w.analyzeError;
  return `<div class="wdock">
    <button class="btn" type="button" id="walk-back"${w.step === "connect" ? " disabled" : ""}>Back</button>
    <a class="wskip" href="#/cases" id="walk-skip">Skip walkthrough</a>
    <div class="sp"></div>
    <button class="btn primary" type="button" id="walk-next" ${en || retry ? "" : "disabled"}>${nextLabel(w)}</button>
  </div>`;
}

function statusBar(extra) {
  const n = state.status?.receipt_count ?? "—";
  return `<footer class="status">
    <span>Custody log <b>${n}</b> receipts</span>
    <span class="sep"></span>
    <span>NEAR testnet · <span class="mono">${state.status?.contract || "ftcust15e434.testnet"}</span></span>
    ${extra ? `<span class="sep"></span>${extra}` : ""}
    <span class="sp"></span>
    <span>All case data <span class="fx">FICTIONAL</span></span>
  </footer>`;
}

function shell(active, crumb, chip, inner, extraStatus) {
  return `${rail(active)}${tree(active)}<main class="main">${top(crumb, chip)}${walkBar()}<div class="content">${inner}</div>${walkDock()}${statusBar(extraStatus)}</main>`;
}

function viewLand() {
  return `<div class="land">
    <div class="land-card">
      <div class="eyebrow">NEAR testnet</div>
      <h1>Custos Seal: Private Forensic Triage Assistant</h1>
      <p class="lede">Guided first run. Sample items stay marked FICTIONAL. Evidence is fingerprinted, not stored in the custody log.</p>
      <ol class="wbar landbar" aria-label="Walkthrough">
        ${BAR.map((b) => `<li><span>${b.n}</span> ${b.label}</li>`).join("")}
      </ol>
      <div class="land-acts">
        <button class="btn primary" type="button" id="land-new">${svg("plus", 17)}Start a new case</button>
        <button class="btn" type="button" id="land-sample">${svg("file", 17)}Try the sample case</button>
        <a class="btn" href="#/receipt" id="land-verify">${svg("link", 17)}Verify a receipt</a>
      </div>
      <p class="mut">All sample data is FICTIONAL.</p>
    </div>
  </div>`;
}

function viewCases() {
  const w = state.walk;
  const holds = holdReceipts(state.status);
  const rows = (state.status?.receipts || [])
    .slice()
    .reverse()
    .map(
      (r) => `<tr>
      <td class="mono ts">${r.id}</td>
      <td>${kindLabel(r.kind)}</td>
      <td>${r.case_id || ""}</td>
      <td>${verdictChip(r.policy_verdict)}</td>
      <td class="mono acc">${r.actor || ""}</td>
      <td><a class="lnk" href="#/receipt/${r.id}">Open ${svg("arrow", 13)}</a></td>
    </tr>`
    )
    .join("");
  const caseForm =
    !w.completed && !w.skipped && w.step === "case"
      ? `<form id="case-form" class="card" style="padding:18px 20px;display:grid;gap:10px">
          <label class="dl" for="cname">Case name</label>
          <input id="cname" name="name" required value="${w.caseName || ""}" style="height:36px;border:1px solid var(--t);border-radius:8px;padding:0 10px" />
          <label class="dl" for="cdesc">Short description</label>
          <input id="cdesc" name="desc" required value="${w.caseDesc || ""}" style="height:36px;border:1px solid var(--t);border-radius:8px;padding:0 10px" />
          <p class="lede">Next opens the case workspace.</p>
        </form>`
      : "";
  return shell(
    "cases",
    "<b>Cases</b>",
    null,
    `<div class="hd"><div><h1>Cases</h1><p class="lede">The case is the home. Live receipts from testnet are listed below.</p></div>
      <div style="display:flex;gap:8px">
        <button class="btn primary" type="button" id="new-case">${svg("plus", 17, 2.4)}New case</button>
        <a class="btn" href="#/analyze">${svg("list", 17)}Analyze evidence</a>
      </div></div>
    ${caseForm}
    <div class="kpis">
      <a class="kpi hold" href="#/approvals"><div class="kh"><span class="ki">${svg("hold", 17)}</span>Waiting for approval</div><div class="kv">${holds.length}</div><div class="ks">${holds.length ? "HOLD receipts on chain" : "No HOLD items"}</div></a>
      <a class="kpi block" href="#/custody"><div class="kh"><span class="ki">${svg("shieldx", 17)}</span>Custody checks</div><div class="kv">${(state.status?.receipts || []).filter((r) => kindLabel(r.kind) === "CustodyCheck").length}</div><div class="ks">From the custody log</div></a>
      <a class="kpi flag" href="#/finding"><div class="kh"><span class="ki">${svg("flag", 17)}</span>Findings</div><div class="kv">${(state.status?.receipts || []).filter((r) => kindLabel(r.kind) === "Finding").length}</div><div class="ks">On-chain Finding receipts</div></a>
      <a class="kpi neutral" href="#/workspace"><div class="kh"><span class="ki">${svg("folder", 17)}</span>Open cases</div><div class="kv">1</div><div class="ks">Larkmoor Records Office</div></a>
    </div>
    <div class="card tbl"><div class="tbar"><h2>Custody log</h2><span class="cnt">${state.status?.receipt_count ?? "—"}</span></div>
    <table><thead><tr><th>Id</th><th>Kind</th><th>Case</th><th>Verdict</th><th>Actor</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="empty">No receipts yet. Upload a file and run analysis.</td></tr>`}</tbody></table></div>`
  );
}

function viewWorkspace() {
  const w = state.walk;
  const files = w.evidenceName
    ? `<tr><td class="cn">${svg("file", 15)}${w.evidenceName}</td><td class="mut">Uploaded · <span class="fx">FICTIONAL</span></td></tr>`
    : `<tr><td colspan="2" class="empty">No evidence yet. Upload a file to start.</td></tr>`;
  return shell(
    "workspace",
    `Cases <span>›</span> ${w.caseName || "Larkmoor Records Office"} <span>›</span> <b>Evidence</b>`,
    null,
    `<div class="hd"><div><h1>Evidence</h1><p class="lede">Upload a file, then run analysis. Citations must match byte-for-byte.</p></div>
      <a class="btn primary${state.setup.highlightAnalyze ? " ring" : ""}" href="#/analyze" id="ws-analyze">${svg("list", 17)}Analyze</a></div>
    <div class="split">
      <div class="lcol">
        <div class="card tbl"><div class="tbar"><h2>Files</h2></div>
          <table><thead><tr><th>File</th><th>Note</th></tr></thead>
          <tbody>${files}</tbody></table>
        </div>
        <form id="ev-form" class="card" style="padding:16px 20px;display:grid;gap:10px">
          <label class="dl">Upload a file</label>
          <input type="file" name="file" />
          <button class="btn" type="button" id="load-sample">${svg("file", 16)}Load the sample file</button>
          ${
            w.commitment
              ? `<div class="dsec"><div class="dl">Salted commitment</div><p class="hash">${w.commitment}</p>
                 <span class="fx">encrypted at rest</span>
                 <p class="lede">Next: run the analysis</p></div>`
              : ""
          }
        </form>
      </div>
      <aside class="card det">
        <div class="dh"><div class="eyebrow">Selected case</div><h2>${w.caseName || "Larkmoor Records Office"}</h2>
          <div class="dm"><span class="fx">FICTIONAL</span>${w.caseDesc || "File-transfer breach"}</div></div>
        <div class="dsec"><div class="dl">Encrypted at rest</div><p class="lede">Plaintext exists only in memory during analysis. The custody log stores fingerprints, not the file.</p></div>
      </aside>
    </div>`
  );
}

const STEPS = [
  "Nonce generated",
  "Gateway verified",
  "Model verified",
  "Signer and nonce bound",
  "Software measurements match",
  "GPU evidence verified",
  "Prompt encrypted to the attested key",
  "Reply signature verified",
  "Citations checked",
  "Recorded in the custody log",
];

function viewAnalyze() {
  const a = state.analyze;
  const rows = STEPS.map((s, i) => {
    let cls = "";
    let mark = "·";
    if (a?.running && i <= (a.tick || 0)) {
      cls = "ok";
      mark = svg("check", 13, 2.6);
    }
    if (a?.done && !a.error) {
      cls = "ok";
      mark = svg("check", 13, 2.6);
    }
    if ((a?.error || state.walk.analyzeError) && i === STEPS.length - 1) {
      cls = "bad";
      mark = svg("x", 13, 2.6);
    }
    return `<div class="stp ${cls}"><span class="dot2">${mark}</span><div class="st1">${s}</div></div>`;
  }).join("");
  const result = a?.done
    ? a.error
      ? `<div class="card" style="padding:16px 20px;border-color:var(--g);background:var(--d)">
          <div class="alab">Unable to verify</div>
          <h2>${a.error}</h2>
          <p class="lede">No receipt was written (fail closed). ${a.skip_chain ? "The contract was not called." : ""}</p>
        </div>`
      : `<div class="card" style="padding:16px 20px;border-color:var(--m);background:var(--p)">
          <div class="alab" style="color:var(--bh)">Verified</div>
          <h2>Receipt ${a.receipt_id} recorded</h2>
          <p class="lede">Policy ${a.policy}. Storage +${a.storage_delta} bytes.</p>
          <p><a class="lnk" href="#/receipt/${a.receipt_id}">Open receipt</a>
          · <a class="lnk" href="${explorerTx(a.tx)}" target="_blank" rel="noreferrer">view transaction</a></p>
          <p class="mono mut">salt ${a.salt}</p>
        </div>`
    : "";
  return shell(
    "analyze",
    'Cases <span>›</span> Larkmoor <span>›</span> <b>Analysis</b>',
    null,
    `<div class="hd"><div><h1>Run analysis</h1><p class="lede">One request: upload, TEE, provider_tee, dcap-qvl, policy, then record_finding.</p></div></div>
    <div class="card" style="padding:18px 20px">
      <form id="analyze-form">
        <label class="dl" for="ev">Evidence file</label>
        <input id="ev" name="file" type="file" required />
        <p class="lede">Use samples/larkmoor-listing.txt for the demo.</p>
        <button class="btn primary" type="submit" ${a?.running ? "disabled" : ""}>${svg("list", 17)}${a?.running ? "Analyzing…" : "Analyze"}</button>
        ${a?.error || state.walk.analyzeError ? `<div class="ar done" style="background:var(--d);border-color:var(--g)"><span class="alab">Unable to verify</span><p>No receipt was written. Retry or Back.</p></div>` : ""}
      </form>
    </div>
    <div class="card strip"><div class="sl">Verified panel</div><div class="stps" style="grid-template-columns:repeat(2,1fr)">${rows}</div></div>
    ${result}`
  );
}

function viewReceipt() {
  const id = Number(state.arg);
  const r = (state.status?.receipts || []).find((x) => Number(x.id) === id) || state.selectedReceipt;
  if (state.arg && !r) {
    fetch(`/api/receipt/${id}`)
      .then((x) => x.json())
      .then((d) => {
        state.selectedReceipt = d;
        render();
      });
  }
  const rec = r || (state.status?.receipts || [])[(state.status?.receipts || []).length - 1];
  if (!rec) {
    return shell("receipt", "<b>Receipt</b>", null, `<p class="lede">No receipt selected.</p>`);
  }
  const f = rec.finding || {};
  return shell(
    "receipt",
    `Cases <span>›</span> <b>Receipt ${rec.id}</b>`,
    null,
    `<div class="hd"><div><h1>Receipt ${rec.id}</h1><p class="lede">${kindLabel(rec.kind)} · ${rec.case_id} · ${rec.actor}</p></div>
      ${verdictChip(rec.policy_verdict)}</div>
    <div class="card lim">
      <dl class="kv">
        <div><dt>Kind</dt><dd>${kindLabel(rec.kind)}</dd></div>
        <div><dt>Verdict</dt><dd>${kindLabel(rec.policy_verdict)}</dd></div>
        <div><dt>Model</dt><dd class="mono">${f.model_id || "—"}</dd></div>
        <div><dt>Nonce</dt><dd class="mono">${shortHash(f.nonce)}</dd></div>
        <div><dt>Finding hash</dt><dd class="mono">${shortHash(f.finding_hash)}</dd></div>
        <div><dt>Evidence</dt><dd class="mono">${shortHash(rec.evidence_commitments?.[0])}</dd></div>
      </dl>
    </div>
    <form id="verify-form" class="card" style="padding:16px 20px">
      <h2>Verify from chain</h2>
      <p class="lede">Recomputes the evidence fingerprint from the original file and salt. No NEAR AI Cloud call.</p>
      <input type="hidden" name="id" value="${rec.id}" />
      <label class="dl">Original file</label><input type="file" name="file" required />
      <label class="dl">Salt (hex)</label><input class="hash" name="salt" value="${state.walk.salt || ""}" placeholder="64 hex chars" style="width:100%;height:36px;border:1px solid var(--t);border-radius:8px;padding:0 10px" />
      <button class="btn" type="submit">${svg("shieldok", 16)}Verify from chain</button>
      ${
        state.verify
          ? `<p class="${state.verify.evidence_commitment ? "recd" : ""}" style="color:${
              state.verify.evidence_commitment ? "var(--bh)" : "var(--w)"
            }">${state.verify.evidence_commitment ? "Match" : "Mismatch"} · expected ${shortHash(
              state.verify.expected
            )} · found ${shortHash(state.verify.found)}</p>`
          : ""
      }
    </form>`
  );
}

function viewFinding() {
  const findings = (state.status?.receipts || []).filter((r) => kindLabel(r.kind) === "Finding");
  const rec = findings[findings.length - 1];
  return shell(
    "finding",
    'Cases <span>›</span> <b>Finding</b>',
    null,
    rec
      ? `<div class="split">
        <div class="card det">
          <div class="dh"><div class="eyebrow">Finding</div><h2>On-chain Finding ${rec.id}</h2>
            <div class="dm">${verdictChip(rec.policy_verdict)} <span class="mono mut">${rec.finding?.model_id || ""}</span></div></div>
          <div class="dsec"><div class="dl">Citation hashes</div>
            ${(rec.finding?.citation_hashes || [])
              .map((h) => `<div class="hash" style="background:var(--h);border:1px solid var(--l);border-radius:6px;padding:6px 8px">${hexOf(h) || shortHash(h)}</div>`)
              .join("") || "<p class='mut'>None</p>"}
          </div>
          <div class="dsec"><a class="lnk" href="#/receipt/${rec.id}">Open receipt ${svg("arrow", 13)}</a></div>
        </div>
        <aside class="card det">
          <div class="dh"><div class="eyebrow">Evidence viewer</div><h2>Byte-for-byte citations</h2></div>
          <div class="dsec"><p class="lede">Open the original file in Verify from chain. A matching quote is marked: Citation check passed, byte-for-byte match.</p></div>
        </aside>
      </div>`
      : `<p class="lede empty">No findings yet. Run analysis to write a receipt.</p>`
  );
}

function viewCustody() {
  const w = state.walk;
  const rid = w.receiptId ?? 1;
  return shell(
    "custody",
    'Cases <span>›</span> Larkmoor <span>›</span> <b>Custody check</b>',
    null,
    `<div class="hd"><div><h1>Custody check</h1><p class="lede">Drop a file against a stored commitment. A mismatch is a custody break, not a crash.</p></div></div>
    <form id="custody-drop" class="card" style="padding:18px 20px;display:grid;gap:12px">
      <label class="dl">Drop the original file (match) or a flipped copy (CUSTODY BREAK)</label>
      <input type="file" name="file" />
      ${state.custodyMsg ? `<p class="${state.custodyMsg.ok ? "recd" : ""}" style="color:${state.custodyMsg.ok ? "var(--bh)" : "var(--w)"}">${state.custodyMsg.text}</p>` : ""}
    </form>
    <form id="custody-form" class="card" style="padding:18px 20px;display:grid;gap:12px">
      <label class="dl">Expected receipt id</label>
      <input name="expected_receipt_id" value="${rid}" style="height:36px;border:1px solid var(--t);border-radius:8px;padding:0 10px" />
      <label class="dl">Evidence commitment (hex)</label>
      <input name="evidence_commitment" class="mono" value="${w.commitment || ""}" placeholder="64-byte hex" style="height:36px;border:1px solid var(--t);border-radius:8px;padding:0 10px" />
      <label class="ack"><input type="checkbox" name="matched" /> File matches the custody record</label>
      <button class="btn primary" type="submit">${svg("link", 17)}Record custody check</button>
    </form>
    <p class="lede">Uncheck the box to record a BREAK (BLOCK). Check it to record a match (ACCEPT).</p>`
  );
}

function viewSecurity() {
  const atk = state.attack;
  const result = atk
    ? `<div class="res">
        <div class="rtop"><div class="rsh">${svg("shieldok", 34, 1.8)}</div>
          <div><div class="rey">${atk.label}</div><div class="rh">${atk.rejected ? "Rejected by NEAR before it ran" : "Unexpected: transaction accepted"}</div></div></div>
        <p class="rline">Rejected before execution, nothing was recorded, no funds moved.</p>
        <div class="rerr"><span class="rl">NEAR protocol error</span><span class="code">${atk.expect}</span></div>
        <div class="facts">
          <div><span>Funds moved</span><b>0 NEAR</b></div>
          <div><span>Recorded</span><b>Nothing</b></div>
          <div><span>Explorer link</span><b>None: nothing executed</b></div>
          <div><span>Hash</span><b>${atk.tx_hash || "none"}</b></div>
        </div>
      </div>`
    : "";
  return shell(
    "security",
    'Cases <span>›</span> Larkmoor <span>›</span> <b>Security</b>',
    null,
    `<div class="hd"><div><div class="eyebrow">Security</div><h1>Can a stolen key move funds?</h1>
      <p class="lede">The app writer key is a function-call key. Try the four protocol rejections on testnet.</p></div></div>
    <div class="g">
      <section class="card lim">
        <div class="lh"><span class="lic">${svg("key", 18)}</span><div><h2>Writer key</h2><div class="sub">Not your wallet key.</div></div></div>
        <dl class="kv">
          <div><dt>Account</dt><dd class="mono">${state.status?.writer || "ftwriter15e434.testnet"}</dd></div>
          <div><dt>Works only on</dt><dd class="mono">${state.status?.contract || ""}</dd></div>
          <div><dt>Can call</dt><dd><span class="mono tag">record_finding</span><span class="mono tag">record_custody_check</span></dd></div>
          <div><dt>Can't</dt><dd class="cant">Transfer NEAR · add or delete keys · call other contracts · attach deposits</dd></div>
        </dl>
        <div class="wal">${svg("info", 16, 2.2)}<p><b>Your wallet key is different.</b> A stolen full-access key could move funds. The writer full-access key stays offline.</p></div>
      </section>
      <section class="card sim">
        <div class="simh"><div><h2>Simulate stolen key</h2><div class="sub">Each attempt is a real signed send_tx on testnet.</div></div></div>
        ${result}
        <div class="ars">
          <div class="ar"><span class="an">${svg("send", 15)}</span><div><div class="al">Transfer</div><div class="ae">Expected <span class="mono">RequiresFullAccess</span></div></div><div class="sp"></div><button class="btn" data-atk="transfer">Attempt</button></div>
          <div class="ar"><span class="an">${svg("arrow", 15)}</span><div><div class="al">Call a different contract</div><div class="ae">Expected <span class="mono">ReceiverMismatch</span></div></div><div class="sp"></div><button class="btn" data-atk="receiver">Attempt</button></div>
          <div class="ar"><span class="an">${svg("arrow", 15)}</span><div><div class="al">Call a method that isn't allowed</div><div class="ae">Expected <span class="mono">MethodNameMismatch</span></div></div><div class="sp"></div><button class="btn" data-atk="method">Attempt</button></div>
          <div class="ar"><span class="an">${svg("arrow", 15)}</span><div><div class="al">Attach a deposit</div><div class="ae">Expected <span class="mono">DepositWithFunctionCall</span></div></div><div class="sp"></div><button class="btn" data-atk="deposit">Attempt</button></div>
        </div>
      </section>
    </div>`
  );
}

function viewApprovals() {
  const holds = holdReceipts(state.status);
  const decided = new Set(
    (state.status?.receipts || [])
      .filter((r) => {
        const k = kindLabel(r.kind);
        return k === "Approval" || k === "Rejection";
      })
      .map((r) => Number(String(r.reason || "").match(/receipt=(\d+)/)?.[1]))
      .filter((n) => Number.isFinite(n))
  );
  const pending = holds.filter((r) => !decided.has(Number(r.id)));
  const cards = pending
    .map((r) => {
      const hashes = (r.finding?.citation_hashes || []).map((h) => `<div class="hash">${hexOf(h) || shortHash(h)}</div>`).join("");
      const why = (r.reason || "P4 irreversible action: isolate_host");
      return `<article class="card det" style="padding:0">
        <div class="dh"><div class="eyebrow">HOLD</div><h2>Isolate host xfer-01</h2>
          <div class="dm">${verdictChip(r.policy_verdict)} receipt ${r.id} · ${r.case_id}</div></div>
        <div class="dsec"><div class="dl">Why it was held</div><p class="lede">${why}. Policy P4: irreversible actions wait for a human.</p></div>
        <div class="dsec"><div class="dl">Citations</div>${hashes || "<p class='mut'>On-chain citation hashes only</p>"}</div>
        <div class="dsec"><p class="lede">The app never performs isolate, block, delete, or notify. It only records your decision.</p>
          <form class="hold-form" data-id="${r.id}" style="display:grid;gap:10px">
            <label class="dl">Reason (required before signature)</label>
            <input name="reason" required style="height:36px;border:1px solid var(--t);border-radius:8px;padding:0 10px" />
            <div style="display:flex;gap:8px">
              <button class="btn danger" type="submit" name="decision" value="reject">Reject</button>
              <button class="btn" type="submit" name="decision" value="approve">Approve</button>
            </div>
          </form>
        </div>
      </article>`;
    })
    .join("");
  return shell(
    "approvals",
    "<b>Approvals</b>",
    null,
    `<div class="hd"><div><h1>Approvals</h1><p class="lede">HOLD receipts from the contract. Reject is the default. The app never performs the action itself.</p></div></div>
    ${cards || `<div class="card" style="padding:24px;text-align:center"><p class="lede empty">No actions waiting for approval</p></div>`}`
  );
}

function viewAccess() {
  const w = state.walk;
  const denied = (w.denied || [])
    .map((d) => `<tr><td class="mono">${d.account}</td><td>OpenDenied</td><td class="mono">${d.tx || "—"}</td></tr>`)
    .join("");
  return shell(
    "access",
    "<b>Access</b>",
    null,
    `<div class="hd"><div><h1>Access</h1><p class="lede">Who can open this case. Revoking cannot un-see files already opened.</p></div></div>
    <div class="card tbl"><div class="tbar"><h2>Grantees</h2></div>
      <table><thead><tr><th>Account</th><th>Granted</th></tr></thead>
      <tbody>
        <tr><td class="mono">${state.status?.owner || "ftowner15e434.testnet"}</td><td>Owner</td></tr>
        ${w.grantAccount ? `<tr><td class="mono">${w.grantAccount}</td><td>Granted</td></tr>` : ""}
      </tbody></table>
    </div>
    <form id="grant-form" class="card" style="padding:16px 20px;display:grid;gap:10px">
      <label class="dl">Grant an account access</label>
      <input name="account" placeholder="account.testnet" required style="height:36px;border:1px solid var(--t);border-radius:8px;padding:0 10px" />
      <button class="btn primary" type="submit">Grant</button>
      ${state.grantMsg ? `<p class="lede">${state.grantMsg}</p>` : ""}
    </form>
    <form id="open-form" class="card" style="padding:16px 20px;display:grid;gap:10px">
      <label class="dl">Request open (denied attempts are recorded)</label>
      <input name="account_note" placeholder="reason" style="height:36px;border:1px solid var(--t);border-radius:8px;padding:0 10px" />
      <button class="btn" type="submit">Request open</button>
    </form>
    <div class="card tbl"><div class="tbar"><h2>Denied attempts</h2></div>
      <table><thead><tr><th>Account</th><th>Kind</th><th>Tx</th></tr></thead>
      <tbody>${denied || `<tr><td colspan="3" class="empty">No denied attempts yet. Request open without a grant to record OpenDenied.</td></tr>`}</tbody></table>
    </div>`
  );
}

function viewReports() {
  return shell(
    "reports",
    "<b>Reports</b>",
    null,
    `<div class="hd"><div><h1>Case report</h1><p class="lede">Triage tool, not court-certified. Attestation notes travel with the export.</p></div>
      <div style="display:flex;gap:8px">
        <button class="btn primary" id="export-json">${svg("report", 16)}Export JSON</button>
        <button class="btn" id="export-pdf">${svg("report", 16)}Export PDF</button>
      </div></div>
    <div class="card" style="padding:18px 20px">
      <p>Receipts on chain: <b>${state.status?.receipt_count ?? "—"}</b></p>
      <p class="lede">JSON and PDF share the same export. Triage tool, not court-certified. Sample items are FICTIONAL.</p>
    </div>`
  );
}

function wizardPane() {
  const s = state.setup;
  const writer = state.status?.writer || "ftwriter15e434.testnet";
  const short = shortAccount(writer);
  if (s.step === "connect") {
    return `<div class="eyebrow">Step 1</div>
      <h1>Connect wallet</h1>
      <p class="lede">Uses the existing writer connection on this machine. Next unlocks once connected.</p>
      <div class="wiz-acct">
        <div class="acct"><span class="av">FT</span>${short}</div>
        <span class="chip net">${svg("info", 13)}Testnet</span>
      </div>
      <dl class="kv" style="margin-top:16px">
        <div><dt>Account</dt><dd class="mono">${writer}</dd></div>
        <div><dt>Network</dt><dd><span class="chip net">Testnet</span></dd></div>
      </dl>
      <button class="btn primary" type="button" id="connect-btn">${s.connected ? svg("check", 16) + " Connected" : "Connect"}</button>`;
  }
  if (s.step === "source") {
    return `<div class="eyebrow">Step 2</div>
      <h1>Choose a source</h1>
      <p class="lede">Upload evidence for POST /analyze, or load the FICTIONAL Larkmoor sample. Nothing new is stored beyond the existing commitment.</p>
      <input type="file" name="file" id="wiz-file" hidden />
      <div class="src-grid">
        <button type="button" class="src-card${s.source === "upload" ? " on" : ""}" id="wiz-upload">
          <strong>Upload evidence</strong>
          <span>Existing upload. Feeds POST /analyze.</span>
        </button>
        <button type="button" class="src-card${s.source === "sample" ? " on" : ""}" id="wiz-sample">
          <strong>Load the sample incident</strong>
          <span>FICTIONAL MOVEit-style Larkmoor listing.</span>
        </button>
      </div>
      ${
        s.commitment
          ? `<div class="dsec" style="padding:12px 0"><div class="dl">Salted commitment</div>
             <p class="hash">${s.commitment}</p>
             <span class="fx">encrypted at rest</span>
             <span class="fx">FICTIONAL</span>
             <p class="lede">${s.evidenceName}</p></div>`
          : `<p class="lede empty">No evidence yet. Upload a file or load the sample.</p>`
      }`;
  }
  if (s.step === "case") {
    return `<div class="eyebrow">Step 3</div>
      <h1>Create the case</h1>
      <p class="lede">Name and short description. Sample items stay marked FICTIONAL.</p>
      <form id="wiz-case" class="wiz-form">
        <label class="dl" for="cname">Case name</label>
        <input id="cname" name="name" required value="${s.caseName || ""}" />
        <label class="dl" for="cdesc">Short description</label>
        <input id="cdesc" name="desc" required value="${s.caseDesc || ""}" />
      </form>
      <p class="mut">Per-case file location is not stored in the app. TBD — not shown.</p>`;
  }
  return `<div class="eyebrow">Step 4</div>
    <h1>Confirm and go</h1>
    <p class="lede">Create the case and open the workspace with evidence loaded. Analyze is highlighted next.</p>
    <dl class="kv">
      <div><dt>Account</dt><dd class="mono">${short}</dd></div>
      <div><dt>Network</dt><dd><span class="chip net">Testnet</span></dd></div>
      <div><dt>Source</dt><dd>${s.evidenceName || "—"} <span class="fx">FICTIONAL</span></dd></div>
      <div><dt>Case</dt><dd>${s.caseName || "—"}</dd></div>
      <div><dt>Description</dt><dd>${s.caseDesc || "—"}</dd></div>
    </dl>`;
}

function viewSetup() {
  const s = state.setup;
  const idx = setupIndex(s.step);
  const valid = setupValid(s);
  const last = s.step === "confirm";
  const steps = SETUP_STEPS.map((st, i) => {
    const cls = i === idx ? "on" : i < idx ? "done" : "";
    return `<li class="${cls}"><span>${st.n}</span>${st.label}</li>`;
  }).join("");
  return shell(
    "cases",
    "<b>First-run setup</b>",
    null,
    `<div class="wiz card">
      <ol class="wiz-steps" aria-label="Setup">${steps}</ol>
      <div class="wiz-body">
        ${wizardPane()}
        <div class="wiz-nav">
          <button class="btn" type="button" id="wiz-back"${idx === 0 ? " disabled" : ""}>Back</button>
          <button class="btn ghost" type="button" id="wiz-skip">Skip setup</button>
          <div class="sp"></div>
          <button class="btn primary" type="button" id="wiz-next" ${valid ? "" : "disabled"}>${
            last ? "Create case and start" : "Next"
          }</button>
        </div>
      </div>
    </div>`
  );
}

const views = {
  land: viewLand,
  cases: viewCases,
  workspace: viewWorkspace,
  analyze: viewAnalyze,
  receipt: viewReceipt,
  finding: viewFinding,
  custody: viewCustody,
  security: viewSecurity,
  approvals: viewApprovals,
  access: viewAccess,
  reports: viewReports,
  setup: viewSetup,
};

function render() {
  const fn = views[state.view] || viewCases;
  const el = document.getElementById("app");
  el.classList.toggle("land-mode", state.view === "land");
  el.innerHTML = fn();
  bind();
}

function goWalk(step) {
  state.walk.step = step;
  persistWalk();
  if (step === "land") {
    location.hash = "";
    state.view = "land";
    render();
    return;
  }
  location.hash = `#/${routeForStep(step)}`;
}

function bindSetup() {
  const skip = document.getElementById("wiz-skip");
  if (skip) {
    skip.onclick = () => {
      state.setup.skipped = true;
      persistSetup();
      location.hash = "#/cases";
    };
  }
  const back = document.getElementById("wiz-back");
  if (back) {
    back.onclick = () => {
      state.setup.step = setupPrev(state.setup.step);
      persistSetup();
      render();
    };
  }
  const nxt = document.getElementById("wiz-next");
  if (nxt) {
    nxt.onclick = () => {
      const s = state.setup;
      if (s.step === "case") {
        const f = document.getElementById("wiz-case");
        s.caseName = f.name.value.trim();
        s.caseDesc = f.desc.value.trim();
      }
      if (s.step === "confirm") {
        s.completed = true;
        s.highlightAnalyze = true;
        persistSetup();
        state.walk.caseName = s.caseName;
        state.walk.caseDesc = s.caseDesc;
        state.walk.evidenceName = s.evidenceName;
        state.walk.commitment = s.commitment;
        state.walk.salt = s.salt;
        persistWalk();
        location.hash = "#/workspace";
        return;
      }
      s.step = setupNext(s.step);
      persistSetup();
      render();
    };
  }
  const conn = document.getElementById("connect-btn");
  if (conn && state.view === "setup") {
    conn.onclick = () => {
      state.setup.connected = true;
      persistSetup();
      render();
    };
  }
  const cf = document.getElementById("wiz-case");
  if (cf) {
    cf.oninput = () => {
      state.setup.caseName = cf.name.value.trim();
      state.setup.caseDesc = cf.desc.value.trim();
      persistSetup();
      const n = document.getElementById("wiz-next");
      if (n) n.disabled = !setupValid(state.setup);
    };
  }
  const wf = document.getElementById("wiz-file");
  if (wf) {
    wf.onchange = async () => {
      if (!wf.files[0]) return;
      await commitFile(wf.files[0], "upload");
    };
  }
  const wu = document.getElementById("wiz-upload");
  if (wu && wf) {
    wu.onclick = () => wf.click();
  }
  const ws = document.getElementById("wiz-sample");
  if (ws) {
    ws.onclick = async (e) => {
      e.preventDefault();
      state.setup.source = "sample";
      persistSetup();
      const sample = await (await fetch("/api/sample")).json();
      const blob = new Blob([sample.text], { type: "text/plain" });
      const file = new File([blob], sample.name, { type: "text/plain" });
      await commitFile(file, "sample");
    };
  }
  const nc = document.getElementById("new-case");
  if (nc) {
    nc.onclick = () => {
      state.setup = { ...defaultSetup() };
      persistSetup();
      location.hash = "#/setup";
      state.view = "setup";
      render();
    };
  }
}

function bindWalk() {
  bindSetup();
  const landNew = document.getElementById("land-new");
  if (landNew) {
    landNew.onclick = () => {
      state.walk = { ...defaultWalk(), step: "connect" };
      persistWalk();
      goWalk("connect");
    };
  }
  const landSample = document.getElementById("land-sample");
  if (landSample) {
    landSample.onclick = async () => {
      state.walk = {
        ...defaultWalk(),
        step: "connect",
        caseName: "Larkmoor Records Office",
        caseDesc: "FICTIONAL MOVEit-style file-transfer incident",
        caseId: "larkmoor-demo",
      };
      persistWalk();
      goWalk("connect");
    };
  }
  const landVerify = document.getElementById("land-verify");
  if (landVerify) {
    landVerify.onclick = (e) => {
      e.preventDefault();
      state.walk.skipped = true;
      persistWalk();
      location.hash = "#/receipt";
    };
  }
  const skip = document.getElementById("walk-skip");
  if (skip) {
    skip.onclick = (e) => {
      e.preventDefault();
      state.walk.skipped = true;
      persistWalk();
      location.hash = "#/cases";
    };
  }
  const back = document.getElementById("walk-back");
  if (back) {
    back.onclick = () => goWalk(prevStep(state.walk));
  }
  const nxt = document.getElementById("walk-next");
  if (nxt) {
    nxt.onclick = () => {
      const w = state.walk;
      if (w.step === "analyze" && w.analyzeError) {
        w.analyzeError = null;
        persistWalk();
        render();
        return;
      }
      if (w.step === "case") {
        const f = document.getElementById("case-form");
        if (f) {
          w.caseName = f.name.value.trim();
          w.caseDesc = f.desc.value.trim();
        }
        persistWalk();
        goWalk("evidence");
        return;
      }
      if (w.step === "report") {
        w.completed = true;
        persistWalk();
        location.hash = "#/cases";
        return;
      }
      goWalk(nextStep(w));
    };
  }
  const conn = document.getElementById("connect-btn");
  if (conn && state.view !== "setup") {
    conn.onclick = () => {
      state.walk.connected = true;
      persistWalk();
      render();
    };
  }
  const tm = document.getElementById("top-menu");
  if (tm) {
    tm.onclick = () => {
      state.menuOpen = !state.menuOpen;
      render();
    };
  }
  const rw = document.getElementById("restart-walk");
  if (rw) {
    rw.onclick = () => {
      state.walk = defaultWalk();
      persistWalk();
      goWalk("land");
    };
  }
  const cf = document.getElementById("case-form");
  if (cf) {
    cf.oninput = () => {
      state.walk.caseName = cf.name.value.trim();
      state.walk.caseDesc = cf.desc.value.trim();
      persistWalk();
      const n = document.getElementById("walk-next");
      if (n) n.disabled = !nextEnabled(state.walk);
    };
  }
}

async function commitFile(file, source) {
  const b64 = await fileToB64(file);
  const data = await (
    await fetch("/api/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_b64: b64 }),
    })
  ).json();
  state.walk.evidenceName = file.name;
  state.walk.salt = data.salt;
  state.walk.commitment = data.commitment;
  persistWalk();
  state.setup.source = source || state.setup.source || "upload";
  state.setup.evidenceName = file.name;
  state.setup.salt = data.salt;
  state.setup.commitment = data.commitment;
  persistSetup();
  render();
}

function bind() {
  bindWalk();
  const evf = document.getElementById("ev-form");
  if (evf) {
    evf.file.onchange = async () => {
      if (evf.file.files[0]) await commitFile(evf.file.files[0]);
    };
  }
  const ls = document.getElementById("load-sample");
  if (ls) {
    ls.onclick = async () => {
      const s = await (await fetch("/api/sample")).json();
      const blob = new Blob([s.text], { type: "text/plain" });
      const file = new File([blob], s.name, { type: "text/plain" });
      await commitFile(file);
    };
  }
  const af = document.getElementById("analyze-form");
  if (af) {
    af.onsubmit = async (e) => {
      e.preventDefault();
      const file = af.file.files[0];
      if (!file) return;
      state.analyze = { running: true, tick: 0 };
      render();
      const iv = setInterval(() => {
        if (!state.analyze?.running) return;
        state.analyze.tick = Math.min(STEPS.length - 2, (state.analyze.tick || 0) + 1);
        render();
      }, 700);
      try {
        const res = await fetch("/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream", "X-Case-Id": "larkmoor-demo" },
          body: await file.arrayBuffer(),
        });
        const data = await res.json();
        clearInterval(iv);
        if (!res.ok) {
          state.analyze = { done: true, error: data.error || data.code, skip_chain: data.skip_chain };
          state.walk.analyzeError = data.error || data.code;
          state.walk.receiptId = null;
          persistWalk();
        } else {
          state.analyze = { done: true, ...data };
          state.walk.analyzeError = null;
          state.walk.receiptId = data.receipt_id;
          state.walk.policy = data.policy;
          if (data.salt) state.walk.salt = data.salt;
          persistWalk();
          await loadStatus();
          return;
        }
      } catch (err) {
        clearInterval(iv);
        state.analyze = { done: true, error: String(err.message) };
      }
      render();
    };
  }
  const vf = document.getElementById("verify-form");
  if (vf) {
    vf.onsubmit = async (e) => {
      e.preventDefault();
      const file = vf.file.files[0];
      const salt = vf.salt.value.trim();
      const buf = new Uint8Array(await file.arrayBuffer());
      let b64 = "";
      for (let i = 0; i < buf.length; i += 0x8000) {
        b64 += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      }
      const data = await (
        await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: vf.id.value,
            salt,
            file_b64: btoa(b64),
          }),
        })
      ).json();
      state.verify = data;
      render();
    };
  }
  const drop = document.getElementById("custody-drop");
  if (drop) {
    drop.file.onchange = async () => {
      const file = drop.file.files[0];
      if (!file) return;
      const b64 = await fileToB64(file);
      const data = await (
        await fetch("/api/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_b64: b64, salt: state.walk.salt }),
        })
      ).json();
      const ok = data.commitment === state.walk.commitment;
      state.custodyMsg = {
        ok,
        text: ok ? "Match — custody intact" : "CUSTODY BREAK — fingerprint does not match",
      };
      const box = document.querySelector('#custody-form input[name="matched"]');
      if (box) box.checked = ok;
      render();
    };
  }
  const gf = document.getElementById("grant-form");
  if (gf) {
    gf.onsubmit = async (e) => {
      e.preventDefault();
      const account = gf.account.value.trim();
      const data = await (
        await fetch("/custody/grant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ case_id: state.walk.caseId || "larkmoor-demo", account }),
        })
      ).json();
      state.walk.grantAccount = account;
      state.grantMsg = data.tx ? `Granted · ${data.tx}` : JSON.stringify(data);
      persistWalk();
      render();
    };
  }
  const of = document.getElementById("open-form");
  if (of) {
    of.onsubmit = async (e) => {
      e.preventDefault();
      const data = await (
        await fetch("/custody/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            case_id: state.walk.caseId || "larkmoor-demo",
            evidence_id: "E1",
            reason: of.account_note.value || "walkthrough open",
          }),
        })
      ).json();
      state.walk.denied = state.walk.denied || [];
      state.walk.denied.push({ account: state.status?.writer || "unknown", tx: data.tx });
      persistWalk();
      await loadStatus();
    };
  }
  document.querySelectorAll(".hold-form").forEach((hf) => {
    hf.onsubmit = async (e) => {
      e.preventDefault();
      const reason = hf.reason.value.trim();
      if (!reason) return;
      const decision = e.submitter?.value || "reject";
      const data = await (
        await fetch("/custody/hold", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            case_id: "larkmoor-demo",
            receipt_id: Number(hf.dataset.id),
            decision,
            reason,
          }),
        })
      ).json();
      state.grantMsg = `${data.kind} receipt ${data.receipt_id} · ${data.tx}`;
      await loadStatus();
    };
  });
  const cf = document.getElementById("custody-form");
  if (cf) {
    cf.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(cf);
      const body = {
        case_id: "larkmoor-demo",
        expected_receipt_id: Number(fd.get("expected_receipt_id")),
        evidence_commitment: fd.get("evidence_commitment"),
        matched: fd.get("matched") === "on",
      };
      const data = await (
        await fetch("/custody/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json();
      alert(data.tx ? `Recorded ${data.tx}` : JSON.stringify(data));
      await loadStatus();
    };
  }
  document.querySelectorAll("[data-atk]").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      const data = await (
        await fetch("/api/security", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: b.dataset.atk }),
        })
      ).json();
      state.attack = data;
      render();
    };
  });
  const ex = document.getElementById("export-json");
  if (ex) {
    ex.onclick = async () => {
      const data = await (await fetch("/api/export")).json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "custody-log.json";
      a.click();
    };
  }
  const pdf = document.getElementById("export-pdf");
  if (pdf) {
    pdf.onclick = () => {
      location.href = "/api/export.pdf";
    };
  }
}

window.addEventListener("hashchange", route);
route();
loadStatus();
