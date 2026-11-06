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
  decidedHolds,
  pendingHolds,
  fileToB64,
} from "./walk.js?v=__ASSET_V__";
import {
  loadSetup,
  saveSetup,
  defaultSetup,
  SETUP_STEPS,
  setupIndex,
  setupNext,
  setupPrev,
  setupValid,
} from "./setup.js?v=__ASSET_V__";
import {
  loadWallet,
  saveWallet,
  defaultWallet,
  shortAccount,
  openWalletPicker,
  signOutWallet,
  syncFromSelector,
  ensureSelector,
  signFunctionCall,
} from "./wallet.js?v=__ASSET_V__";

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
  statusLoading: true,
  error: null,
  analyze: null,
  verify: null,
  attack: null,
  file: null,
  receipts: {},
  exportData: null,
  exportMsg: null,
  exportLoading: false,
  walk: loadWalk(),
  setup: loadSetup(),
  wallet: loadWallet(),
  menuOpen: false,
  grantMsg: null,
  custodyMsg: null,
  searchQ: "",
  searchOpen: false,
  searchHi: 0,
  filterQ: "",
  busy: null,
  fatal: null,
  sampleText: "",
  sampleSalt: "",
  localFindings: {},
};

function persistWalk() {
  saveWalk(state.walk);
}

function persistSetup() {
  saveSetup(state.setup);
}

function persistWallet() {
  saveWallet(state.wallet);
}

function setupOpen() {
  const s = state.setup;
  return !s.completed && !s.skipped;
}

function route() {
  state.walk = loadWalk();
  state.setup = loadSetup();
  state.wallet = loadWallet();
  let h = location.hash.replace(/^#\/?/, "");

  if (!h) {
    history.replaceState(null, "", "#/setup");
    h = "setup";
  }

  if (h === "setup" || h === "land") {
    if (!setupOpen()) {
      state.setup = { ...defaultSetup(), completed: false, skipped: false, step: "connect" };
      persistSetup();
    }
    state.view = "setup";
    state.arg = undefined;
    render();
    return;
  }

  const [view, arg] = h.split("/");
  state.view = view || "cases";
  state.arg = arg;
  render();
}

let statusOnce = false;
async function loadStatus() {
  state.statusLoading = true;
  try {
    state.status = await (await fetch("/api/status")).json();
    state.statusLoading = false;
  } catch (e) {
    state.error = String(e.message);
    state.statusLoading = false;
  }
  render();
  prefetchReceipts();
}

const receiptReq = {};
function getReceipt(id) {
  id = Number(id);
  if (!receiptReq[id]) {
    receiptReq[id] = fetch(`/api/receipt/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        state.receipts[id] = d;
        return d;
      })
      .catch(() => {
        state.receipts[id] = null;
        return null;
      });
  }
  return receiptReq[id];
}

async function prefetchReceipts() {
  const ids = (state.status?.receipts || []).map((r) => Number(r.id));
  await Promise.all(ids.map(getReceipt));
  render();
}

function bytesToHexReplacer(_k, v) {
  return Array.isArray(v) && v.length && v.every((n) => typeof n === "number") ? hexOf(v) : v;
}

function writeHeaders(extra = {}) {
  const t = sessionStorage.getItem("custos-write-token") || "";
  const h = { ...extra };
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

function kindLabel(k) {
  if (k == null || k === "") return "—";
  if (typeof k === "object") return Object.keys(k)[0] || "—";
  return String(k);
}

function kindChip(kind) {
  const k = kindLabel(kind);
  if (k === "Open") return `<span class="v accept">${svg("check", 13, 2.5)}OPEN</span>`;
  if (k === "OpenDenied") return `<span class="v block">${svg("block", 13, 2.5)}OPEN DENIED</span>`;
  if (k === "Rejection") return `<span class="v block">${svg("block", 13, 2.5)}REJECTION</span>`;
  if (k === "Approval") return `<span class="v accept">${svg("check", 13, 2.5)}APPROVAL</span>`;
  return `<span class="v hold">${esc(k)}</span>`;
}

function verdictOrKind(r) {
  return r.policy_verdict ? verdictChip(r.policy_verdict) : kindChip(r.kind);
}

function writeFailMsg(data, status) {
  if (status === 401 || data?.error === "unauthorized") {
    return "Demo mode is off: this action needs an operator token";
  }
  return data?.error || data?.detail || data?.message || "request failed";
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

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function copyVal(full) {
  const s = String(full || "");
  if (!s) return "—";
  const vis = s.length > 20 ? `${s.slice(0, 8)}…${s.slice(-8)}` : s;
  return `<span class="copyval" title="${esc(s)}"><span class="mono">${esc(vis)}</span>
    <button type="button" class="copy" data-copy="${encodeURIComponent(s)}">${svg("copy", 13)}Copy</button></span>`;
}

function hexOf(arr) {
  if (!arr) return "";
  if (typeof arr === "string") return arr;
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const NEARBLOCKS = "https://testnet.nearblocks.io";

function explorerTx(tx) {
  return `${NEARBLOCKS}/txns/${tx}`;
}

function caseName() {
  return state.setup.caseName || state.walk.caseName || "Larkmoor Records Office";
}
function crumb(page) {
  return `Cases <span>›</span> ${esc(caseName())} <span>›</span> <b>${page}</b>`;
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
    ${item("analyze", "list", "Analysis", "#/analyze")}
    ${item("security", "key", "Security", "#/security")}
    ${item("reports", "report", "Reports", "#/reports")}
  </nav>`;
}

function sampleLabel(name) {
  const n = String(name || "");
  return /larkmoor|sample/i.test(n) ? ` <span class="fx">Sample case: training data</span>` : "";
}

function tree(active) {
  const n = state.statusLoading ? "…" : state.status?.receipt_count ?? "—";
  const q = (state.filterQ || "").toLowerCase();
  const items = [
    ["cases", "folder", "All cases", "#/cases", "1", ""],
    ["approvals", "hold", "Approvals", "#/approvals", String(pendingHolds(state.status).length || ""), "hold"],
    ["access", "users", "Access", "#/access", "", ""],
    ["workspace", "file", "Evidence files", "#/workspace", state.walk.evidenceName ? "1" : "", ""],
    ["custody", "hash", "Custody check", "#/custody", "", ""],
    ["receipt", "link", "Custody log", "#/receipt", String(n), ""],
    ["finding", "flag", "Findings", "#/finding", "", ""],
    ["reports", "report", "Case report", "#/reports", "", ""],
  ].filter((it) => !q || it[2].toLowerCase().includes(q));
  const link = ([id, icon, label, href, badge, bcls]) =>
    `<a class="tn${active === id ? " on" : ""}" href="${href}">${svg(icon, 15)}${label}${
      badge ? `<span class="c ${bcls}">${badge}</span>` : ""
    }</a>`;
  return `<aside class="side">
    <div class="sh">
      <div class="k">Case</div>
      <div class="t">${esc(caseName())}</div>
      <div class="m">${state.setup.caseDesc || state.walk.caseDesc || "File-transfer breach"}${sampleLabel(
        state.setup.evidenceName || state.walk.evidenceName || "larkmoor"
      )}</div>
    </div>
    <label class="ssearch">${svg("search", 14)}<input id="side-filter" type="search" placeholder="Filter pages and log" value="${esc(
      state.filterQ
    )}" /></label>
    <div class="tree">
      ${(() => {
        const group = (title, ids) => {
          const g = items.filter((i) => ids.includes(i[0]));
          return g.length ? `<div class="tg">${title}</div>${g.map(link).join("")}` : "";
        };
        const html =
          group("Cases", ["cases", "approvals", "access"]) +
          group("Evidence", ["workspace", "custody", "receipt"]) +
          group("Analysis", ["finding"]) +
          group("Reports", ["reports"]);
        return html || `<div class="tg">No matches for '${esc(state.filterQ)}'</div>`;
      })()}
    </div>
    <div class="sfoot">${svg("lock", 13)}Evidence encrypted at rest</div>
  </aside>`;
}

function lastAnalysisChip() {
  const findings = (state.status?.receipts || []).filter((r) => kindLabel(r.kind) === "Finding");
  if (!findings.length) return `<span class="chip net">No analysis yet</span>`;
  const last = findings[findings.length - 1];
  const v = kindLabel(last.policy_verdict);
  if (v === "Hold") {
    const d = decidedHolds(state.status).get(Number(last.id));
    return d
      ? `<span class="chip net">${svg("hold", 13)}Last analysis: Hold · ${d.decision === "Rejection" ? "rejected" : "approved"} (receipt ${d.by})</span>`
      : `<span class="chip bad">${svg("hold", 13)}Last analysis: Hold · waiting</span>`;
  }
  const ok = v === "Accept";
  return `<span class="chip ${ok ? "ok" : "bad"}">${svg(ok ? "shieldok" : "flag", 13)}Last analysis: ${v || "Recorded"}</span>`;
}

function searchHits() {
  const q = (state.searchQ || "").trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  const list = state.status?.receipts || [];
  for (const r of list) {
    const full = state.receipts[r.id];
    const local = state.localFindings?.[r.id];
    const extra = local ? JSON.stringify(local) : "";
    const sample = state.sampleText || "";
    const blob = (JSON.stringify(r) + " " + (full ? JSON.stringify(full, bytesToHexReplacer) : "") + " " + extra + " " + sample).toLowerCase();
    if (blob.includes(q)) {
      hits.push({ type: "Receipts", label: `Receipt ${r.id} · ${kindLabel(r.kind)}`, href: `#/receipt/${r.id}` });
      const k = kindLabel(r.kind);
      const ref = Number(String(r.reason || "").match(/receipt=(\d+)/)?.[1]);
      if ((k === "Approval" || k === "Rejection") && Number.isFinite(ref)) {
        const held = list.find((x) => Number(x.id) === ref);
        if (held) {
          hits.push({
            type: "Receipts",
            label: `Receipt ${ref} · ${kindLabel(held.kind)} (${kindLabel(held.policy_verdict)}, decided in receipt ${r.id})`,
            href: `#/receipt/${ref}`,
          });
        }
      }
    }
    if (String(r.actor || "").toLowerCase().includes(q)) {
      hits.push({ type: "Accounts", label: r.actor, href: `#/receipt/${r.id}` });
    }
  }
  const ev = state.walk.evidenceName || state.setup.evidenceName;
  if (ev && ev.toLowerCase().includes(q)) {
    hits.push({ type: "Evidence", label: ev, href: "#/workspace" });
  }
  const seen = new Set();
  return hits.filter((h) => {
    const key = h.type + h.label + h.href;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function top(crumb, chip) {
  const wlt = state.wallet;
  const hits = state.searchOpen ? searchHits() : [];
  const groups = {};
  for (const h of hits) (groups[h.type] ||= []).push(h);
  const drop =
    state.searchOpen && state.searchQ
      ? `<div class="sdrop" id="search-drop">${
          hits.length
            ? Object.entries(groups)
                .map(
                  ([g, list]) =>
                    `<div class="sg">${g}</div>${list
                      .map((h) => `<a class="si" href="${h.href}">${esc(h.label)}</a>`)
                      .join("")}`
                )
                .join("")
            : `<div class="nores">No matches for '${esc(state.searchQ)}'</div>`
        }</div>`
      : "";
  const acct = wlt.connected && wlt.accountId
    ? `<div class="acct" title="${esc(wlt.accountId)}"><span class="av">${esc(
        wlt.accountId.slice(0, 2).toUpperCase()
      )}</span>${esc(shortAccount(wlt.accountId))}</div>`
    : `<button class="btn sm" type="button" id="top-connect">Connect</button>`;
  return `<header class="top">
    <a class="brand" href="#/setup">
      <span class="brand-name">Custos Seal</span>
      <span class="brand-sub">Private Forensic Triage Assistant</span>
    </a>
    <span class="brand-sep" aria-hidden="true"></span>
    <div class="crumb">${crumb}</div>
    <div class="sp"></div>
    <div class="gsearch">
      ${svg("search", 15)}
      <input id="gsearch" type="search" placeholder="Search evidence, findings, accounts…" value="${esc(
        state.searchQ
      )}" autocomplete="off" />
      <kbd>/</kbd>
      ${drop}
    </div>
    ${chip || lastAnalysisChip()}
    <span class="chip net">${svg("info", 13)}Testnet</span>
    ${acct}
    <div class="menuwrap"><button class="btn sm" id="top-menu" type="button">Menu</button>
       <div class="menu" id="top-menu-list" ${state.menuOpen ? "" : "hidden"}>
         ${wlt.connected ? `<button type="button" id="wallet-switch">Switch wallet</button>
         <button type="button" id="wallet-out">Disconnect</button>` : `<button type="button" id="top-connect-m">Connect wallet</button>`}
         <button type="button" id="restart-setup">Restart setup</button>
       </div></div>
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
  const n = state.statusLoading ? "Loading…" : `${state.status?.receipt_count ?? 0} receipts`;
  return `<footer class="status">
    <span>Custody log — <b>${n}</b></span>
    <span class="sep"></span>
    <span>NEAR testnet · <span class="mono">${state.status?.contract || "ftcust15e434.testnet"}</span></span>
    ${extra ? `<span class="sep"></span>${extra}` : ""}
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
      <p class="lede">Guided first run. Evidence is fingerprinted, not stored in the custody log.</p>
      <ol class="wbar landbar" aria-label="Walkthrough">
        ${BAR.map((b) => `<li><span>${b.n}</span> ${b.label}</li>`).join("")}
      </ol>
      <div class="land-acts">
        <button class="btn primary" type="button" id="land-new">${svg("plus", 17)}Start a new case</button>
        <button class="btn" type="button" id="land-sample">${svg("file", 17)}Try the sample case</button>
        <a class="btn" href="#/receipt" id="land-verify">${svg("link", 17)}Verify a receipt</a>
      </div>
    </div>
  </div>`;
}

function viewCases() {
  const w = state.walk;
  const holds = holdReceipts(state.status);
  const pending = pendingHolds(state.status);
  const decidedN = holds.length - pending.length;
  const fq = (state.filterQ || "").toLowerCase();
  const rows = (state.status?.receipts || [])
    .slice()
    .reverse()
    .filter((r) => !fq || JSON.stringify(r).toLowerCase().includes(fq))
    .map(
      (r) => `<tr>
      <td class="mono ts">${r.id}</td>
      <td>${kindLabel(r.kind)}</td>
      <td>${r.case_id || ""}</td>
      <td>${verdictOrKind(r)}</td>
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
      <a class="kpi hold" href="#/approvals"><div class="kh"><span class="ki">${svg("hold", 17)}</span>Waiting for approval</div><div class="kv">${pending.length}</div><div class="ks">${
        pending.length ? "HOLD receipts waiting for a decision" : decidedN ? `${decidedN} HOLD decided on chain` : "No HOLD items"
      }</div></a>
      <a class="kpi block" href="#/custody"><div class="kh"><span class="ki">${svg("shieldx", 17)}</span>Custody checks</div><div class="kv">${(state.status?.receipts || []).filter((r) => kindLabel(r.kind) === "CustodyCheck").length}</div><div class="ks">From the custody log</div></a>
      <a class="kpi flag" href="#/finding"><div class="kh"><span class="ki">${svg("flag", 17)}</span>Findings</div><div class="kv">${(state.status?.receipts || []).filter((r) => kindLabel(r.kind) === "Finding").length}</div><div class="ks">On-chain Finding receipts</div></a>
      <a class="kpi neutral" href="#/workspace"><div class="kh"><span class="ki">${svg("folder", 17)}</span>Open cases</div><div class="kv">1</div><div class="ks">Larkmoor Records Office</div></a>
    </div>
    <div class="card tbl"><div class="tbar"><h2>Custody log</h2><span class="cnt">${state.statusLoading ? "…" : state.status?.receipt_count ?? 0}</span></div>
    <table><thead><tr><th>Id</th><th>Kind</th><th>Case</th><th>Verdict</th><th>Actor</th><th></th></tr></thead>
    <tbody>${
      state.statusLoading
        ? `<tr><td colspan="6" class="empty">Loading custody log…</td></tr>`
        : rows || `<tr><td colspan="6" class="empty">No receipts yet. Upload a file and run analysis.</td></tr>`
    }</tbody></table></div>`
  );
}

function viewWorkspace() {
  const w = state.walk;
  const files = w.evidenceName
    ? `<tr><td class="cn">${svg("file", 15)}${w.evidenceName}</td><td class="mut">Uploaded</td></tr>`
    : `<tr><td colspan="2" class="empty">No local evidence file yet. Findings and receipts are already on chain for the sample case — Load the sample file below, or open <a href="#/finding">Findings</a> / <a href="#/receipt">Custody log</a>.</td></tr>`;
  return shell(
    "workspace",
    crumb("Evidence"),
    null,
    `<div class="hd"><div><h1>Evidence</h1><p class="lede">Upload a file, then run analysis. Citations must match byte-for-byte.</p></div>
      <a class="btn primary${state.setup.highlightAnalyze ? " ring" : ""}" href="#/analyze" id="ws-analyze">${svg("list", 17)}Analyze</a></div>
    <div class="split">
      <div class="lcol">
        <div class="card tbl"><div class="tbar"><h2>Files</h2></div>
          <table><thead><tr><th>File</th><th>Note</th></tr></thead>
          <tbody>${files}</tbody></table>
        </div>
        <form id="ev-form" class="card" style="padding:16px 20px;display:grid;gap:12px">
          <div class="src-grid ev-src">
            <label class="src-card" for="ev-file">
              ${svg("file", 22)}
              <strong>Upload a file</strong>
              <span>From this machine</span>
            </label>
            <input id="ev-file" type="file" name="file" hidden />
            <button class="src-card" type="button" id="load-sample">
              ${svg("folder", 22)}
              <strong>Load the sample file</strong>
              <span>Sample case: training data</span>
            </button>
          </div>
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
          <div class="dm">${w.caseDesc || "File-transfer breach"}</div></div>
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
          ${a.tx ? `· <a class="lnk" href="${explorerTx(a.tx)}" target="_blank" rel="noreferrer">view transaction</a>` : ""}</p>
          <p class="mono mut">salt ${a.salt}</p>
        </div>`
    : "";
  return shell(
    "analyze",
    crumb("Analysis"),
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
  const list = state.status?.receipts || [];
  const id = state.arg !== undefined && state.arg !== "" ? Number(state.arg) : list.at(-1)?.id;
  if (id === undefined || Number.isNaN(Number(id))) {
    return shell("receipt", "<b>Custody log</b>", null, `<p class="lede">No receipt selected.</p>`);
  }
  const loaded = id in state.receipts;
  if (!loaded) getReceipt(id).then(render);
  const full = state.receipts[id];
  const summary = list.find((x) => Number(x.id) === Number(id));
  const rec = full || summary;
  if (!rec) {
    return shell("receipt", crumb(`Receipt ${id}`), null,
      `<p class="lede">${loaded ? `Receipt ${id} was not found on chain.` : "Loading receipt…"}</p>`);
  }
  const f = rec.finding || {};
  const wait = loaded ? "—" : "Loading…";
  const hx = (b) => (b ? copyVal(hexOf(b)) : wait);
  const list2 = (arr) => (arr && arr.length ? arr.map((b) => `<div>${copyVal(hexOf(b))}</div>`).join("") : wait);
  const ts = rec.timestamp_ns ? new Date(Number(rec.timestamp_ns) / 1e6).toISOString().replace(".000", "") : "—";
  const contract = state.status?.contract || "ftcust15e434.testnet";
  const findingRows = rec.finding || !loaded ? `
        <div><dt>Model</dt><dd class="mono">${esc(f.model_id || wait)}</dd></div>
        <div><dt>TCB status</dt><dd class="mono">${esc(f.tcb_status ? kindLabel(f.tcb_status) : wait)}</dd></div>
        <div><dt>Nonce</dt><dd class="mono">${hx(f.nonce)}</dd></div>
        <div><dt>Finding hash</dt><dd class="mono">${hx(f.finding_hash)}</dd></div>
        <div><dt>Citation hashes</dt><dd class="mono">${list2(f.citation_hashes)}</dd></div>
        <div><dt>Request hash</dt><dd class="mono">${hx(f.request_hash)}</dd></div>
        <div><dt>Response hash</dt><dd class="mono">${hx(f.response_hash)}</dd></div>
        <div><dt>Gateway report hash</dt><dd class="mono">${hx(f.gateway_report_hash)}</dd></div>
        <div><dt>Model report hash</dt><dd class="mono">${hx(f.model_report_hash)}</dd></div>
        <div><dt>Signer public key (ed25519)</dt><dd class="mono">${hx(f.signer_pubkey)}</dd></div>
        <div><dt>Signature</dt><dd class="mono">${hx(f.signature)}</dd></div>` : "";
  return shell(
    "receipt",
    crumb(`Receipt ${rec.id}`),
    null,
    `<div class="hd"><div><h1>Receipt ${rec.id}</h1><p class="lede">${esc(kindLabel(rec.kind))} · ${esc(rec.case_id)} · ${esc(rec.actor)}</p></div>
      ${rec.policy_verdict ? verdictChip(rec.policy_verdict) : kindChip(rec.kind)}</div>
    <div class="card lim">
      <dl class="kv">
        <div><dt>Kind</dt><dd>${esc(kindLabel(rec.kind))}</dd></div>
        <div><dt>Verdict</dt><dd>${esc(kindLabel(rec.policy_verdict))}</dd></div>
        <div><dt>Reason</dt><dd class="mono">${esc(rec.reason ?? "—")}</dd></div>
        <div><dt>Recorded (UTC)</dt><dd class="mono">${ts}</dd></div>
        <div><dt>Evidence commitments</dt><dd class="mono">${list2(rec.evidence_commitments)}</dd></div>
        ${findingRows}
        <div><dt>Previous receipt hash</dt><dd class="mono">${hx(rec.prev_hash)}</dd></div>
        <div><dt>On chain</dt><dd><a class="lnk" href="${NEARBLOCKS}/address/${contract}" target="_blank" rel="noreferrer">${esc(contract)} on NearBlocks ${svg("arrow", 13)}</a>
          ${rec.tx
            ? `<a class="lnk" href="${explorerTx(rec.tx)}" target="_blank" rel="noreferrer">NearBlocks transaction ${svg("arrow", 13)}</a>`
            : `<span class="mut">No tx hash indexed for this receipt yet.</span>`}</dd></div>
      </dl>
    </div>
    <form id="verify-form" class="card" style="padding:16px 20px">
      <h2>Verify from chain</h2>
      <p class="lede">Recomputes the evidence fingerprint from the original file and salt. No NEAR AI Cloud call.</p>
      <input type="hidden" name="id" value="${rec.id}" />
      <label class="dl">Original file</label><input type="file" name="file" required />
      <label class="dl">Salt (hex)</label><input class="hash" name="salt" value="${state.walk.salt || state.sampleSalt || ""}" placeholder="64 hex chars" style="width:100%;height:36px;border:1px solid var(--t);border-radius:8px;padding:0 10px" />
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
  const last = findings[findings.length - 1];
  if (last && !(last.id in state.receipts)) getReceipt(last.id).then(render);
  const rec = last ? state.receipts[last.id] || last : null;
  const local = last ? state.localFindings[last.id] : null;
  const citeEmpty = last && !(last.id in state.receipts) ? "<p class='mut'>Loading…</p>" : "<p class='mut'>None</p>";
  const quotes = (local?.citations || []).map((c) => {
    const q = c.quote || "";
    const inSample = (state.sampleText || "").includes(q);
    return `<p><mark class="cite ${inSample ? "ok" : "bad"}">${esc(q)}</mark></p>`;
  }).join("");
  const citePass = local?.citations?.length && (local.citations || []).every((c) => (state.sampleText || "").includes(c.quote || ""));
  return shell(
    "finding",
    crumb("Findings"),
    null,
    rec
      ? `<div class="split">
        <div class="card det">
          <div class="dh"><div class="eyebrow">Finding</div><h2>On-chain Finding ${rec.id}</h2>
            <div class="dm">${verdictChip(rec.policy_verdict)} <span class="mono mut">${rec.finding?.model_id || ""}</span></div></div>
          ${local?.claim ? `<div class="dsec"><div class="dl">Claim</div><p class="lede">${esc(local.claim)}</p></div>` : ""}
          <div class="dsec"><div class="dl">Citation hashes</div>
            ${(rec.finding?.citation_hashes || [])
              .map((h) => `<div class="hash" style="background:var(--h);border:1px solid var(--l);border-radius:6px;padding:6px 8px">${hexOf(h) || shortHash(h)}</div>`)
              .join("") || citeEmpty}
          </div>
          <div class="dsec"><a class="lnk" href="#/receipt/${rec.id}">Open receipt ${svg("arrow", 13)}</a></div>
        </div>
        <aside class="card det">
          <div class="dh"><div class="eyebrow">Evidence viewer</div><h2>Byte-for-byte citations</h2>
            ${citePass ? `<p class="recd">Citation check passed</p>` : `<p class="mut">Load the sample file to check quotes.</p>`}</div>
          <div class="dsec">${quotes || `<p class="lede">Open the original file in Verify from chain. A matching quote is marked: Citation check passed, byte-for-byte match.</p>`}</div>
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
    crumb("Custody check"),
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
      <input name="evidence_commitment" class="mono" value="${state.custodyMsg?.commitment || w.commitment || ""}" placeholder="64-byte hex" style="height:36px;border:1px solid var(--t);border-radius:8px;padding:0 10px" />
      <button class="btn primary" type="submit">${svg("link", 17)}Record custody check</button>
    </form>
    <p class="lede">The recorded verdict is the fingerprint comparison against the on-chain receipt.</p>`
  );
}

function securityResult(atk) {
  if (!atk) return "";
  if (atk.error === "unauthorized" || atk.status === 401 || atk.code === "unauthorized") {
    return `<div class="res" style="border-color:var(--l);background:var(--h)">
      <div class="rh">Demo mode is off: this action needs an operator token</div>
      <p class="rline">Nothing was sent to NEAR. Set DEMO_MODE=1 on the host, or paste an operator token for a private run.</p>
    </div>`;
  }
  if (atk.error && !atk.rejected && !atk.tx_hash) {
    return `<div class="res" style="border-color:var(--g);background:var(--d)">
      <div class="rh">Attempt failed before send</div>
      <p class="rline">${esc(atk.error || atk.message || "unknown error")}</p>
    </div>`;
  }
  const rejected = !!atk.rejected;
  return `<div class="res">
    <div class="rtop"><div class="rsh">${svg("shieldok", 34, 1.8)}</div>
      <div><div class="rey">${esc(atk.label || "")}</div>
      <div class="rh">${rejected ? "Rejected by NEAR before it ran" : "Unexpected: transaction accepted"}</div></div></div>
    <p class="rline">${rejected
      ? "Rejected before execution, nothing was recorded, no funds moved."
      : "A transaction hash was returned — inspect it on NearBlocks."}</p>
    ${atk.expect || atk.error ? `<div class="rerr"><span class="rl">${rejected ? "NEAR protocol error" : "Detail"}</span>
      <span class="code">${esc(atk.expect || atk.error)}</span></div>` : ""}
    <div class="facts">
      <div><span>Funds moved</span><b>0 NEAR</b></div>
      <div><span>Recorded</span><b>Nothing</b></div>
      <div><span>Explorer</span><b>${atk.tx_hash ? `<a class="lnk" href="${explorerTx(atk.tx_hash)}" target="_blank" rel="noreferrer">tx</a>` : "None"}</b></div>
      <div><span>Hash</span><b>${esc(atk.tx_hash || "none")}</b></div>
    </div>
  </div>`;
}

function viewSecurity() {
  const atk = state.attack;
  const result = securityResult(atk);
  return shell(
    "security",
    crumb("Security"),
    null,
    `<div class="hd"><div><div class="eyebrow">Security</div><h1>Can a stolen key move funds?</h1>
      <p class="lede">The app writer key is a function-call key. Try the four protocol rejections on testnet.</p></div></div>
    <div class="g">
      <section class="card lim">
        <div class="lh"><span class="lic">${svg("key", 18)}</span><div><h2>Writer key</h2><div class="sub">Not your wallet key.</div></div></div>
        <dl class="kv">
          <div><dt>Account</dt><dd class="mono" title="${esc(state.status?.writer || "ftwriter15e434.testnet")}">${esc(shortAccount(state.status?.writer || "ftwriter15e434.testnet"))}</dd></div>
          <div><dt>Works only on</dt><dd class="mono" title="${esc(state.status?.contract || "")}">${esc(shortAccount(state.status?.contract || ""))}</dd></div>
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
  const pending = pendingHolds(state.status);
  const cards = pending
    .map((r) => {
      const full = state.receipts[r.id] || r;
      const hashes = (full.finding?.citation_hashes || []).map((h) => `<div class="hash">${hexOf(h)}</div>`).join("");
      const why = r.reason || "Policy P4: irreversible actions wait for a human.";
      return `<article class="card det" style="padding:0">
        <div class="dh"><div class="eyebrow">HOLD</div><h2>HOLD · receipt ${r.id}</h2>
          <div class="dm">${verdictChip(r.policy_verdict)} receipt ${r.id} · ${r.case_id}</div></div>
        <div class="dsec"><div class="dl">Why it was held</div><p class="lede">${esc(why)}</p></div>
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
    crumb("Approvals"),
    null,
    `<div class="hd"><div><h1>Approvals</h1><p class="lede">HOLD receipts from the contract. Reject is the default. The app never performs the action itself.</p></div></div>
    ${cards || `<div class="card" style="padding:24px;text-align:center"><p class="lede empty">No actions waiting for approval</p></div>`}`
  );
}

function viewAccess() {
  const w = state.walk;
  const denied = (state.status?.receipts || [])
    .filter((r) => kindLabel(r.kind) === "OpenDenied")
    .map((r) => `<tr><td class="mono">${esc(r.actor)}</td><td>OpenDenied · <span class="mono">${esc(r.reason || "")}</span></td>
      <td><a class="lnk" href="#/receipt/${r.id}">Receipt ${r.id} ${svg("arrow", 13)}</a></td></tr>`)
    .join("");
  return shell(
    "access",
    crumb("Access"),
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
      <table><thead><tr><th>Account</th><th>Kind</th><th>Receipt</th></tr></thead>
      <tbody>${denied || `<tr><td colspan="3" class="empty">No denied attempts on chain.</td></tr>`}</tbody></table>
    </div>`
  );
}

function viewReports() {
  if (!state.exportData && !state.exportLoading) {
    state.exportLoading = true;
    fetch("/api/export")
      .then((r) => r.json())
      .then((d) => { state.exportData = d; })
      .catch((e) => { state.exportMsg = `Could not load the export: ${e.message}`; })
      .finally(() => { state.exportLoading = false; render(); });
  }
  const x = state.exportData;
  const s = x?.summary || {};
  const v = x?.verification || {};
  const n = (k) => (x ? s[k] ?? "—" : "…");
  const rows = (x?.timeline || [])
    .map((r) => `<tr><td class="mono ts">${r.id}</td><td>${esc(r.kind)}</td><td>${r.verdict ? verdictChip(r.verdict) : kindChip(r.kind)}</td>
      <td class="mono acc">${esc(r.actor)}</td><td><a class="lnk" href="#/receipt/${r.id}">Open ${svg("arrow", 13)}</a></td></tr>`)
    .join("");
  return shell(
    "reports",
    crumb("Case report"),
    null,
    `<div class="hd"><div><h1>Case report</h1><p class="lede">Triage tool, not court-certified. The PDF is built from the same export as the JSON.</p></div>
      <div style="display:flex;gap:8px">
        <button class="btn primary" id="export-json">${svg("report", 16)}Export JSON</button>
        <button class="btn" id="export-pdf">${svg("report", 16)}Export PDF</button>
      </div></div>
    ${state.exportMsg ? `<p class="wiz-err">${esc(state.exportMsg)}</p>` : ""}
    <div class="kpis">
      <div class="kpi neutral"><div class="kh">Receipts on chain</div><div class="kv">${n("receipt_count")}</div></div>
      <div class="kpi flag"><div class="kh">Findings</div><div class="kv">${n("finding_count")}</div></div>
      <div class="kpi hold"><div class="kh">HOLD (waiting / total)</div><div class="kv">${n("pending_hold_count")} / ${n("hold_count")}</div></div>
      <div class="kpi block"><div class="kh">Decisions</div><div class="kv">${x ? (s.approval_count ?? 0) + (s.rejection_count ?? 0) : "…"}</div><div class="ks">${x ? `${s.approval_count ?? 0} approved · ${s.rejection_count ?? 0} rejected` : ""}</div></div>
    </div>
    <div class="card lim"><dl class="kv">
      <div><dt>Contract</dt><dd class="mono">${esc(s.contract || "—")}</dd></div>
      <div><dt>Export generated (UTC)</dt><dd class="mono">${esc(x?.generated_at || "…")}</dd></div>
      <div><dt>R1 citations</dt><dd>${esc(v.r1 || "…")}</dd></div>
      <div><dt>R2 writer key</dt><dd>${esc(v.r2 || "…")}</dd></div>
      <div><dt>R3 signature</dt><dd>${esc(v.r3 || "…")}</dd></div>
      <div><dt>TCB policy</dt><dd>${esc(v.tcb || "…")}</dd></div>
    </dl></div>
    <div class="card tbl"><div class="tbar"><h2>Timeline</h2><span class="cnt">${x?.timeline?.length ?? "…"}</span></div>
      <table><thead><tr><th>Id</th><th>Kind</th><th>Verdict</th><th>Actor</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="empty">${x ? "No receipts" : "Loading…"}</td></tr>`}</tbody></table></div>`
  );
}

function wizardPane() {
  const s = state.setup;
  const wlt = state.wallet;
  if (s.step === "connect") {
    return `<div class="wiz-connect">
      <h1>Connect</h1>
      <p class="lede">Sign in with a NEAR testnet wallet. The server writer key still signs receipts.</p>
      ${wlt.error ? `<p class="wiz-err">${esc(wlt.error)}. Press Connect wallet to try again.</p>` : ""}
      <button class="btn primary" type="button" id="connect-btn">${svg("link", 16)}Connect wallet</button>
      <button class="btn ghost" type="button" id="wiz-nowallet">Continue without wallet</button>
    </div>`;
  }
  if (s.step === "connected") {
    const id = wlt.accountId || "";
    return `<h1>Connected</h1>
      <p class="lede">Wallet connected: <span class="mono">${esc(shortAccount(id))}</span></p>
      <p class="mut">${copyVal(id)}</p>`;
  }
  if (s.step === "source") {
    return `<h1>Choose a source</h1>
      <p class="lede">Upload evidence or load the sample case.</p>
      <input type="file" name="file" id="wiz-file" hidden />
      <div class="src-grid">
        <button type="button" class="src-card${s.source === "upload" ? " on" : ""}" id="wiz-upload">
          ${svg("file", 22)}
          <strong>Upload evidence</strong>
          <span>From this machine</span>
        </button>
        <button type="button" class="src-card${s.source === "sample" ? " on" : ""}" id="wiz-sample">
          ${svg("folder", 22)}
          <strong>Load the sample case</strong>
          <span>Sample case: training data</span>
        </button>
      </div>
      ${
        s.commitment
          ? `<div class="dsec" style="padding:12px 0"><div class="dl">Salted commitment</div>
             <p>${copyVal(s.commitment)}</p>
             <p class="lede">${esc(s.evidenceName)}</p></div>`
          : `<p class="lede empty">No local evidence file yet — load the sample file; sample findings are already on chain.</p>`
      }`;
  }
  const acct = wlt.connected && wlt.accountId ? shortAccount(wlt.accountId) : "No wallet";
  return `<h1>Confirm and go</h1>
    <p class="lede">Open the case workspace with evidence loaded. Analyze is highlighted next.</p>
    <dl class="kv">
      <div><dt>Account</dt><dd>${esc(acct)}</dd></div>
      <div><dt>Source</dt><dd>${esc(s.evidenceName || "—")}${s.source === "sample" ? sampleLabel("larkmoor") : ""}</dd></div>
      <div><dt>Case</dt><dd>${esc(s.caseName || "Larkmoor Records Office")}</dd></div>
    </dl>`;
}

function viewSetup() {
  const s = state.setup;
  const idx = Math.max(0, setupIndex(s.step));
  const valid = setupValid(s, state.wallet);
  const last = s.step === "confirm";
  const primary =
    s.step === "connect"
      ? ""
      : s.step === "connected"
        ? `<button class="btn primary" type="button" id="wiz-next">Continue</button>`
        : `<button class="btn primary" type="button" id="wiz-next" ${valid ? "" : "disabled"}>${
            last ? "Start" : "Continue"
          }</button>`;
  const steps = SETUP_STEPS.map((st, i) => {
    const cls = i === idx ? "on" : i < idx ? "done" : "";
    return `<li class="${cls}"><span>${st.n}</span>${st.label}</li>`;
  }).join("");

  const isConnect = s.step === "connect";
  return `<div class="wiz-page">
    <div class="hex-field" aria-hidden="true">
      <svg class="hex-cluster hex-tr" viewBox="0 0 280 220" width="280" height="220">
        <g fill="none" stroke="#FFFFFF" stroke-width="1.25" opacity="0.85">
          <path d="M40 30l28-16 28 16v32l-28 16-28-16z"/>
          <path d="M96 30l28-16 28 16v32l-28 16-28-16z"/>
          <path d="M152 30l28-16 28 16v32l-28 16-28-16z"/>
          <path d="M68 78l28-16 28 16v32l-28 16-28-16z"/>
          <path d="M124 78l28-16 28 16v32l-28 16-28-16z"/>
          <path d="M180 78l28-16 28 16v32l-28 16-28-16z"/>
          <path d="M96 126l28-16 28 16v32l-28 16-28-16z"/>
          <path d="M152 126l28-16 28 16v32l-28 16-28-16z"/>
        </g>
        <g fill="#FFFFFF" opacity="0.35">
          <path d="M208 40l20-12 20 12v24l-20 12-20-12z"/>
          <path d="M40 150l16-9 16 9v18l-16 9-16-9z"/>
        </g>
      </svg>
      <svg class="hex-cluster hex-bl" viewBox="0 0 240 200" width="240" height="200">
        <g fill="none" stroke="#FFFFFF" stroke-width="1.25" opacity="0.8">
          <path d="M30 110l28-16 28 16v32l-28 16-28-16z"/>
          <path d="M86 110l28-16 28 16v32l-28 16-28-16z"/>
          <path d="M58 158l28-16 28 16v32l-28 16-28-16z"/>
          <path d="M142 90l28-16 28 16v32l-28 16-28-16z"/>
          <path d="M114 138l28-16 28 16v32l-28 16-28-16z"/>
        </g>
        <g fill="#FFFFFF" opacity="0.28">
          <path d="M170 130l18-10 18 10v20l-18 10-18-10z"/>
        </g>
      </svg>
    </div>
    <header class="wiz-logo">
      <span class="wiz-mark">${svg("shield", 28)}</span>
      <div class="wiz-brand">
        <span class="wiz-title">Custos Seal</span>
        <span class="wiz-sub">Private Forensic Triage Assistant</span>
      </div>
    </header>
    ${
      isConnect
        ? `<div class="wiz-hero">
        <p class="wiz-kicker mono">NEAR · testnet · confidential TEE</p>
        <h1>Seal the chain of custody before the first byte moves</h1>
        <p class="lede">Connect an investigator wallet to start a case.</p>
      </div>`
        : ""
    }
    <div class="wiz-card card${isConnect ? " wiz-card--connect" : ""}">
      <ol class="wiz-steps-h" aria-label="Setup">${steps}</ol>
      <div class="wiz-body">
        ${wizardPane()}
        <div class="wiz-nav${isConnect ? " wiz-nav--solo" : ""}">
          <button class="btn" type="button" id="wiz-back"${idx === 0 ? " disabled" : ""}>Back</button>
          <button class="btn ghost" type="button" id="wiz-skip">Skip setup</button>
          <div class="sp"></div>
          ${primary}
        </div>
      </div>
    </div>
    <p class="wiz-foot mut">Evidence is fingerprinted, not stored in the custody log. Sample items stay marked as training data.</p>
  </div>`;
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
  const el = document.getElementById("app");
  try {
    const fn = views[state.view] || viewCases;
    el.classList.toggle("land-mode", state.view === "land" || state.view === "setup");
    el.innerHTML = fn();
    bind();
  } catch (e) {
    state.fatal = String(e.message || e);
    el.innerHTML = `<div class="land"><div class="land-card"><h1>Something went wrong</h1><p class="lede">${esc(
      state.fatal
    )}</p><button class="btn" type="button" onclick="location.reload()">Reload</button></div></div>`;
    console.error(e);
  }
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

async function connectWalletFlow() {
  state.wallet.error = "";
  persistWallet();
  try {
    await openWalletPicker();
    const sync = async () => {
      const w = await syncFromSelector();
      state.wallet = { ...state.wallet, ...w };
      persistWallet();
      if (state.wallet.connected && state.wallet.accountId && setupOpen() && state.setup.step === "connect") {
        state.setup.step = "connected";
        persistSetup();
      }
      render();
    };
    const { selector } = await ensureSelector();
    const unsub = selector.store.observable.subscribe(() => {
      sync();
    });
    setTimeout(() => {
      try {
        unsub();
      } catch {}
    }, 120000);
    await sync();
  } catch (e) {
    const msg = String(e.message || e);
    state.wallet.error = /cancel/i.test(msg) ? "Wallet connection cancelled" : "Wallet connection failed";
    persistWallet();
    render();
  }
}

function bindSetup() {
  const skip = document.getElementById("wiz-skip");
  if (skip) {
    skip.onclick = (e) => {
      e.preventDefault();
      state.setup.skipped = true;
      persistSetup();
      state.walk.skipped = true;
      persistWalk();
      location.hash = "#/cases";
      state.view = "cases";
      render();
    };
  }
  const nw = document.getElementById("wiz-nowallet");
  if (nw) {
    nw.onclick = () => {
      state.setup.noWallet = true;
      state.setup.step = "source";
      persistSetup();
      render();
    };
  }
  const back = document.getElementById("wiz-back");
  if (back) {
    back.onclick = () => {
      const prev = setupPrev(state.setup.step);
      if (state.setup.noWallet && state.setup.step === "source") state.setup.step = "connect";
      else state.setup.step = prev;
      persistSetup();
      render();
    };
  }
  const nxt = document.getElementById("wiz-next");
  if (nxt) {
    nxt.onclick = () => {
      const s = state.setup;
      if (s.step === "confirm") {
        s.completed = true;
        s.highlightAnalyze = true;
        persistSetup();
        state.walk.caseName = s.caseName;
        state.walk.caseDesc = s.caseDesc;
        state.walk.evidenceName = s.evidenceName;
        state.walk.commitment = s.commitment;
        state.walk.salt = s.salt;
        state.walk.skipped = true;
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
  if (conn) conn.onclick = () => connectWalletFlow();
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
      state.sampleText = sample.text || "";
      if (sample.salt) state.sampleSalt = sample.salt;
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
        caseDesc: "File-transfer breach",
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
  const tm = document.getElementById("top-menu");
  if (tm) {
    tm.onclick = () => {
      state.menuOpen = !state.menuOpen;
      render();
    };
  }
  const rw = document.getElementById("restart-setup");
  if (rw) {
    rw.onclick = () => {
      state.setup = defaultSetup();
      persistSetup();
      location.hash = "#/setup";
      state.view = "setup";
      render();
    };
  }
  const wo = document.getElementById("wallet-out");
  if (wo) {
    wo.onclick = async () => {
      try {
        state.wallet = await signOutWallet();
      } catch {
        state.wallet = defaultWallet();
        persistWallet();
      }
      render();
    };
  }
  const ws = document.getElementById("wallet-switch");
  if (ws) ws.onclick = () => connectWalletFlow();
  const tc = document.getElementById("top-connect") || document.getElementById("top-connect-m");
  if (tc) tc.onclick = () => connectWalletFlow();
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
  const salt = source === "sample" ? state.sampleSalt || undefined : undefined;
  const data = await (
    await fetch("/api/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_b64: b64, salt }),
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
  document.querySelectorAll("[data-copy]").forEach((b) => {
    b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(decodeURIComponent(b.dataset.copy || ""));
        b.textContent = "Copied";
      } catch {}
    };
  });
  const gs = document.getElementById("gsearch");
  if (gs) {
    gs.oninput = () => {
      state.searchQ = gs.value;
      state.searchOpen = true;
      const wrap = document.getElementById("search-drop");
      /* live update via render would steal focus; patch drop */
      state.searchOpen = true;
      render();
      const again = document.getElementById("gsearch");
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    };
    gs.onfocus = () => {
      state.searchOpen = true;
    };
    gs.onkeydown = (e) => {
      if (e.key === "Escape") {
        state.searchOpen = false;
        render();
      }
      if (e.key === "Enter") {
        const hit = searchHits()[0];
        if (hit) location.hash = hit.href;
      }
    };
  }
  const sf = document.getElementById("side-filter");
  if (sf) {
    sf.oninput = () => {
      state.filterQ = sf.value;
      render();
      const a = document.getElementById("side-filter");
      if (a) {
        a.focus();
        a.setSelectionRange(a.value.length, a.value.length);
      }
    };
    sf.onkeydown = (e) => {
      if (e.key === "Escape") { state.filterQ = ""; render(); }
    };
  }
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
      state.sampleText = s.text || "";
      if (s.salt) state.sampleSalt = s.salt;
      const blob = new Blob([s.text], { type: "text/plain" });
      const file = new File([blob], s.name, { type: "text/plain" });
      await commitFile(file, "sample");
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
          headers: writeHeaders({ "Content-Type": "application/octet-stream", "X-Case-Id": "larkmoor-demo" }),
          body: await file.arrayBuffer(),
        });
        const data = await res.json();
        clearInterval(iv);
        if (!res.ok) {
          state.analyze = { done: true, error: writeFailMsg(data, res.status), skip_chain: data.skip_chain };
          state.walk.analyzeError = writeFailMsg(data, res.status);
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
      const expectedId = Number(document.querySelector('[name="expected_receipt_id"]')?.value);
      const onchain = await getReceipt(expectedId);
      const salt = state.walk.salt || state.sampleSalt;
      const data = await (
        await fetch("/api/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_b64: b64, salt }),
        })
      ).json();
      const expected = hexOf(onchain?.evidence_commitments?.[0]);
      const ok = String(data.commitment || "").toLowerCase() === String(expected || "").toLowerCase();
      state.custodyMsg = {
        ok,
        text: ok ? "Match — custody intact" : "CUSTODY BREAK — fingerprint does not match on-chain receipt",
        commitment: data.commitment,
        expected,
        file_b64: b64,
        salt,
      };
      render();
    };
  }
  const gf = document.getElementById("grant-form");
  if (gf) {
    gf.onsubmit = async (e) => {
      e.preventDefault();
      const account = gf.account.value.trim();
      const case_id = state.walk.caseId || "larkmoor-demo";
      try {
        if (state.wallet.connected) {
          const sent = await signFunctionCall({
            receiverId: state.status?.contract || "ftcust15e434.testnet",
            methodName: "grant",
            args: { case_id, account },
          });
          state.walk.grantAccount = account;
          state.grantMsg = `Granted · ${sent?.transaction?.hash || "wallet"}`;
        } else {
          const res = await fetch("/custody/grant", {
            method: "POST",
            headers: writeHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ case_id, account }),
          });
          const data = await res.json();
          state.walk.grantAccount = account;
          state.grantMsg = res.ok && data.tx ? `Granted · ${data.tx}` : writeFailMsg(data, res.status);
        }
      } catch (err) {
        state.grantMsg = String(err.message);
      }
      persistWalk();
      render();
    };
  }
  const of = document.getElementById("open-form");
  if (of) {
    of.onsubmit = async (e) => {
      e.preventDefault();
      const args = {
        case_id: state.walk.caseId || "larkmoor-demo",
        evidence_id: "E1",
        reason: of.account_note.value || "walkthrough open",
      };
      try {
        if (state.wallet.connected) {
          await signFunctionCall({
            receiverId: state.status?.contract || "ftcust15e434.testnet",
            methodName: "request_open",
            args,
            deposit: "10000000000000000000000",
          });
        } else {
          const res = await fetch("/custody/open", {
            method: "POST",
            headers: writeHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(args),
          });
          const data = await res.json();
          if (!res.ok) state.grantMsg = writeFailMsg(data, res.status);
        }
      } catch (err) {
        state.grantMsg = String(err.message);
      }
      await loadStatus();
    };
  }
  document.querySelectorAll(".hold-form").forEach((hf) => {
    hf.onsubmit = async (e) => {
      e.preventDefault();
      const reason = hf.reason.value.trim();
      if (!reason) return;
      const decision = e.submitter?.value || "reject";
      try {
        if (state.wallet.connected) {
          await signFunctionCall({
            receiverId: state.status?.contract || "ftcust15e434.testnet",
            methodName: "approve_action",
            args: {
              case_id: "larkmoor-demo",
              receipt_id: Number(hf.dataset.id),
              decision: decision === "approve",
              reason,
            },
          });
          state.grantMsg = `${decision} receipt ${hf.dataset.id} · wallet`;
        } else {
          const res = await fetch("/custody/hold", {
            method: "POST",
            headers: writeHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              case_id: "larkmoor-demo",
              receipt_id: Number(hf.dataset.id),
              decision,
              reason,
            }),
          });
          const data = await res.json();
          state.grantMsg = res.ok
            ? `${data.kind} receipt ${data.receipt_id} · ${data.tx}`
            : writeFailMsg(data, res.status);
        }
      } catch (err) {
        state.grantMsg = String(err.message);
      }
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
        evidence_commitment: fd.get("evidence_commitment") || state.custodyMsg?.commitment,
        matched: Boolean(state.custodyMsg?.ok),
        salt: state.custodyMsg?.salt || state.walk.salt || state.sampleSalt,
        file_b64: state.custodyMsg?.file_b64,
      };
      const res = await fetch("/custody/check", {
        method: "POST",
        headers: writeHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      alert(res.ok && data.tx ? `Recorded ${data.tx}` : writeFailMsg(data, res.status));
      await loadStatus();
    };
  }
  document.querySelectorAll("[data-atk]").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      const res = await fetch("/api/security", {
        method: "POST",
        headers: writeHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ kind: b.dataset.atk }),
      });
      const data = await res.json().catch(() => ({}));
      state.attack = { ...data, status: res.status, error: data.error || data.detail };
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
      a.download = "custos-seal-larkmoor-demo-export.json";
      a.click();
    };
  }
  const pdf = document.getElementById("export-pdf");
  if (pdf) {
    pdf.onclick = async () => {
      pdf.disabled = true;
      pdf.textContent = "Building PDF…";
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 30000);
      try {
        const res = await fetch("/api/export.pdf", { signal: ctl.signal });
        const type = res.headers.get("content-type") || "";
        if (!res.ok || !type.includes("application/pdf")) {
          let msg = `HTTP ${res.status}`;
          try { const j = await res.json(); msg = j.detail || j.error || msg; } catch {}
          throw new Error(msg);
        }
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "custos-seal-larkmoor-demo-report.pdf";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        state.exportMsg = null;
      } catch (e) {
        state.exportMsg = e.name === "AbortError"
          ? "PDF export timed out after 30 s. Export JSON has the same data."
          : `PDF export failed: ${e.message}`;
      } finally {
        clearTimeout(t);
        render();
      }
    };
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("keydown", (e) => {
  if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(e.target.tagName)) {
    e.preventDefault();
    const gs = document.getElementById("gsearch");
    if (gs) {
      gs.focus();
      state.searchOpen = true;
    }
  }
});
route();
syncFromSelector()
  .then((w) => {
    state.wallet = { ...state.wallet, ...w };
    persistWallet();
    if (setupOpen() && state.wallet.connected && state.setup.step === "connect") {
      state.setup.step = "connected";
      persistSetup();
      render();
    }
  })
  .catch(() => {});
loadStatus();
fetch("/api/sample")
  .then((r) => r.json())
  .then((s) => {
    state.sampleText = s.text || "";
    if (s.salt) state.sampleSalt = s.salt;
  })
  .catch(() => {});
fetch("/api/sample/findings")
  .then((r) => r.json())
  .then((d) => {
    const map = {};
    for (const f of d.findings || []) map[Number(f.receipt_id)] = f;
    state.localFindings = map;
  })
  .catch(() => {});
