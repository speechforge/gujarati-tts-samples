"use strict";
const METRICS = {
  pitch_corr:  { label: "Pitch r",    long: "Pitch-contour correlation with the real recording (DTW-aligned, semitones, voiced frames). Higher = more similar.", better: "high", fmt: 2 },
  energy_corr: { label: "Energy r",   long: "Loudness-contour correlation with the real recording (DTW-aligned, dB). Higher = more similar.", better: "high", fmt: 2 },
  mfcc_dist:   { label: "MFCC dist",  long: "MFCC distance to the real recording after alignment (MCD-style, not comparable with published MCD). Lower = closer.", better: "low", fmt: 1 },
  dur_ratio:   { label: "Length ×",   long: "Clip length divided by the real recording's length. 1.00 = same length.", better: "one", fmt: 2 },
  spk_cos:     { label: "Voice cos",  long: "ECAPA speaker-embedding cosine between the clip and the real recording. Higher = more similar voice.", better: "high", fmt: 2 },
  cer:         { label: "CER",        long: "Character error rate of a Gujarati speech recognizer (whisper-gujarati-medium) on the clip, against the sentence text. Lower = more intelligible.", better: "low", fmt: 3 },
};
const BARLBL = { gt: "Real recording", indicf5: "IndicF5", lora: "IndicF5 + LoRA", adapter: "+ control adapter", reliability: "+ reliability masks", mms: "MMS-TTS", parler: "Indic Parler-TTS" };
const SHORT = { gt: "Real", indicf5: "IndicF5", lora: "+LoRA", adapter: "+Adapter", reliability: "+Reliab.", mms: "MMS", parler: "Parler" };
const CONDS = ["neutral", "pitch-1.5", "pitch+1.5", "energy-2.5", "energy+2.5", "rate0.88", "rate1.12"];
const COND_LABEL = { "neutral": "Neutral", "pitch-1.5": "Pitch −1.5 st", "pitch+1.5": "Pitch +1.5 st", "energy-2.5": "Energy −2.5 dB", "energy+2.5": "Energy +2.5 dB", "rate0.88": "Rate ×0.88", "rate1.12": "Rate ×1.12" };
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];   // sequential blue, light -> dark
let DATA = null;

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

function rampColor(t) {            // t in [0,1] -> hex on the blue ramp; reversed in dark mode so "more" is lighter against the dark surface
  t = Math.max(0, Math.min(1, t)); if (dark()) t = 1 - t;
  const x = t * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  const a = RAMP[i].match(/\w\w/g).map(s => parseInt(s, 16)), b = RAMP[i + 1].match(/\w\w/g).map(s => parseInt(s, 16));
  return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}
function shade(el, t) {
  const c = rampColor(t); el.style.background = `rgb(${c.join(",")})`;
  el.style.color = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) < 140 ? "#fff" : "#0b0b0b";
}

// ---- tooltip (enhances; every value is also in a table)
const tip = h("div", { id: "tip", role: "tooltip" });
document.addEventListener("DOMContentLoaded", () => document.body.append(tip));
function tipOn(el, text) {
  el.dataset.tip = text; el.tabIndex = 0;
  const show = ev => { tip.textContent = text; tip.style.display = "block"; const r = el.getBoundingClientRect(); tip.style.left = Math.min(innerWidth - 300, ev.clientX ? ev.clientX + 12 : r.left) + "px"; tip.style.top = (ev.clientY ? ev.clientY + 14 : r.bottom + 6) + "px"; };
  el.addEventListener("pointermove", show); el.addEventListener("focus", show);
  el.addEventListener("pointerleave", () => tip.style.display = "none"); el.addEventListener("blur", () => tip.style.display = "none");
}

// ---- audio: one clip at a time
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

// ---- overview
function itemsOf(groups) { return groups.flatMap(g => DATA.groups[g]); }
function sysKeys() { return Object.keys(DATA.systems); }
function summaryTable(groups, metricKeys) {
  const items = itemsOf(groups), keys = sysKeys();
  const t = h("table", {}, h("thead", {}, h("tr", {}, h("th", { text: "System" }), metricKeys.map(m => { const th = h("th", { class: "num", text: METRICS[m].label }); tipOn(th, METRICS[m].long); return th; }))));
  const body = h("tbody");
  for (const k of keys) {
    const tr = h("tr", {}, h("td", { class: "sys", text: DATA.systems[k] }));
    for (const m of metricKeys) {
      const v = mean(items.map(r => r.systems[k]?.neutral?.[m]));
      tr.append(h("td", { class: "num", text: fmt(v, METRICS[m].fmt) }));
    }
    body.append(tr);
  }
  t.append(body);
  return h("div", { class: "overflow" }, t);
}
function barChart(groups, m) {
  const items = itemsOf(groups), M = METRICS[m];
  const rows = sysKeys().map(k => ({ k, v: mean(items.map(r => r.systems[k]?.neutral?.[m])) })).filter(r => r.v != null);
  rows.sort((a, b) => M.better === "low" ? a.v - b.v : M.better === "one" ? Math.abs(a.v - 1) - Math.abs(b.v - 1) : b.v - a.v);
  const max = M.better === "low" ? Math.max(...rows.map(r => r.v)) : M.better === "one" ? Math.max(...rows.map(r => r.v), 1.5) : 1;
  const box = h("div", {}, h("h3", { text: M.label }), h("div", { class: "small", text: M.long }));
  for (const r of rows) {
    const fill = h("div", { class: "bar-fill" }); fill.style.width = Math.max(0, Math.min(100, 100 * r.v / max)) + "%";
    const row = h("div", { class: "bar-row" }, h("div", { class: "lbl", text: BARLBL[r.k] || r.k }), h("div", { class: "bar-track" }, fill), h("div", { class: "val", text: fmt(r.v, M.fmt) }));
    tipOn(row, `${DATA.systems[r.k]}: ${fmt(r.v, M.fmt)} (mean over ${items.length} sentences)`);
    box.append(row);
  }
  return box;
}
function heatmap(groups, metric) {
  const items = itemsOf(groups), keys = sysKeys();
  const val = (a, b) => { if (a === b) return 1; const key = keys.indexOf(a) < keys.indexOf(b) ? `${a}|${b}` : `${b}|${a}`; return mean(items.map(r => r.pair[key]?.[metric])); };
  const t = h("table", { class: "heat" }), head = h("tr", {}, h("th"));
  keys.forEach(k => head.append(h("th", { text: SHORT[k] || k })));
  t.append(h("thead", {}, head));
  const body = h("tbody");
  for (const a of keys) {
    const tr = h("tr", {}, h("th", { class: "rowh", text: SHORT[a] || a }));
    for (const b of keys) {
      const v = val(a, b), td = h("td", { class: "cell", text: fmt(v, 2) });
      if (v != null) shade(td, v);
      tipOn(td, `${DATA.systems[a]} vs ${DATA.systems[b]}: ${METRICS[metric].label} ${fmt(v, 2)}`);
      tr.append(td);
    }
    body.append(tr);
  }
  t.append(body);
  return h("div", { class: "overflow" }, t);
}
function renderOverview(root) {
  const grp = ["female", "male"];
  root.replaceChildren(
    h("h2", { text: "How close is each system to the real recording?" }),
    h("p", { text: `Means over the ${itemsOf(grp).length} female and male sentences (neutral request). Each clip is compared with the real recording of the same sentence after aligning the two in time. These are similarity measures against one real reading, not quality scores.` }),
    summaryTable(grp, ["pitch_corr", "energy_corr", "mfcc_dist", "dur_ratio", "spk_cos", "cer"]),
    h("p", { class: "small", text: "The real recording row shows only the recognizer's error on real speech (the ceiling for this recognizer). Voice cosine is low for MMS because MMS has one fixed voice and does not copy the speaker." }),
    h("div", { class: "bars" }, ["pitch_corr", "energy_corr", "mfcc_dist", "spk_cos", "cer"].map(m => barChart(grp, m))),
    h("h2", { text: "Which clips resemble each other?" }),
    h("p", { text: "Each cell is the correlation between two versions of the same sentence, averaged over the sentences. A value near 1 means the two follow the same contour." }),
  );
  const mSel = h("select", { "aria-label": "Contour" }, h("option", { value: "pitch_corr", text: "Pitch contour" }), h("option", { value: "energy_corr", text: "Loudness contour" }));
  const gSel = h("select", { "aria-label": "Sentences" }, ...[["all", "All 15 sentences"], ["female", "Female (5)"], ["male", "Male (5)"], ["controls", "Control cases (5)"]].map(([v, t]) => h("option", { value: v, text: t })));
  const holder = h("div");
  const draw = () => holder.replaceChildren(heatmap(gSel.value === "all" ? ["female", "male", "controls"] : [gSel.value], mSel.value));
  mSel.addEventListener("change", draw); gSel.addEventListener("change", draw);
  root.append(h("div", { class: "row" }, mSel, gSel), holder);
  draw();
}

// ---- female / male cards
function sampleCard(g, r) {
  const sys = r.systems, keys = sysKeys().filter(k => sys[k]);
  const head = h("tr", {}, h("th", { text: "System" }), h("th", { text: "Listen" }), Object.keys(METRICS).map(m => { const th = h("th", { class: "num", text: METRICS[m].label }); tipOn(th, METRICS[m].long); return th; }));
  const body = h("tbody");
  for (const k of keys) {
    const x = sys[k].neutral;
    const tr = h("tr", {}, h("td", { class: "sys", text: DATA.systems[k] }), h("td", {}, player(x.file)));
    for (const m of Object.keys(METRICS)) {
      const td = h("td", { class: "num", text: fmt(x[m], METRICS[m].fmt) });
      if ((m === "pitch_corr" || m === "energy_corr" || m === "spk_cos") && x[m] != null) shade(td, x[m]);
      tr.append(td);
    }
    body.append(tr);
  }
  const heard = h("details", {}, h("summary", { text: "What the recognizer heard" }),
    ...keys.map(k => h("p", { class: "heard" }, h("b", { text: DATA.systems[k] + ": " }), sys[k].neutral.heard || "(no transcript: failed clip)")));
  return h("div", { class: "card" },
    h("div", { class: "meta", text: `${r.id} · real recording ${fmt(r.gt_seconds, 1)} s · ${r.speaker === "gu_f01" ? "female" : "male"} speaker` }),
    h("div", { class: "gu", lang: "gu", text: r.text }),
    h("div", { class: "overflow" }, h("table", {}, h("thead", {}, head), body)), heard);
}
function renderGroup(root, g, title, blurb) {
  root.replaceChildren(h("h2", { text: title }), h("p", { text: blurb }), ...DATA.groups[g].map(r => sampleCard(g, r)));
}

// ---- control requests
function controlCard(r) {
  const keys = ["indicf5", "lora", "adapter", "reliability"];
  const head = h("tr", {}, h("th", { text: "System" }), CONDS.map(c => h("th", { text: COND_LABEL[c] })));
  const body = h("tbody");
  for (const k of keys) {
    const tr = h("tr", {}, h("td", { class: "sys", text: DATA.systems[k] }));
    for (const c of CONDS) {
      const x = r.systems[k]?.[c], td = h("td");
      if (x) {
        td.append(playBtn(x.file, `${DATA.systems[k]} ${COND_LABEL[c]}`));
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
    h("div", { class: "row" }, h("b", { text: "Real recording" }), player(r.systems.gt.neutral.file)),
    h("div", { class: "overflow" }, h("table", {}, h("thead", {}, head), body)));
}
function responseTable() {
  const items = DATA.groups.controls, keys = ["indicf5", "lora", "adapter", "reliability"];
  const axes = [["Pitch", "pitch-1.5", "pitch+1.5", "ach_pitch_st", 3.0], ["Energy", "energy-2.5", "energy+2.5", "ach_energy_db", 5.0], ["Rate", "rate0.88", "rate1.12", "ach_rate", 0.24]];
  const t = h("table", {}, h("thead", {}, h("tr", {}, h("th", { text: "System" }), axes.map(a => h("th", { class: "num", text: a[0] + " response" })))));
  const body = h("tbody");
  for (const k of keys) {
    const tr = h("tr", {}, h("td", { class: "sys", text: DATA.systems[k] }));
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
    h("p", { text: "Each sentence was synthesized under seven requests, by the four IndicF5-based systems. Pitch and energy are requested relative to the speaker's own reference level (for example +1.5 semitones above it). Under each play button is the value actually measured in that clip. MMS-TTS has no such controls and is not part of this test." }),
    h("div", { class: "notice" }, h("p", { text: "Read this first: only the +Adapter and +Reliab. systems were trained to take pitch and energy requests. In this study their controls did not work: the measured pitch and energy hardly move with the request. Only the rate request has an effect, and it works through the generation length, for every system including untouched IndicF5." })),
    h("h3", { text: "Response, averaged over the five sentences" }),
    h("p", { class: "small", text: "Measured change divided by requested change between the low and high request. 1.00 = the request is fully followed, 0 = no response. Pitch and energy are about 0 for every system; rate is about 0.5–0.7 even for the untouched model." }),
    responseTable(),
    h("h3", { text: "Listen" }),
    ...DATA.groups.controls.map(controlCard));
}

// ---- tabs
const TABS = [
  ["overview", "Overview", renderOverview],
  ["female", "Female speaker", root => renderGroup(root, "female", "Female speaker: 5 sentences", "Each card plays the real recording first, then every system's version of the same sentence. The four IndicF5-based systems were given a different recording of the same speaker as the voice prompt. MMS-TTS has its own fixed voice.")],
  ["male", "Male speaker", root => renderGroup(root, "male", "Male speaker: 5 sentences", "Same layout as the female page.")],
  ["controls", "Control requests", renderControls],
  ["about", "Method & notes", renderAbout],
];
function renderAbout(root) {
  root.replaceChildren(
    h("h2", { text: "What this page shows" }),
    h("p", { text: "Fifteen Gujarati sentences held out from training: 5 for the female speaker, 5 for the male speaker, and 5 more used for the control-request test. For every sentence the page offers the real recording and the synthesized versions, and measures each synthesized clip against that recording." }),
    h("h3", { text: "How the sentences were chosen" }),
    h("p", { text: `From the ${DATA.selection.pool_size} development sentences for which every system produced a valid clip under every request, a seeded shuffle (seed ${DATA.selection.seed}) picked 5 per speaker, then 5 more for the control test. No listening and no metric was used to choose, so the samples are not the best ones. The male pool was small because longer male sentences exceeded the 25-second prompt-plus-speech budget, which also failed for untouched IndicF5.` }),
    h("h3", { text: "The systems" }),
    h("ul", {}, ...Object.entries(DATA.systems).map(([k, v]) => h("li", { text: k === "gt" ? v + ": the recording from the corpus, the reference for every measurement." : k === "mms" ? v + ": a separate Gujarati text-to-speech model with one fixed voice; it does not copy the speaker." : v + (k === "indicf5" ? ": the released IndicF5 weights with no adaptation, prompted with a reference recording of the speaker." : ": trained on 2 hours of the speaker's speech, one seed (E2 experiment).") }))),
    h("h3", { text: "The measurements" }),
    h("p", { text: "Every clip is time-aligned to the real recording (dynamic time warping on 10 ms MFCC frames), then:" }),
    h("ul", {}, ...Object.values(METRICS).map(m => h("li", { text: `${m.label}: ${m.long}` }))),
    h("p", { text: "A synthesized sentence can differ from one human reading in rhythm and pitch and still be good, so a low correlation is not a fault. These numbers describe similarity and intelligibility; no listening test was run. With five sentences per group, differences between systems are indicative only." }),
    h("h3", { text: "Audio" }),
    h("p", { text: `All clips are 24 kHz mono FLAC, lossless, with no loudness normalisation. A few generated clips exceed full scale (peak ${DATA.peak_max}) and are clipped in these files, as they would be by any playback device; the measurements used the unclipped originals.` }),
    h("h3", { text: "Credits and licences" }),
    h("ul", {},
      h("li", { text: "Real recordings: IISc SPICOR project Gujarati corpus (SYSPIN / SPIRE Lab, IISc). The SYSPIN corpus is published under CC BY 4.0; check the terms of the Gujarati subset before reusing these clips." }),
      h("li", { text: "IndicF5: AI4Bharat, MIT licence, built on F5-TTS. Its model card asks users to clone only voices they have permission to use; the voice prompts here are recordings of the two speakers of the same published corpus. The fine-tuned variants are this study's own adaptations." }),
      h("li", { text: "MMS-TTS-guj: Meta, CC BY-NC 4.0, so this page is for non-commercial research use only." })),
  );
}
function show(id) {
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.id === id)));
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
