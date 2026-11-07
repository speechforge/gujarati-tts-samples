"use strict";
// ---------- definitions
const METRICS = {
  pitch_corr:  { label: "Pitch r",     arrow: "↑",  better: "high", fmt: 2, long: "Pitch-contour correlation with the real recording (DTW-aligned, semitones, voiced frames)." },
  energy_corr: { label: "Energy r",    arrow: "↑",  better: "high", fmt: 2, long: "Loudness-contour correlation with the real recording (DTW-aligned, dB)." },
  mfcc_dist:   { label: "MFCC dist",   arrow: "↓",  better: "low",  fmt: 1, long: "MFCC distance to the real recording after alignment (MCD-style; only the ranking is meaningful)." },
  dur_ratio:   { label: "Length ×",    arrow: "→1", better: "one",  fmt: 2, long: "Clip length divided by the real recording's length." },
  spk_cos:     { label: "Voice cos",   arrow: "↑",  better: "high", fmt: 2, long: "ECAPA speaker-embedding cosine between the clip and the real recording." },
  cer:         { label: "CER",         arrow: "↓",  better: "low",  fmt: 3, long: "Character error rate of a Gujarati speech recognizer (whisper-gujarati-medium) on the clip, against the sentence text." },
  sim_gt:      { label: "Sim. to GT",  arrow: "↑",  better: "high", fmt: 0, pct: true, rank: true, long: "Similarity to the ground-truth recording, in %: the plain average of pitch similarity, loudness similarity, voice similarity and length match (definitions under Method & notes)." },
  sim_f5:      { label: "Sim. to F5",  arrow: "",   better: null,   fmt: 0, pct: true, rank: false, long: "Similarity to the untouched IndicF5 (F5-TTS) clip of the same sentence, in %, same recipe. Not ranked: closer to F5 is neither better nor worse, it shows how much the system changed the output." },
};
const BETTER_TEXT = { high: "Higher is better.", low: "Lower is better.", one: "Closest to 1.00 is best.", null: "Not ranked." };
const ROLE = { gt: ["Ground truth", "gt"], indicf5: ["Baseline 1", "base"], lora: ["Baseline 2", "base"], adapter: ["Baseline 3", "base"], dsp: ["Baseline 4", "base"], reliability: ["Proposed", "prop"], mms: ["External TTS", "ext"], parler: ["External TTS", "ext"] };
const NAME = { gt: "Real recording", indicf5: "IndicF5 / F5-TTS, untouched (B0)", lora: "IndicF5 + LoRA (B1)", adapter: "+ control adapter, uniform weights (B3)", dsp: "Deterministic DSP edit of B1's clip (B2)", reliability: "+ reliability-aware training (P)", mms: "MMS-TTS-guj (Meta)", parler: "Indic Parler-TTS" };
const BARLBL = { gt: "Ground truth", indicf5: "Base 1 · IndicF5", lora: "Base 2 · +LoRA", adapter: "Base 3 · +adapter", dsp: "Base 4 · DSP edit", reliability: "Proposed · +reliab.", mms: "External · MMS-TTS", parler: "External · Parler" };
const SHORT = { gt: "GT", indicf5: "Base 1", lora: "Base 2", adapter: "Base 3", dsp: "Base 4", reliability: "Proposed", mms: "MMS", parler: "Parler" };
const CONDS = ["neutral", "pitch-1.5", "pitch+1.5", "energy-2.5", "energy+2.5", "rate0.88", "rate1.12"];
const COND_LABEL = { "neutral": "Neutral", "pitch-1.5": "Pitch −1.5 st", "pitch+1.5": "Pitch +1.5 st", "energy-2.5": "Energy −2.5 dB", "energy+2.5": "Energy +2.5 dB", "rate0.88": "Rate ×0.88", "rate1.12": "Rate ×1.12" };
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];   // sequential blue
const CARD_COLS = ["pitch_corr", "energy_corr", "mfcc_dist", "dur_ratio", "spk_cos", "cer", "sim_gt", "sim_f5"];
let DATA = null;

// ---------- helpers
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
const fmt = (v, d) => (v == null || !isFinite(v)) ? "–" : Number(v).toFixed(d);
const mean = a => { const x = a.filter(v => v != null && isFinite(v)); return x.length ? x.reduce((s, v) => s + v, 0) / x.length : null; };
const dark = () => document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
const head = m => METRICS[m].label + (METRICS[m].arrow ? " " + METRICS[m].arrow : "");
const mtip = m => `${METRICS[m].long} ${BETTER_TEXT[METRICS[m].better]}`;
const tagEl = k => h("span", { class: "tag " + ROLE[k][1], text: ROLE[k][0] });
const TNAME = { gt: "Real recording", indicf5: "IndicF5 (B0)", lora: "+ LoRA (B1)", adapter: "+ adapter (B3)", dsp: "DSP edit (B2)", reliability: "+ reliability (P)", mms: "MMS-TTS-guj", parler: "Parler-TTS" };
const sysCell = (k, long) => h("td", { class: "sys" + (k === "reliability" ? " propcell" : "") }, tagEl(k), long ? (NAME[k] || k) : (TNAME[k] || k));

function rampColor(t) {
  t = Math.max(0, Math.min(1, t)); if (dark()) t = 1 - t;
  const x = t * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  const a = RAMP[i].match(/\w\w/g).map(s => parseInt(s, 16)), b = RAMP[i + 1].match(/\w\w/g).map(s => parseInt(s, 16));
  return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}
function shade(el, t) {
  const c = rampColor(t); el.style.background = `rgb(${c.join(",")})`;
  el.style.color = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) < 140 ? "#fff" : "#0b0b0b";
}

// ---------- tooltip (enhances; every value is also in a table)
const tip = h("div", { id: "tip", role: "tooltip" });
document.addEventListener("DOMContentLoaded", () => document.body.append(tip));
function tipOn(el, text) {
  el.dataset.tip = text; el.tabIndex = 0;
  const show = ev => { tip.textContent = text; tip.style.display = "block"; const r = el.getBoundingClientRect(); tip.style.left = Math.max(4, Math.min(innerWidth - 300, ev.clientX ? ev.clientX + 12 : r.left)) + "px"; tip.style.top = (ev.clientY ? ev.clientY + 14 : r.bottom + 6) + "px"; };
  el.addEventListener("pointermove", show); el.addEventListener("focus", show);
  el.addEventListener("pointerleave", () => tip.style.display = "none"); el.addEventListener("blur", () => tip.style.display = "none");
}

// ---------- audio: one clip at a time
const shared = new Audio(); shared.preload = "none";
let sharedBtn = null;
function pauseAll(except) { document.querySelectorAll("audio").forEach(a => { if (a !== except) a.pause(); }); shared.pause(); if (sharedBtn) { sharedBtn.classList.remove("playing"); sharedBtn.textContent = "▶"; sharedBtn = null; } }
function player(file) { const a = h("audio", { controls: "", preload: "none", src: file }); a.addEventListener("play", () => pauseAll(a)); return a; }
function playBtn(file, label) {
  const b = h("button", { class: "playbtn", "aria-label": "Play " + label }, "▶");
  b.addEventListener("click", () => {
    if (sharedBtn === b) { pauseAll(); return; }
    pauseAll(); shared.src = file; shared.play(); sharedBtn = b; b.classList.add("playing"); b.textContent = "■";
    shared.onended = () => pauseAll();
  });
  return b;
}

// ---------- similarity percentages
const pct = v => v == null ? null : Math.max(0, v) * 100;
const lenPct = r => r == null ? null : 100 * Math.max(0, 1 - Math.abs(r - 1));
const simOf = x => x ? mean([pct(x.pitch_corr), pct(x.energy_corr), pct(x.spk_cos), lenPct(x.dur_ratio)]) : null;
function value(row, k, m) {
  if (m === "sim_gt") return k === "gt" ? null : simOf(row.systems[k]?.neutral);
  if (m === "sim_f5") return (k === "indicf5" || k === "gt") ? null : simOf(row.pair[`indicf5|${k}`]);
  return row.systems[k]?.neutral?.[m];
}
function ranksFor(vals, m) {           // vals: {key: number|null}; synthesized systems only -> {key: "1st"|"2nd"}; systems tied at the displayed precision share a mark
  const M = METRICS[m]; if (!M.better || M.rank === false) return {};
  const d = M.pct ? 0 : M.fmt, q = v => Number(v.toFixed(d));
  const score = v => M.better === "low" ? q(v) : M.better === "one" ? Number(Math.abs(q(v) - 1).toFixed(d)) : -q(v);
  const e = Object.entries(vals).filter(([k, v]) => k !== "gt" && v != null && isFinite(v)).map(([k, v]) => [k, score(v)]);
  const levels = [...new Set(e.map(x => x[1]))].sort((a, b) => a - b);
  const out = {}; e.forEach(([k, sc]) => { if (sc === levels[0]) out[k] = "1st"; else if (sc === levels[1]) out[k] = "2nd"; });
  return out;
}
function badge(r) { return r ? h("span", { class: "rk " + (r === "1st" ? "r1" : "r2"), text: r, title: r === "1st" ? "Best of the synthesized systems for this measure" : "Second best of the synthesized systems for this measure" }) : null; }
function cellText(m, v) { return v == null ? "–" : METRICS[m].pct ? Math.round(v) + "%" : fmt(v, METRICS[m].fmt); }
const sysKeys = () => Object.keys(DATA.systems);
const itemsOf = groups => groups.flatMap(g => DATA.groups[g]);

// ---------- overview
function summaryTable(groups) {
  const items = itemsOf(groups), keys = sysKeys(), cols = CARD_COLS;
  const mv = {}; cols.forEach(m => { mv[m] = {}; keys.forEach(k => mv[m][k] = mean(items.map(r => value(r, k, m)))); });
  const t = h("table", {}, h("thead", {}, h("tr", {}, h("th", { text: "System" }), cols.map(m => { const th = h("th", { class: "num", text: head(m) }); tipOn(th, mtip(m)); return th; }))));
  const body = h("tbody");
  for (const k of keys) {
    const tr = h("tr", { class: k === "reliability" ? "prop-row" : "" }, sysCell(k));
    for (const m of cols) tr.append(h("td", { class: "num" }, cellText(m, mv[m][k]), badge(ranksFor(mv[m], m)[k])));
    body.append(tr);
  }
  t.append(body);
  return h("div", { class: "overflow" }, t);
}
function barChart(groups, m) {
  const items = itemsOf(groups), M = METRICS[m];
  const rows = sysKeys().map(k => ({ k, v: mean(items.map(r => value(r, k, m))) })).filter(r => r.v != null);
  rows.sort((a, b) => M.better === "low" ? a.v - b.v : M.better === "one" ? Math.abs(a.v - 1) - Math.abs(b.v - 1) : b.v - a.v);
  const max = M.pct ? 100 : M.better === "low" ? Math.max(...rows.map(r => r.v)) : M.better === "one" ? Math.max(...rows.map(r => r.v), 1.5) : 1;
  const box = h("div", {}, h("h3", { text: M.label + " " + M.arrow }), h("div", { class: "small", text: mtip(m) }));
  for (const r of rows) {
    const fill = h("div", { class: "bar-fill" }); fill.style.width = Math.max(0, Math.min(100, 100 * r.v / max)) + "%";
    const row = h("div", { class: "bar-row" }, h("div", { class: "lbl", text: BARLBL[r.k] || r.k }), h("div", { class: "bar-track" }, fill), h("div", { class: "val", text: cellText(m, r.v) }));
    tipOn(row, `${NAME[r.k]}: ${cellText(m, r.v)} (mean over ${items.length} sentences)`);
    box.append(row);
  }
  return box;
}
function heatmap(groups, metric) {
  const items = itemsOf(groups), keys = sysKeys();
  const val = (a, b) => { if (a === b) return 1; const key = keys.indexOf(a) < keys.indexOf(b) ? `${a}|${b}` : `${b}|${a}`; return mean(items.map(r => r.pair[key]?.[metric])); };
  const t = h("table", { class: "heat" }), hd = h("tr", {}, h("th"));
  keys.forEach(k => hd.append(h("th", { text: SHORT[k] || k })));
  t.append(h("thead", {}, hd));
  const body = h("tbody");
  for (const a of keys) {
    const tr = h("tr", {}, h("th", { class: "rowh", text: SHORT[a] || a }));
    for (const b of keys) {
      const v = val(a, b), td = h("td", { class: "cell", text: fmt(v, 2) });
      if (v != null) shade(td, v);
      tipOn(td, `${NAME[a]} vs ${NAME[b]}: ${fmt(v, 2)}`);
      tr.append(td);
    }
    body.append(tr);
  }
  t.append(body);
  return h("div", { class: "overflow" }, t);
}
function legendLine() {
  return h("p", { class: "small" }, "↑ higher is better · ↓ lower is better · →1 closest to 1.00 is best · ", h("span", { class: "rk r1", text: "1st" }), " best and ", h("span", { class: "rk r2", text: "2nd" }),
    " second best among the synthesized systems (the real recording is the reference, never ranked; systems tied at the printed precision share a mark). Gaps of a point or two between the IndicF5-based systems are within noise. Roles: ", tagEl("gt"), tagEl("indicf5"), tagEl("lora"), tagEl("adapter"), tagEl("reliability"), tagEl("mms"), " (see the Architecture tab).");
}
function renderOverview(root) {
  const grp = ["female", "male"];
  root.replaceChildren(
    h("h2", { text: "How close is each system to the real recording?" }),
    h("p", { text: `Means over the ${itemsOf(grp).length} female and male sentences (neutral request). Each clip is compared with the real recording of the same sentence after aligning the two in time. These are similarity measures against one real reading, not quality scores.` }),
    legendLine(),
    summaryTable(grp),
    h("p", { class: "small", text: "The real-recording row shows only the recognizer's error on real speech (the ceiling for this recognizer). Voice cosine is low for MMS because MMS has one fixed voice and does not copy the speaker. Sim. to F5 compares each clip with the untouched IndicF5 clip of the same sentence." }),
    h("div", { class: "bars" }, ["sim_gt", "pitch_corr", "energy_corr", "spk_cos", "mfcc_dist", "cer"].map(m => barChart(grp, m))),
    h("h2", { text: "Which clips resemble each other?" }),
    h("p", { text: "Each cell is the correlation between two versions of the same sentence, averaged over the sentences. A value near 1 means the two follow the same contour. Base 1 = untouched IndicF5, Base 2 = +LoRA, Base 3 = +control adapter, Proposed = +reliability-aware training." }),
  );
  const mSel = h("select", { "aria-label": "Contour" }, h("option", { value: "pitch_corr", text: "Pitch contour" }), h("option", { value: "energy_corr", text: "Loudness contour" }));
  const gSel = h("select", { "aria-label": "Sentences" }, ...[["all", "All 15 sentences"], ["female", "Female (5)"], ["male", "Male (5)"], ["controls", "Control cases (5)"]].map(([v, t]) => h("option", { value: v, text: t })));
  const holder = h("div");
  const draw = () => holder.replaceChildren(heatmap(gSel.value === "all" ? ["female", "male", "controls"] : [gSel.value], mSel.value));
  mSel.addEventListener("change", draw); gSel.addEventListener("change", draw);
  root.append(h("div", { class: "row" }, mSel, gSel), holder);
  draw();
}

// ---------- female / male cards
function sampleCard(g, r) {
  const keys = sysKeys().filter(k => r.systems[k]);
  const V = {}; CARD_COLS.forEach(m => { V[m] = {}; keys.forEach(k => V[m][k] = value(r, k, m)); });
  const RK = {}; CARD_COLS.forEach(m => RK[m] = ranksFor(V[m], m));
  const best = Object.keys(RK.sim_gt).find(k => RK.sim_gt[k] === "1st"), second = Object.keys(RK.sim_gt).find(k => RK.sim_gt[k] === "2nd");
  const prop = r.systems.reliability ? V.sim_gt.reliability : null, propF5 = r.systems.reliability ? V.sim_f5.reliability : null;
  const hd = h("tr", {}, h("th", { text: "System" }), h("th", { text: "Listen" }), CARD_COLS.map(m => { const th = h("th", { class: "num", text: head(m) }); tipOn(th, mtip(m)); return th; }));
  const body = h("tbody");
  for (const k of keys) {
    const x = r.systems[k].neutral;
    const tr = h("tr", { class: k === "reliability" ? "prop-row" : "" }, sysCell(k), h("td", {}, player(x.file)));
    for (const m of CARD_COLS) {
      const v = V[m][k], td = h("td", { class: "num" }, cellText(m, v), badge(RK[m][k]));
      if (k === "gt" && m === "sim_gt") td.textContent = "reference";
      if (k === "indicf5" && m === "sim_f5") td.textContent = "reference";
      if (k !== "gt" && (m === "pitch_corr" || m === "energy_corr" || m === "spk_cos") && v != null) shade(td, v);
      tr.append(td);
    }
    body.append(tr);
  }
  const heard = h("details", {}, h("summary", { text: "What the recognizer heard" }),
    ...keys.map(k => h("p", { class: "heard" }, h("b", { text: (NAME[k] || k) + ": " }), r.systems[k].neutral.heard || "(no transcript: failed clip)")));
  const summary = h("div", { class: "verdict" },
    best ? h("span", {}, h("b", { text: "Closest to the ground truth: " }), tagEl(best), NAME[best], ` (${Math.round(V.sim_gt[best])}%)`) : null,
    second ? h("span", {}, h("b", { text: " · second: " }), tagEl(second), NAME[second], ` (${Math.round(V.sim_gt[second])}%)`) : null,
    prop != null ? h("div", { class: "small" }, h("b", { text: "Proposed system on this sentence: " }), `${Math.round(prop)}% similar to the ground truth, ${Math.round(propF5)}% similar to untouched IndicF5.`) : null);
  return h("div", { class: "card" },
    h("div", { class: "meta", text: `${r.id} · real recording ${fmt(r.gt_seconds, 1)} s · ${r.speaker === "gu_f01" ? "female" : "male"} speaker` }),
    h("div", { class: "gu", lang: "gu", text: r.text }), summary,
    h("div", { class: "overflow" }, h("table", {}, h("thead", {}, hd), body)), heard);
}
function renderGroup(root, g, title, blurb) {
  root.replaceChildren(h("h2", { text: title }), h("p", { text: blurb }), legendLine(), ...DATA.groups[g].map(r => sampleCard(g, r)));
}

// ---------- control requests
function controlCard(r) {
  const keys = ["indicf5", "lora", "adapter", "dsp", "reliability"];
  const hd = h("tr", {}, h("th", { text: "System" }), CONDS.map(c => h("th", { text: COND_LABEL[c] })));
  const body = h("tbody");
  for (const k of keys) {
    const tr = h("tr", { class: k === "reliability" ? "prop-row" : "" }, sysCell(k));
    for (const c of CONDS) {
      let x = r.systems[k]?.[c]; const td = h("td");
      if (!x && k === "dsp" && c === "neutral") x = r.systems.lora?.neutral;       // a neutral request leaves B1's clip untouched
      if (x) {
        td.append(playBtn(x.file, `${NAME[k]} ${COND_LABEL[c]}`));
        const a = c.startsWith("pitch") ? ["ach_pitch_st", " st"] : c.startsWith("energy") ? ["ach_energy_db", " dB"] : c.startsWith("rate") ? ["ach_rate", "×"] : null;
        if (a && x[a[0]] != null) { const s = h("div", { class: "small", text: `got ${Number(x[a[0]]).toFixed(2)}${a[1]}` }); tipOn(s, "Value measured in the clip, relative to this speaker's reference level. A request of pitch +1.5 st should give about +1.5."); td.append(s); }
      } else td.append(h("span", { class: "small", text: "–" }));
      tr.append(td);
    }
    body.append(tr);
  }
  return h("div", { class: "card" },
    h("div", { class: "meta", text: `${r.id} · real recording ${fmt(r.gt_seconds, 1)} s · ${r.speaker === "gu_f01" ? "female" : "male"} speaker` }),
    h("div", { class: "gu", lang: "gu", text: r.text }),
    h("div", { class: "row" }, tagEl("gt"), h("b", { text: "Real recording" }), player(r.systems.gt.neutral.file)),
    h("div", { class: "overflow" }, h("table", {}, h("thead", {}, hd), body)));
}
function responseTable() {
  const items = DATA.groups.controls, keys = ["indicf5", "lora", "adapter", "dsp", "reliability"];
  const axes = [["Pitch", "pitch-1.5", "pitch+1.5", "ach_pitch_st", 3.0], ["Energy", "energy-2.5", "energy+2.5", "ach_energy_db", 5.0], ["Rate", "rate0.88", "rate1.12", "ach_rate", 0.24]];
  const t = h("table", {}, h("thead", {}, h("tr", {}, h("th", { text: "System" }), axes.map(a => h("th", { class: "num", text: a[0] + " response ↑" })))));
  const body = h("tbody");
  for (const k of keys) {
    const tr = h("tr", { class: k === "reliability" ? "prop-row" : "" }, sysCell(k));
    for (const [, lo, hi, f, d] of axes) {
      const v = items.map(r => { const a = r.systems[k]?.[lo]?.[f], b = r.systems[k]?.[hi]?.[f]; return a != null && b != null ? (b - a) / d : null; });
      tr.append(h("td", { class: "num", text: `${fmt(mean(v), 2)} (n=${v.filter(x => x != null).length})` }));
    }
    body.append(tr);
  }
  t.append(body);
  return h("div", { class: "overflow" }, t);
}
function renderControls(root) {
  root.replaceChildren(
    h("h2", { text: "Control requests: does asking for a different pitch, loudness or speed change the speech?" }),
    h("p", { text: "Each sentence was synthesized under seven requests, by the four IndicF5-based systems and, for the six non-neutral requests, by a deterministic signal-processing edit of Baseline 2\'s clip (Baseline 4). Pitch and energy are requested relative to the speaker's own reference level (for example +1.5 semitones above it). Under each play button is the value actually measured in that clip. MMS-TTS has no such controls and is not part of this test." }),
    h("div", { class: "notice" }, h("p", { text: "Read this first: only Baseline 3 and the Proposed system were trained to take pitch and energy requests. In this study their controls did not work (also not with the extra acoustic loss that was tried): the measured pitch and energy hardly move with the request. The rate request has an effect, but it works through the generation length, for every system including untouched IndicF5. The only row that follows the pitch and energy requests is Baseline 4, which does not use a trained control at all: it edits Baseline 2's finished clip with a pitch shifter (WORLD vocoder, formants kept), a gain and a time stretch." })),
    h("h3", { text: "Response, averaged over the five sentences" }),
    h("p", { class: "small", text: "Measured change divided by requested change between the low and high request. 1.00 = the request is fully followed, 0 = no response; higher is better. Pitch and energy are about 0 for every trained system; rate is about 0.5–0.7 even for the untouched model; the DSP edit (Baseline 4) is about 1." }),
    responseTable(),
    h("h3", { text: "Listen" }),
    ...DATA.groups.controls.map(controlCard));
}

// ---------- architecture and contributions
function layer(title, detail, status, tagKey, params) {
  const todo = status === "Not built yet";
  return h("div", { class: "layer" + (todo ? " todo" : "") },
    h("div", { class: "lhead" }, tagKey ? tagEl(tagKey) : null, h("b", { text: title }), h("span", { class: "chip " + (todo ? "chip-todo" : "chip-ok"), text: status }), params ? h("span", { class: "small", text: params }) : null),
    h("div", { class: "small", text: detail }));
}
function simSummary() {
  const items = itemsOf(["female", "male"]), keys = sysKeys().filter(k => k !== "gt");
  const t = h("table", {}, h("thead", {}, h("tr", {}, h("th", { text: "System" }), h("th", { class: "num", text: "Sim. to ground truth ↑" }), h("th", { class: "num", text: "Sim. to untouched IndicF5" }))));
  const body = h("tbody"); const out = {};
  for (const k of keys) {
    const g = mean(items.map(r => value(r, k, "sim_gt"))), f = k === "indicf5" ? null : mean(items.map(r => value(r, k, "sim_f5")));
    out[k] = { g, f };
    body.append(h("tr", { class: k === "reliability" ? "prop-row" : "" }, sysCell(k, true), h("td", { class: "num", text: cellText("sim_gt", g) }), h("td", { class: "num", text: k === "indicf5" ? "reference" : cellText("sim_f5", f) })));
  }
  t.append(body);
  return { table: h("div", { class: "overflow" }, t), out };
}
const simpleTable = (headers, rows, rowClass) => h("div", { class: "overflow" }, h("table", {}, h("thead", {}, h("tr", {}, headers.map(x => h("th", { text: x })))),
  h("tbody", {}, ...rows.map(r => h("tr", { class: rowClass ? rowClass(r) : "" }, r.map((c, i) => c && c.nodeType ? h("td", {}, c) : h("td", { text: c, class: i === 0 ? "sys" : "" })))))));
function renderArchitecture(root) {
  const S = simSummary(), P = S.out.reliability, B2 = S.out.lora;
  root.replaceChildren(
    h("h2", { text: "The proposed architecture" }),
    h("p", { text: "Research question: under a fixed adaptation-data and GPU budget, does measurement-aware acoustic conditioning control pitch, loudness and speaking rate better than ordinary parameter-efficient adaptation and an equally sized neural control adapter, while keeping the words and the speaker? The proposal is built on top of IndicF5 (a Gujarati-capable F5-TTS), keeping its backbone and vocoder, and adds small, removable parts." }),
    h("div", { class: "stack" },
      layer("Inputs", "Text, a reference recording of the target speaker, the language, and the requested controls: pitch offset (semitones), energy offset (dB) and rate multiplier, each with a present/missing flag and the reference recording's reliability.", "Implemented", null, ""),
      layer("IndicF5 / F5-TTS backbone (frozen)", "A flow-matching transformer (DiT) with the Vocos vocoder and the same sampler (16 steps) for every system. Untouched, it is the first baseline.", "Implemented", "indicf5", "337.1 M parameters"),
      layer("+ LoRA adaptation", "Rank-16 low-rank updates on the attention and feed-forward layers, trained on 2 hours of the speaker's speech with the backbone's own flow-matching loss. This is the ordinary adaptation baseline.", "Implemented", "lora", "+5.05 M trainable"),
      layer("+ control adapter", "A small network turns the 11 control inputs into a vector added to the time embedding, so it modulates all 22 transformer blocks; its last layer starts at zero, so switching it off gives back the backbone. Every control is kept in training with equal weight. It is the matched baseline that isolates the proposed mechanism.", "Implemented", "adapter", "+0.33 M trainable"),
      layer("+ reliability-aware training (the proposed mechanism)", "Same adapter and size. During training each control measured from the target recording is kept with probability equal to its measured reliability (from two independent pitch estimators, clipping, availability) and otherwise replaced by an explicit 'missing' value. The training loss is unchanged. Two ablations (random dropout at the same average rate, shuffled reliabilities) are implemented and were being trained on the cluster (3 seeds each) when this page was last updated.", "Implemented", "reliability", "same 0.33 M"),
      layer("Auxiliary acoustic loss (planned part of Contribution 1)", "A frozen predictor of pitch and energy (trained on the 2-hour subset only; it agrees with two independent extractors at r ≥ 0.98) checks the model's estimate of the final mel against the requested controls, weighted by reliability. It was tried at three weights for Baseline 3 and the Proposed system (6 runs). The controls still did not respond (pitch ≤ 0.01, energy ≤ 0.11; gate 0.30).", "Built, no gain", "reliability", ""),
      layer("Operating envelope (Contribution 2)", "Choose supported control strengths (0, 0.25, 0.5, 1 of the requested change) from calibration data, flag unsupported requests and count them as failures, never silently changing the request; the same calibration is applied to Baseline 3, the Proposed system and the DSP edit. The machinery is built and tested; its results come from the confirmatory evaluation, which was still running when this page was last updated.", "Built, results pending", null, ""),
    ),
    h("h2", { text: "Is the proposed system just F5-TTS?" }),
    h("p", { text: "No: the architecture differs, but so far its output does not. The table lists what is the same and what is added." }),
    simpleTable(["Part", "F5-TTS / IndicF5", "Proposed system", "Same?"], [
      ["Backbone and vocoder", "DiT transformer + Vocos", "the same weights, plus low-rank updates", "Base same, 1.6% added"],
      ["Trainable parameters", "0 when untouched", "5.38 M (LoRA 5.05 M + adapter 0.33 M)", "Different"],
      ["Conditioning", "text + reference recording", "also pitch, energy and rate requests, with masks and reliability", "Different"],
      ["Training signal", "flow-matching loss", "the same loss; control inputs are dropped by measured reliability", "Loss same, inputs different"],
      ["Sampler", "16 steps, same guidance", "identical", "Same"],
    ]),
    h("h3", { text: "How different are the outputs? (10 female and male sentences)" }),
    S.table,
    h("p", { text: `The proposed system's audio is ${Math.round(P.f)}% similar to untouched IndicF5's and ${Math.round(P.g)}% similar to the ground truth; the plain LoRA baseline is ${Math.round(B2.f)}% and ${Math.round(B2.g)}%. So far the added control parts have not made the proposed output differ from the baselines in a measurable way: the pitch and energy controls did not respond, and any gain over untouched IndicF5 (for example in voice similarity) is already there with LoRA alone.` }),
    h("h2", { text: "Baselines and references" }),
    simpleTable(["Role", "ID", "System", "Status"], [
      [tagEl("gt"), "–", "Real recording of the same sentence", "Reference for every measurement"],
      [tagEl("indicf5"), "B0", "IndicF5 / F5-TTS, no adaptation", "Run"],
      [tagEl("lora"), "B1", "IndicF5 + LoRA: ordinary adaptation", "Run"],
      [tagEl("dsp"), "B2", "Deterministic pitch, rate and energy editing of B1's output (shown on the Control requests tab)", "Run: pitch and energy response about 1.00, rate 0.95; speaker cosine −0.04"],
      [tagEl("adapter"), "B3", "Same control inputs and size as the proposal, uniform weights, no reliability", "Run"],
      [h("span", { class: "tag base", text: "Baseline" }), "B4", "Closest recent published control method: PitchFlow-style classifier guidance on B1 (Interspeech 2024; an approximation of it)", "Chosen by the novelty audit; being built"],
      [tagEl("reliability"), "P", "B3 plus reliability-aware training", "Run (also with the auxiliary loss: no gain); envelope results pending"],
      [tagEl("mms"), "–", "MMS-TTS-guj, a separate Gujarati TTS model", "Run, for reference only"],
    ], r => r[1] === "P" ? "prop-row" : ""),
    h("h2", { text: "Contributions and what the evidence says" }),
    h("p", { text: "The six candidate contributions of the research plan. Only a method contribution needs to beat a baseline; the others are evaluation or reproducibility results. Status is stated as of this page's data." }),
    simpleTable(["#", "Contribution", "Type", "Status", "Evidence so far"], [
      ["Contribution 1", "Measurement-aware conditioning: use the reliability of pitch and energy estimates when training the small adapter", "Method", "Mechanism and auxiliary loss built and tested", "Not supported. Both Baseline 3 and the Proposed system leave the controls at about 0 response (gate 0.30), across 4 training settings and 3 auxiliary-loss weights; the largest Proposed-minus-Baseline-3 gap is 0.06. Three-seed confirmation and the two ablations were running when this page was last updated."],
      ["Contribution 2", "Empirical operating envelope: supported control strengths with pronunciation and speaker checks", "Method", "Built; results pending", "Calibration and lookup machinery tested; the measurements (B2, B3, P at four strengths, range clipping) were still running."],
      ["Contribution 3", "Matched-input intervention protocol: measure the intended change and the unintended changes with identical text, reference and seed", "Evaluation", "Built and used", "Used in the pilot and on this page's Control requests tab. It separates a control that works (the DSP edit, about 1.00) from controls that do not (trained adapters, about 0; rate 0.5–0.7 through length, even for untouched IndicF5)."],
      ["Contribution 4", "Controlled Gujarati-centred study of data size, second-language transfer and speakers", "Empirical", "Partly done", "Gujarati 2-hour pilot, a 12-run hyper-parameter pilot and a 6-run auxiliary-loss pilot done; three-seed confirmation running. Hindi, the 0.5 / 2 / 5 hour sweep and more speakers (only two exist) are not done."],
      ["Contribution 5", "Reproducible automatic evaluation: real-speech ASR check, independent extractors, uncertainty, failure accounting", "Evaluation", "Built", "Recognizer chosen on real dev speech (whisper-gujarati-medium, 5.9% character error); speaker embedding, audit extractors and bootstrap intervals in place. No listening test."],
      ["Contribution 6", "Restartable experiment package: checkpoints, logs, gallery, dashboard, traceable paper numbers", "Reproducibility", "Built; paper not written", "Kill and resume drill passed on the real model; per-epoch audio gallery and dashboard exist. Manuscript and fresh-checkout reproduction still to do."],
    ]),
  );
}

// ---------- about
function renderAbout(root) {
  root.replaceChildren(
    h("h2", { text: "What this page shows" }),
    h("p", { text: "Fifteen Gujarati sentences held out from training: 5 for the female speaker, 5 for the male speaker, and 5 more used for the control-request test. For every sentence the page offers the real recording and the synthesized versions, and measures each synthesized clip against that recording." }),
    h("h3", { text: "How the sentences were chosen" }),
    h("p", { text: `From the ${DATA.selection.pool_size} development sentences for which every system produced a valid clip under every request, a seeded shuffle (seed ${DATA.selection.seed}) picked 5 per speaker, then 5 more for the control test. No listening and no metric was used to choose, so the samples are not the best ones. The male pool was small because longer male sentences exceeded the 25-second prompt-plus-speech budget, which also failed for untouched IndicF5.` }),
    h("h3", { text: "The measurements" }),
    h("p", { text: "Every clip is time-aligned to the real recording (dynamic time warping on 10 ms MFCC frames), then:" }),
    h("ul", {}, ...["pitch_corr", "energy_corr", "mfcc_dist", "dur_ratio", "spk_cos", "cer"].map(m => h("li", { text: `${METRICS[m].label} ${METRICS[m].arrow}: ${METRICS[m].long} ${BETTER_TEXT[METRICS[m].better]}` }))),
    h("h3", { text: "Similarity percentages" }),
    h("ul", {}, h("li", { text: "Pitch similarity = pitch correlation × 100 (negative values count as 0)." }), h("li", { text: "Loudness similarity = loudness correlation × 100 (negative as 0)." }), h("li", { text: "Voice similarity = speaker cosine × 100." }),
      h("li", { text: "Length match = 100 × (1 − |length ratio − 1|)." }), h("li", { text: "Sim. to GT = the plain average of those four, compared with the real recording; Sim. to F5 = the same recipe compared with the untouched IndicF5 clip of the same sentence. This average is a simple summary for orientation, not a validated quality score." })),
    h("h3", { text: "1st and 2nd" }),
    h("p", { text: "In every table the synthesized systems are ranked per measure by how close they come to the ideal direction (shown by the arrow). The real recording is the reference and is never ranked. Sim. to F5 is not ranked." }),
    h("p", { text: "A synthesized sentence can differ from one human reading in rhythm and pitch and still be good, so a low correlation is not a fault. These numbers describe similarity and intelligibility; no listening test was run. With five sentences per group, differences between systems are indicative only." }),
    h("h3", { text: "Audio" }),
    h("p", { text: `All clips are 24 kHz mono FLAC, lossless, with no loudness normalisation. A few generated clips exceed full scale (peak ${DATA.peak_max}) and are clipped in these files, as they would be by any playback device; the measurements used the unclipped originals.` }),
    h("h3", { text: "Credits and licences" }),
    h("ul", {},
      h("li", { text: "Real recordings: IISc SPICOR project Gujarati corpus (SYSPIN / SPIRE Lab, IISc). The SYSPIN corpus is published under CC BY 4.0; check the terms of the Gujarati subset before reusing these clips." }),
      h("li", { text: "IndicF5: AI4Bharat, MIT licence, built on F5-TTS. Its model card asks users to clone only voices they have permission to use; the voice prompts here are recordings of the two speakers of the same published corpus. The adapted variants are this study's own work." }),
      h("li", { text: "MMS-TTS-guj: Meta, CC BY-NC 4.0, so this page is for non-commercial research use only." })),
  );
}

// ---------- tabs
const TABS = [
  ["overview", "Overview", renderOverview],
  ["architecture", "Architecture & contributions", renderArchitecture],
  ["female", "Female speaker", root => renderGroup(root, "female", "Female speaker: 5 sentences", "Each card plays the real recording first, then every system's version of the same sentence. The four IndicF5-based systems were given a different recording of the same speaker as the voice prompt. MMS-TTS has its own fixed voice.")],
  ["male", "Male speaker", root => renderGroup(root, "male", "Male speaker: 5 sentences", "Same layout as the female page.")],
  ["controls", "Control requests", renderControls],
  ["about", "Method & notes", renderAbout],
];
function show(id) {
  document.querySelectorAll("#tabs button[data-id]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.id === id)));
  pauseAll();
  TABS.find(t => t[0] === id)[2](document.getElementById("view"));
  history.replaceState(null, "", "#" + id);
}
function toggleTheme() {
  const next = dark() ? "light" : "dark"; document.documentElement.dataset.theme = next; localStorage.setItem("theme", next);
  show(document.querySelector('#tabs button[aria-selected="true"]').dataset.id);
}
async function main() {
  const saved = localStorage.getItem("theme"); if (saved) document.documentElement.dataset.theme = saved;
  DATA = await (await fetch("data/samples.json")).json();
  const tabs = document.getElementById("tabs");
  for (const [id, label] of TABS) tabs.append(h("button", { "data-id": id, role: "tab", "aria-selected": "false", onclick: () => show(id) }, label));
  tabs.append(h("span", { class: "spacer" }), h("button", { onclick: toggleTheme, "aria-label": "Toggle dark mode" }, "Light / dark"));
  show(TABS.some(t => "#" + t[0] === location.hash) ? location.hash.slice(1) : "overview");
}
main().catch(e => document.getElementById("view").replaceChildren(h("div", { class: "notice", text: "Could not load data/samples.json: " + e.message + ". Serve this folder over HTTP (for example `python3 -m http.server`) instead of opening the file directly." })));
