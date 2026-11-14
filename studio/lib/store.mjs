// Everything the Studio writes goes through this file, so there is one place to keep it safe.
// - script.json edits are small "set" operations on existing values, written atomically, with undo/redo.
// - notes.json holds frame notes.
// - <day>/.studio/ holds Studio's own working files (history, baseline). It is not part of the video.
import fs from "node:fs";
import path from "node:path";

const MAX_HISTORY = 200;
const isPrim = v => v === null || ["string", "number", "boolean"].includes(typeof v);
const clone = o => JSON.parse(JSON.stringify(o));

export function readJson(f, fallback = null) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } }
export function writeJsonAtomic(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, f);
}
const sdir = day => path.join(day, ".studio");
const histFile = day => path.join(sdir(day), "history.json");
const baseFile = day => path.join(sdir(day), "baseline.json");
const loadHist = day => readJson(histFile(day), { undo: [], redo: [] });

class StoreError extends Error { constructor(m, code = 400) { super(m); this.code = code; } }
export { StoreError };

function validPath(p) {
  return Array.isArray(p) && p.length > 0 && p.length < 20 && p.every(k => (typeof k === "string" && k.length < 80 && !["__proto__", "constructor", "prototype"].includes(k)) || (Number.isInteger(k) && k >= 0));
}
// Walk to the parent of the last key. The parent must already exist: Studio adjusts, it does not restructure.
function parentOf(root, p) {
  let o = root;
  for (const k of p.slice(0, -1)) {
    if (o === null || typeof o !== "object" || !Object.prototype.hasOwnProperty.call(o, k)) throw new StoreError("Nothing at " + p.join("."));
    o = o[k];
  }
  if (o === null || typeof o !== "object") throw new StoreError("Nothing at " + p.join("."));
  return o;
}
function applyOne(root, op) {
  if (!op || op.op !== "set" || !validPath(op.path)) throw new StoreError("Bad edit");
  const parent = parentOf(root, op.path), key = op.path[op.path.length - 1];
  const had = Object.prototype.hasOwnProperty.call(parent, key);
  if (Array.isArray(parent) && !had) throw new StoreError("Nothing at " + op.path.join("."));
  const old = had ? parent[key] : undefined;
  if (had && !isPrim(old)) throw new StoreError("Only single values can be changed (" + op.path.join(".") + ")");
  if (op.value === undefined) { if (Array.isArray(parent)) throw new StoreError("Cannot remove a list item"); delete parent[key]; }
  else { if (!isPrim(op.value)) throw new StoreError("Only single values can be saved"); if (typeof op.value === "number" && !Number.isFinite(op.value)) throw new StoreError("Bad number"); parent[key] = op.value; }
  return { op: "set", path: op.path, value: old };       // the inverse edit
}

export function historyInfo(day) { const h = loadHist(day); return { undo: h.undo.length, redo: h.redo.length, lastLabel: h.undo.length ? h.undo[h.undo.length - 1].label : null }; }

/** Apply edits to script.json. Returns the new history counts. All edits apply or none do. */
export function editScript(day, ops, label = "Edit") {
  if (!Array.isArray(ops) || !ops.length || ops.length > 500) throw new StoreError("No edits");
  const f = path.join(day, "script.json");
  const script = readJson(f); if (!script) throw new StoreError("script.json is missing or not valid JSON", 409);
  if (!fs.existsSync(baseFile(day))) writeJsonAtomic(baseFile(day), script);     // remember what was delivered, for the hand-off summary
  const work = clone(script), inverse = [];
  for (const op of ops) inverse.unshift(applyOne(work, op));
  writeJsonAtomic(f, work);
  const h = loadHist(day);
  h.undo.push({ at: new Date().toISOString(), label: String(label).slice(0, 120), ops: clone(ops), inverse });
  h.undo = h.undo.slice(-MAX_HISTORY); h.redo = [];
  writeJsonAtomic(histFile(day), h);
  return historyInfo(day);
}
function step(day, from, to) {
  const h = loadHist(day); const e = h[from].pop(); if (!e) throw new StoreError("Nothing to " + from, 409);
  const f = path.join(day, "script.json"); const script = readJson(f); if (!script) throw new StoreError("script.json is missing", 409);
  const use = from === "undo" ? e.inverse : e.ops;
  try { for (const op of use) applyOne(script, op); }
  catch (err) { throw new StoreError("The script changed underneath, so this step no longer fits: " + err.message, 409); }
  writeJsonAtomic(f, script); h[to].push(e); writeJsonAtomic(histFile(day), h);
  return { ...historyInfo(day), label: e.label };
}
export const undo = day => step(day, "undo", "redo");
export const redo = day => step(day, "redo", "undo");

/** What changed since the script was delivered: a flat list of {path, from, to}. */
export function changes(day) {
  const base = readJson(baseFile(day)), cur = readJson(path.join(day, "script.json"));
  const out = []; if (!base || !cur) return out;
  const walk = (a, b, p) => {
    if (isPrim(a) || isPrim(b) || a === undefined || b === undefined) { if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: p, from: a, to: b }); return; }
    const keys = Array.isArray(a) && Array.isArray(b) ? [...Array(Math.max(a.length, b.length)).keys()] : [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) walk(a[k], b[k], [...p, k]);
  };
  walk(base, cur, []);
  return out.slice(0, 500);
}
export function resetBaseline(day) { const cur = readJson(path.join(day, "script.json")); if (cur) writeJsonAtomic(baseFile(day), cur); return { ok: true }; }

// ---- frame notes ----
const notesFile = day => path.join(day, "notes.json");
export function listNotes(day) { const n = readJson(notesFile(day), { notes: [] }); return Array.isArray(n.notes) ? n.notes : []; }
export function changeNotes(day, action, note = {}) {
  const notes = listNotes(day); const now = new Date().toISOString();
  const text = v => String(v ?? "").slice(0, 2000);
  if (action === "add") {
    if (!text(note.text).trim()) throw new StoreError("Write the note first");
    const t = Number(note.t); if (!Number.isFinite(t) || t < 0) throw new StoreError("Bad time");
    notes.push({ id: now.replace(/\D/g, "").slice(2, 17) + Math.random().toString(36).slice(2, 5), t: Math.round(t * 100) / 100, scene: text(note.scene).slice(0, 80), text: text(note.text), done: false, created: now });
  } else {
    const n = notes.find(x => x.id === note.id); if (!n) throw new StoreError("Note not found", 404);
    if (action === "update") { if (note.text !== undefined) n.text = text(note.text); if (note.done !== undefined) n.done = !!note.done; n.updated = now; }
    else if (action === "delete") notes.splice(notes.indexOf(n), 1);
    else throw new StoreError("Unknown action");
  }
  notes.sort((a, b) => a.t - b.t);
  writeJsonAtomic(notesFile(day), { notes });
  return notes;
}
