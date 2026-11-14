// Adjust: change values of the video yourself. Every field is built from script.json itself, so new scene
// types and new fields show up here without any change to this file. FIELD below only adds friendly names.
import { $, S, Studio, esc, getPath, pathKey, curScene, voiceStale, wordTime, pathLabel } from "../core.js";
import { seek, setPlay } from "../player.js";

// Friendly names and help for known keys. Unknown keys still work; they just show their raw name.
export const FIELD = {
  text: { label: "Narration", long: true, help: "What the voice says. Use {shown|spoken} to show one thing and say another. A change here needs a new voice take." },
  mood: { label: "Mood colour", options: ["red", "blue", "teal", "green", "gold", "purple"] },
  tag: { label: "Small tag" }, headline: { label: "Headline" }, title: { label: "Title" }, top: { label: "Top line" }, big: { label: "Big word" },
  label: { label: "Label" }, num: { label: "Number" }, dec: { label: "Decimals" }, delta: { label: "Percent change" }, ddec: { label: "Percent decimals" },
  approx: { label: "About (~)" }, dir: { label: "Arrow", options: ["up", "dn", "nt"] }, at: { label: "Appears on word", words: true },
  kind: { label: "Sound", options: ["whoosh", "whoosh2", "thud", "thud2", "pop"] }, sym: { label: "Ticker" },
  base: { label: "Previous close", help: "Real market data. Change only to correct it." }, col: { label: "Line colour" }, fill: { label: "Fill colour" },
  area: { label: "Filled area" }, dur: { label: "Draw time (s)" }, zlabel: { label: "Zone label" }, divider: { label: "Divider position" }, zpulseAt: { label: "Zone pulses on word", words: true },
  date: { label: "Date" }, dateLabel: { label: "Date label" }, dataNote: { label: "Data note", long: true },
  voice: { label: "Voice", help: "Needs a new voice take." }, speed: { label: "Voice speed", help: "Needs a new voice take." },
  pitch: { label: "Pitch" }, eq: { label: "Tone" }, echo: { label: "Echo" }, sub: { label: "Line under it" },
  id: { label: "Scene id", readonly: "Other files point at this id, so it is not editable here." },
  type: { label: "Picture type", readonly: "Changing the type swaps the whole picture. Ask Claude for that." },
};
const GROUP = { text: "Words", visual: "Picture", callouts: "Number chips", sfx: "Sounds", ticker: "Ticker strip", hook: "Opening hook", fx: "Voice effects" };
// Optional chip fields you can add when a chip does not have them yet.
const ADDABLE = { callouts: { num: 0, dec: 0, delta: 0, ddec: 1, approx: true, dir: "nt", text: "" } };
const isPrim = v => v === null || typeof v !== "object";
const isHex = v => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const view = { scope: "scene", follow: true, scene: 0, open: new Set(["Words", "Number chips", "Look"]) };

function field(path, key, value, ctx) {
  const f = FIELD[key] || {}, id = "f" + pathKey(path).replace(/\W+/g, "_"), chg = Studio.isChanged(path) ? " chg" : "";
  const label = esc(f.label || String(key)), dp = esc(pathKey(path));
  if (f.readonly) return `<div class="fld"><label>${label}</label><div class="ro" title="${esc(f.readonly)}">${esc(value)}</div><span></span></div>`;
  let ctl;
  if (typeof value === "boolean") ctl = `<input type="checkbox" id="${id}" data-p="${dp}" data-t="bool" ${value ? "checked" : ""}>`;
  else if (typeof value === "number") ctl = `<input type="number" step="any" id="${id}" data-p="${dp}" data-t="num" value="${value}">`;
  else if (isHex(value)) ctl = `<input type="color" data-p="${dp}" data-t="str" value="${value.toLowerCase()}"><input type="text" id="${id}" data-p="${dp}" data-t="str" value="${esc(value)}" style="max-width:110px">`;
  else if (f.options) { const opts = [...new Set([...f.options, value])]; ctl = `<select id="${id}" data-p="${dp}" data-t="str">${opts.map(o => `<option${o === value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`; }
  else if (f.long || String(value ?? "").length > 48) ctl = `<textarea id="${id}" data-p="${dp}" data-t="str" rows="${key === "text" ? 4 : 2}">${esc(value ?? "")}</textarea>`;
  else ctl = `<input type="text" id="${id}" data-p="${dp}" data-t="${value === null ? "null" : "str"}" value="${esc(value ?? "")}" ${f.words && ctx.words ? `list="words${ctx.i}"` : ""}>`;
  const wide = f.long || String(value ?? "").length > 48;
  const stale = key === "text" && ctx.i != null && voiceStale(ctx.i) ? '<div class="help warn" data-stale>The words no longer match the recorded voice. The picture updates now; the voice needs a new take from Claude.</div>' : key === "text" ? '<div class="help warn" data-stale hidden></div>' : "";
  return `<div class="fld${wide ? " wide" : ""}${chg}" data-f="${dp}"><label for="${id}">${label}</label><div class="ctl">${ctl}</div><button class="ghost rst" data-rst="${dp}" title="Put back the saved value">↺</button>${f.help ? `<div class="help">${esc(f.help)}</div>` : ""}${stale}</div>`;
}
function body(path, value, ctx, parentKey) {
  if (Array.isArray(value)) {
    if (value.every(isPrim)) {
      if (value.length > 8) return `<div class="ro">${value.length} chart points (real market data, not edited here)</div>`;
      return value.map((v, k) => field([...path, k], parentKey === "ticker" || value.length <= 2 ? ["Text", "Change"][k] ?? k + 1 : k + 1, v, ctx)).join("");
    }
    return value.map((v, k) => {
      const p = [...path, k], name = isPrim(v) ? "" : v.label || v.title || v.tag || v.sym || v.kind || (Array.isArray(v) ? v.filter(x => typeof x === "string").join(" ") : "");
      const show = !isPrim(v) && typeof v.at === "string" && ctx.i != null ? `<button class="ghost" data-show="${esc(v.at)}" title="Jump to where this appears">▶ show</button>` : "";
      const addable = ADDABLE[parentKey] && !Array.isArray(v) ? Object.keys(ADDABLE[parentKey]).filter(a => !(a in v)) : [];
      const add = addable.length ? `<select class="ghost" data-add="${esc(pathKey(p))}" data-parent="${esc(parentKey)}" title="Add a field to this item"><option value="">+ add</option>${addable.map(a => `<option value="${a}">${esc(FIELD[a]?.label || a)}</option>`).join("")}</select>` : "";
      return `<div class="card"><div class="ct"><span>${k + 1}${name ? " · " + esc(name) : ""}</span><span>${add}${show}</span></div>${isPrim(v) ? field(p, k + 1, v, ctx) : body(p, v, ctx, parentKey)}</div>`;
    }).join("");
  }
  const keys = Object.keys(value), prim = keys.filter(k => isPrim(value[k])), deep = keys.filter(k => !isPrim(value[k]));
  return prim.map(k => field([...path, k], k, value[k], ctx)).join("") + deep.map(k => `<div class="kv">${esc(FIELD[k]?.label || k)}</div>` + body([...path, k], value[k], ctx, k)).join("");
}
function group(title, inner, n) { return inner ? `<details class="grp" data-g="${esc(title)}" ${view.open.has(title) ? "open" : ""}><summary><span>${esc(title)}</span>${n ? `<small class="hint">${n}</small>` : ""}</summary><div class="body">${inner}</div></details>` : ""; }

function renderScene() {
  const i = view.scene, sc = S.draft.scenes[i]; if (!sc) return '<div class="hint">No scene here.</div>';
  const ctx = { i, words: true }, base = ["scenes", i];
  const look = Object.keys(sc).filter(k => isPrim(sc[k]) && k !== "text");
  const rest = Object.keys(sc).filter(k => !isPrim(sc[k]));
  return `<datalist id="words${i}">${(S.timing.scenes[i]?.words || []).map(w => `<option value="${esc(w.w.replace(/[.,!?;:]+$/, ""))}">`).join("")}</datalist>`
    + group("Words", "text" in sc ? field([...base, "text"], "text", sc.text, ctx) : "")
    + rest.map(k => group(GROUP[k] || k, body([...base, k], sc[k], ctx, k), Array.isArray(sc[k]) ? sc[k].length : "")).join("")
    + group("Look", look.map(k => field([...base, k], k, sc[k], ctx)).join(""));
}
function renderVideo() {
  const d = S.draft, ctx = { i: null }, prim = Object.keys(d).filter(k => isPrim(d[k]));
  return group("Video details", prim.map(k => field([k], k, d[k], ctx)).join(""))
    + Object.keys(d).filter(k => !isPrim(d[k]) && k !== "scenes").map(k => group(GROUP[k] || k, body([k], d[k], ctx, k), Array.isArray(d[k]) ? d[k].length : "")).join("");
}
function saveBar() {
  const n = S.pending.size, h = S.info.history || { undo: 0, redo: 0 }, ro = S.info.readOnly;
  return `<div id="savebar"><button class="primary" id="adjSave" ${n && !ro ? "" : "disabled"}>${n ? `Save ${n} change${n > 1 ? "s" : ""}` : "Saved"}</button><button id="adjDiscard" ${n ? "" : "disabled"}>Discard</button>
    <span class="state">${ro ? "Read-only: changes cannot be saved" : n ? "Not saved yet" : ""}</span>
    <button id="adjUndo" ${h.undo && !n ? "" : "disabled"} title="Undo the last saved change">Undo</button><button id="adjRedo" ${h.redo && !n ? "" : "disabled"}>Redo</button></div>`;
}
function render() {
  if (view.follow && curScene() >= 0) view.scene = curScene();
  view.scene = Math.min(view.scene, S.draft.scenes.length - 1);
  const head = `<div class="adj-head"><select id="adjScope"><option value="video"${view.scope === "video" ? " selected" : ""}>Whole video</option>${S.draft.scenes.map((s, i) => `<option value="${i}"${view.scope === "scene" && i === view.scene ? " selected" : ""}>Scene ${i + 1} · ${esc(s.id)}</option>`).join("")}</select>
    <label class="hint" title="Show the scene under the playhead"><input type="checkbox" id="adjFollow" ${view.follow ? "checked" : ""}> follow playhead</label></div>
    <div class="hint">Change a value and the player shows it straight away. Nothing is written until you press Save.</div>`;
  return head + '<div id="adjBody">' + (view.scope === "video" ? renderVideo() : renderScene()) + "</div>" + saveBar();
}
function parse(el) {
  const t = el.dataset.t;
  if (t === "bool") return { ok: true, v: el.checked };
  if (t === "num") { const v = el.value.trim() === "" ? NaN : Number(el.value); return { ok: Number.isFinite(v), v }; }
  return { ok: true, v: el.value };
}
function refreshMarks(root) {
  root.querySelectorAll("[data-f]").forEach(el => el.classList.toggle("chg", Studio.isChanged(JSON.parse(el.dataset.f))));
  const st = root.querySelector("[data-stale]"); if (st && view.scope === "scene") { const stale = voiceStale(view.scene); st.hidden = !stale; if (stale) st.textContent = "The words no longer match the recorded voice. The picture updates now; the voice needs a new take from Claude."; }
  const old = root.querySelector("#savebar"); if (old) { old.outerHTML = saveBar(); bindBar(root); }
}
function bindBar(root) {
  root.querySelector("#adjSave").onclick = () => Studio.save();
  root.querySelector("#adjDiscard").onclick = () => { Studio.discard(); Studio.renderPanel(); };
  root.querySelector("#adjUndo").onclick = () => Studio.undo();
  root.querySelector("#adjRedo").onclick = () => Studio.redo();
}
function bind(root) {
  root.addEventListener("toggle", e => { const g = e.target.dataset?.g; if (g) e.target.open ? view.open.add(g) : view.open.delete(g); }, true);
  root.querySelector("#adjScope").onchange = e => { if (e.target.value === "video") view.scope = "video"; else { view.scope = "scene"; view.scene = Number(e.target.value); view.follow = false; seek(S.timing.scenes[view.scene].t0 + 0.4); } Studio.renderPanel(); };
  root.querySelector("#adjFollow").onchange = e => { view.follow = e.target.checked; if (view.follow) { view.scope = "scene"; Studio.renderPanel(); } };
  const onInput = e => {
    const el = e.target; if (!el.dataset?.p) return;
    const path = JSON.parse(el.dataset.p), r = parse(el), wrap = el.closest(".fld");
    wrap?.classList.toggle("bad", !r.ok); if (!r.ok) return;
    if (el.type === "color" || (el.type === "text" && wrap?.querySelector('input[type=color]'))) wrap.querySelectorAll("input").forEach(o => { if (o !== el && /^#[0-9a-f]{6}$/i.test(r.v)) o.value = r.v; });
    Studio.edit(path, r.v);
  };
  root.addEventListener("input", onInput); root.addEventListener("change", e => { if (e.target.tagName === "SELECT" && e.target.dataset.p) onInput(e); });
  root.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.rst) { Studio.resetField(JSON.parse(b.dataset.rst)); Studio.renderPanel(); }
    if (b.dataset.show) { const t = wordTime(view.scene, b.dataset.show); setPlay(false); seek(t != null ? t + 0.5 : S.timing.scenes[view.scene].t0 + 0.5); }
  });
  root.querySelectorAll("select[data-add]").forEach(sel => (sel.onchange = () => { if (!sel.value) return; Studio.edit([...JSON.parse(sel.dataset.add), sel.value], ADDABLE[sel.dataset.parent][sel.value]); Studio.renderPanel(); }));
  bindBar(root);
}
const typing = () => { const a = document.activeElement; return a && $("panel").contains(a) && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName); };

Studio.panel({
  id: "adjust", title: "Adjust", render, bind,
  badge: () => S.pending.size || null,
  onScene(root, i) { if (view.follow && view.scope === "scene" && i >= 0 && i !== view.scene && !typing()) Studio.renderPanel(); },
});
Studio.on("draft", () => { Studio.renderTabs(); if (S.tab === "adjust") refreshMarks($("panel")); });
Studio.on("saved", () => { if (S.tab === "adjust" && !typing()) Studio.renderPanel(); });
Studio.adjust = { FIELD, GROUP, ADDABLE, view };
