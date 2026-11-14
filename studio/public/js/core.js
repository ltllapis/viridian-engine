// Studio core: shared state, a small event bus, the server calls, and the "draft" (unsaved edits).
// Every feature is a module that imports this file and registers itself; nothing else is global.
//
// Events (Studio.on(name, fn)):
//   loaded   day data (re)loaded from disk          time     playhead moved (t)
//   scene    current scene index changed (i)        draft    unsaved edits changed
//   saved    edits were written / undone / redone   notes    notes list changed
//   files    files changed on disk ({names})        status   status.json changed
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmt = s => Number(s).toFixed(1);
export const clock = s => { const m = Math.floor(s / 60); return m + ":" + (s - m * 60).toFixed(1).padStart(4, "0"); };
export const ago = ts => { if (!ts) return ""; const s = Math.max(0, (Date.now() - new Date(ts)) / 1000); return s < 5 ? "just now" : s < 60 ? Math.round(s) + " s ago" : s < 3600 ? Math.round(s / 60) + " min ago" : Math.round(s / 3600) + " h ago"; };
export const clone = o => JSON.parse(JSON.stringify(o));
export const getPath = (o, p) => p.reduce((a, k) => (a == null ? undefined : a[k]), o);
export const pathKey = p => JSON.stringify(p);
export const MOOD = { red: "#E07A6B", blue: "#7FA8E8", green: "#8FD3B6", teal: "#6FC7B5", gold: "#E8C66F", amber: "#E8C66F", purple: "#9E8AD3" };

export const S = {
  day: null, scene: null, info: null,
  script: null,          // script.json as saved on disk
  draft: null,           // script + unsaved edits: this is what the player shows
  pending: new Map(),    // pathKey -> {path, value}
  timing: null, notes: [],
  t: 0, playing: false, ready: false, caps: true, hasAudio: false,
  tab: "scenes", activity: [],
};

const handlers = {};
export const Studio = {
  state: S, panels: [], version: "",
  on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
  emit(ev, d) { (handlers[ev] || []).forEach(fn => { try { fn(d); } catch (e) { console.error("[studio]", ev, e); } }); },
  /** Add a tab. {id, title, render() -> html, bind(root)?, badge()? -> string|number|null, onShow()?} */
  panel(p) { this.panels.push(p); },
  async api(p) { const r = await fetch(p, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; },
  async post(p, body) {
    const r = await fetch(p, { method: "POST", headers: { "content-type": "application/json", "x-studio": "1" }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
  },
  dayApi: (rest = "") => "/api/day/" + encodeURIComponent(S.day) + (rest ? "/" + rest : ""),
  dayFile: f => "/day/" + encodeURIComponent(S.day) + "/" + f,
  toast(text, isErr) { const t = $("toast"); t.textContent = text; t.className = "on" + (isErr ? " err" : ""); clearTimeout(this._tt); this._tt = setTimeout(() => (t.className = ""), isErr ? 5000 : 2200); },
  log(text) { S.activity.unshift({ at: new Date().toISOString(), text }); S.activity = S.activity.slice(0, 80); this.emit("activity"); },
};
window.Studio = Studio;   // handy in the browser console, and for tests

// ---- helpers about the video ----
export const curScene = () => (S.timing ? S.timing.scenes.findIndex(s => S.t >= s.t0 - 0.05 && S.t < s.t1 - 0.05) : -1);
export const sceneAt = t => (S.timing ? S.timing.scenes.findIndex(s => t >= s.t0 - 0.05 && t < s.t1 - 0.05) : -1);
export const moodOf = i => MOOD[(S.draft?.scenes[i] || {}).mood] || "#8a93a8";
/** The words as shown on screen: "{1,500|fifteen hundred}" shows "1,500". */
export const shownWords = text => [...String(text || "").matchAll(/\{([^|}]*)\|([^}]*)\}|(\S+)/g)].map(m => m[3] ?? m[1]);
/** True when a scene's narration no longer matches the recorded voice timing. */
export function voiceStale(i) {
  const sc = S.draft?.scenes[i], tm = S.timing?.scenes[i]; if (!sc || !tm || !tm.words) return false;
  return shownWords(sc.text).join(" ") !== tm.words.map(w => w.w).join(" ");
}
/** Time of the first word in scene i that matches `word` (used by "show me" buttons). */
export function wordTime(i, word) {
  const tm = S.timing?.scenes[i]; if (!tm || !word) return null;
  const norm = s => String(s).toLowerCase().replace(/[^\w&%]/g, "");
  const w = (tm.words || []).find(x => norm(x.w) === norm(word)) || (tm.words || []).find(x => norm(x.w).includes(norm(word)));
  return w ? w.t0 : null;
}
/** Plain-words name for a path inside script.json, e.g. Scene 2 (stack) › callouts 1 › delta */
export function pathLabel(p) {
  const out = []; let i = 0;
  if (p[0] === "scenes" && Number.isInteger(p[1])) { const sc = (S.draft || S.script)?.scenes[p[1]]; out.push(`Scene ${p[1] + 1}${sc ? ` (${sc.id})` : ""}`); i = 2; }
  for (; i < p.length; i++) { if (Number.isInteger(p[i])) out[out.length - 1] += " " + (p[i] + 1); else out.push(p[i]); }
  return out.join(" › ");
}

// ---- draft: unsaved edits layered over the saved script ----
function setIn(root, p, value) {
  let o = root; for (const k of p.slice(0, -1)) { if (o == null || typeof o !== "object") return false; o = o[k]; }
  if (o == null || typeof o !== "object") return false;
  const k = p[p.length - 1]; if (value === undefined) delete o[k]; else o[k] = value; return true;
}
export function rebuildDraft() {
  S.draft = clone(S.script);
  for (const [key, e] of [...S.pending]) {
    if (JSON.stringify(getPath(S.script, e.path)) === JSON.stringify(e.value) || !setIn(S.draft, e.path, e.value)) S.pending.delete(key);
  }
}
/** Change one value in the draft. The player shows it at once; nothing is written until save(). */
Studio.edit = (path, value) => {
  const saved = getPath(S.script, path);
  if (JSON.stringify(saved) === JSON.stringify(value)) S.pending.delete(pathKey(path)); else S.pending.set(pathKey(path), { path, value });
  setIn(S.draft, path, value);
  Studio.emit("draft", { path });
};
Studio.isChanged = path => S.pending.has(pathKey(path));
Studio.resetField = path => Studio.edit(path, getPath(S.script, path));
Studio.discard = () => { S.pending.clear(); rebuildDraft(); Studio.emit("draft", {}); };
Studio.save = async () => {
  if (!S.pending.size) return;
  const ops = [...S.pending.values()].map(e => ({ op: "set", path: e.path, value: e.value }));
  const label = ops.length === 1 ? pathLabel(ops[0].path) : ops.length + " changes";
  try {
    const r = await Studio.post(Studio.dayApi("script"), { ops, label });
    S.script = clone(S.draft); S.pending.clear(); S.info.history = { undo: r.undo, redo: r.redo };
    Studio.log("Saved: " + label); Studio.toast("Saved"); Studio.emit("draft", { noRender: true }); Studio.emit("saved");
  } catch (e) { Studio.toast("Could not save: " + e.message, true); }
};
async function stepHistory(which) {
  if (S.pending.size) return Studio.toast("Save or discard your unsaved changes first", true);
  try { const r = await Studio.post(Studio.dayApi(which)); S.info.history = { undo: r.undo, redo: r.redo }; Studio.log((which === "undo" ? "Undid: " : "Redid: ") + r.label); Studio.toast(which === "undo" ? "Undone" : "Redone"); Studio.emit("saved", { reload: true }); }
  catch (e) { Studio.toast(e.message, true); }
}
Studio.undo = () => stepHistory("undo");
Studio.redo = () => stepHistory("redo");
