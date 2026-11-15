// Backend for the web-hosted Studio (a private claude.ai page): the day's files are published with the page,
// and everything you save lives in the page's shared database (the `db` capability).
//   edits/<day>    {applied:[{at,label,ops:[{path,value}]}], redo:[...]}   your saved adjustments, newest last
//   notes-<day>/*  one document per frame note
//   status/<day>   what is being worked on (same shape as status.json); Claude writes it
// The published script.json stays as delivered. What you see is that file with your saved edits laid over it.
// Claude reads the same documents, applies them to the real script, rebuilds, and republishes.
const getPath = (o, p) => p.reduce((a, k) => (a == null ? undefined : a[k]), o);
const clone = o => JSON.parse(JSON.stringify(o));
function setIn(root, p, value) {
  let o = root; for (const k of p.slice(0, -1)) { if (o == null || typeof o !== "object") return false; o = o[k]; }
  if (o == null || typeof o !== "object") return false;
  const k = p[p.length - 1]; if (value === undefined) delete o[k]; else o[k] = value; return true;
}
const lay = (base, applied) => { const s = clone(base); for (const e of applied) for (const op of e.ops) setIn(s, op.path, op.value); return s; };
const FILES = ["script.json", "timing.json", "voice.wav", "music.wav", "sfx.wav", "narration.txt", "intraday.json", "data-check.md"];
const slug = s => String(s).replace(/[^A-Za-z0-9_.~:@+-]/g, "_");
const say = (e, m) => new Error(m || (e && (e.message || e.code)) || "Could not save");

let dbp = null, manifest = null;
const db = () => (dbp ||= (async () => { const c = window.claude; const d = c && c.use ? await c.use("db") : null; if (!d) throw new Error("Saving is not available in this view. Open the page signed in to claude.ai."); return d; })());
const cache = new Map();                       // day -> {edits, status, notes}
const st = day => { let s = cache.get(day); if (!s) cache.set(day, (s = { edits: { applied: [], redo: [] }, status: null, notes: [], listeners: new Set(), unsub: [], base: null })); return s; };
const base = async (day, self) => (st(day).base ||= fetch(self.fileUrl(day, "script.json")).then(r => r.json()));

export const backend = {
  mode: "web", canReset: false,
  async manifest() { return (manifest ||= await (await fetch("manifest.json")).json()); },
  async days() { const m = await this.manifest(); return { days: m.days.map(x => x.name), default: m.default }; },
  async info(day) {
    const m = await this.manifest(), x = m.days.find(v => v.name === day); if (!x) throw new Error("Unknown day");
    await this.watch(day);
    const s = st(day);
    return { name: day, scenes: m.scenes, defaultScene: m.defaultScene, files: x.files, status: s.status, history: { undo: s.edits.applied.length, redo: s.edits.redo.length }, notes: s.notes.length, readOnly: false, version: m.version };
  },
  fileUrl: (day, f) => "days/" + encodeURIComponent(day) + "/" + f,
  async readJson(day, f) {
    const r = await fetch(this.fileUrl(day, f)); if (!r.ok) throw new Error(f + " not found"); const j = await r.json();
    return f === "script.json" ? lay(j, st(day).edits.applied) : j;
  },
  sceneUrl: scene => "t/" + scene,

  /** Start listening to this day's documents once; keeps the cache fresh and tells subscribers. */
  async watch(day) {
    const s = st(day); if (s.watching) return s.watching;
    return (s.watching = (async () => {
      const d = await db(), first = { e: false, s: false, n: false };
      await new Promise(done => {
        const ready = k => { first[k] = true; if (first.e && first.s && first.n) done(); };
        setTimeout(done, 6000);       // do not wait forever if the store is slow
        s.unsub.push(d.doc("edits/" + slug(day)).onSnapshot(snap => { const v = snap.exists ? snap.data() : null; s.edits = { applied: v?.applied || [], redo: v?.redo || [] }; ready("e"); s.listeners.forEach(f => f({ names: ["script.json"] })); }, () => ready("e")));
        s.unsub.push(d.doc("status/" + slug(day)).onSnapshot(snap => { s.status = snap.exists ? snap.data() : null; ready("s"); s.listeners.forEach(f => f({ names: ["status.json"] })); }, () => ready("s")));
        s.unsub.push(d.collection("notes-" + slug(day)).onSnapshot(snap => { s.notes = snap.docs.map(x => x.data()).sort((a, b) => a.t - b.t); ready("n"); s.listeners.forEach(f => f({ names: ["notes.json"] })); }, () => ready("n")));
      });
    })());
  },
  subscribe(day, cb) {
    const s = st(day); s.listeners.add(cb); cb({ conn: "live" });
    return () => s.listeners.delete(cb);
  },

  async _save(day, edits) { const d = await db(); try { await d.doc("edits/" + slug(day)).set(edits); } catch (e) { throw say(e); } const s = st(day); s.edits = edits; return { undo: edits.applied.length, redo: edits.redo.length }; },
  async editScript(day, ops, label) {
    await this.watch(day); const s = st(day), b = await base(day, this);
    const cur = lay(b, s.edits.applied);                      // refuse anything that is not a single existing value
    for (const op of ops) {
      const p = op.path, parent = getPath(cur, p.slice(0, -1)), key = p[p.length - 1];
      if (parent == null || typeof parent !== "object") throw new Error("Nothing at " + p.join("."));
      const had = Object.prototype.hasOwnProperty.call(parent, key);
      if (had && typeof parent[key] === "object" && parent[key] !== null) throw new Error("Only single values can be changed");
      if (op.value !== undefined && typeof op.value === "object" && op.value !== null) throw new Error("Only single values can be saved");
      if (Array.isArray(parent) && !had) throw new Error("Nothing at " + p.join("."));
    }
    return this._save(day, { applied: [...s.edits.applied, { at: new Date().toISOString(), label: String(label || "Edit").slice(0, 120), ops: ops.map(o => ({ path: o.path, value: o.value === undefined ? null : o.value })) }].slice(-100), redo: [] });
  },
  async undo(day) { const s = st(day), e = s.edits.applied[s.edits.applied.length - 1]; if (!e) throw new Error("Nothing to undo"); const r = await this._save(day, { applied: s.edits.applied.slice(0, -1), redo: [...s.edits.redo, e] }); return { ...r, label: e.label }; },
  async redo(day) { const s = st(day), e = s.edits.redo[s.edits.redo.length - 1]; if (!e) throw new Error("Nothing to redo"); const r = await this._save(day, { applied: [...s.edits.applied, e], redo: s.edits.redo.slice(0, -1) }); return { ...r, label: e.label }; },
  async changes(day) {
    const s = st(day), b = await base(day, this), cur = lay(b, s.edits.applied), out = [];
    const walk = (a, c, p) => { if (a === null || c === null || typeof a !== "object" || typeof c !== "object") { if (JSON.stringify(a) !== JSON.stringify(c)) out.push({ path: p, from: a, to: c }); return; } for (const k of new Set([...Object.keys(a), ...Object.keys(c)])) walk(a[k], c[k], [...p, Array.isArray(a) ? Number(k) : k]); };
    walk(b, cur, []); return out;
  },
  async resetChanges() { throw new Error("Claude clears this after rebuilding the video"); },

  async notes(day) { await this.watch(day); return st(day).notes; },
  async changeNote(day, action, note = {}) {
    const d = await db(), col = d.collection("notes-" + slug(day)), now = new Date().toISOString(), s = st(day);
    try {
      if (action === "add") {
        if (!String(note.text || "").trim()) throw new Error("Write the note first");
        const t = Number(note.t); if (!Number.isFinite(t) || t < 0) throw new Error("Bad time");
        const id = now.replace(/\D/g, "").slice(2, 17) + Math.random().toString(36).slice(2, 5);
        await col.doc(id).set({ id, t: Math.round(t * 100) / 100, scene: String(note.scene || "").slice(0, 80), text: String(note.text).slice(0, 2000), done: false, created: now });
      } else {
        const n = s.notes.find(x => x.id === note.id); if (!n) throw new Error("Note not found");
        if (action === "update") await col.doc(n.id).set({ ...n, ...(note.text !== undefined ? { text: String(note.text).slice(0, 2000) } : {}), ...(note.done !== undefined ? { done: !!note.done } : {}), updated: now });
        else if (action === "delete") await col.doc(n.id).delete();
        else throw new Error("Unknown action");
      }
    } catch (e) { throw say(e); }
    await new Promise(r => setTimeout(r, 150));     // the live listener delivers the new list
    return s.notes;
  },
};
