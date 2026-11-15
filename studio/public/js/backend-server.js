// Backend for the local Studio server (node studio/server.mjs): files and edits live on your computer.
// Every backend offers the same methods, so the rest of the page never knows where it is running.
const api = async p => { const r = await fetch(p, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; };
const post = async (p, body) => {
  const r = await fetch(p, { method: "POST", headers: { "content-type": "application/json", "x-studio": "1" }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
};
const d = day => "/api/day/" + encodeURIComponent(day);

export const backend = {
  mode: "local", canReset: true,
  async days() { return api("/api/days"); },
  info: day => api(d(day)),
  fileUrl: (day, f) => "/day/" + encodeURIComponent(day) + "/" + f,
  async readJson(day, f) { const r = await fetch(this.fileUrl(day, f), { cache: "no-store" }); if (!r.ok) throw new Error(f + " not found"); return r.json(); },
  sceneUrl: scene => "/t/" + scene,
  async editScript(day, ops, label) { const r = await post(d(day) + "/script", { ops, label }); return { undo: r.undo, redo: r.redo }; },
  async undo(day) { return post(d(day) + "/undo"); },
  async redo(day) { return post(d(day) + "/redo"); },
  async notes(day) { return (await api(d(day) + "/notes")).notes; },
  async changeNote(day, action, note) { return (await post(d(day) + "/notes", { action, note })).notes; },
  async changes(day) { return (await api(d(day) + "/changes")).changes; },
  async resetChanges(day) { await post(d(day) + "/changes/reset"); },
  /** Tell me when something changes: cb({names:[...]}). Returns a function that stops listening. */
  subscribe(day, cb, { version } = {}) {
    const es = new EventSource("/events");
    es.onopen = () => cb({ conn: "live" });
    es.onerror = () => cb({ conn: "reconnecting…" });
    es.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.type === "hello") { if (version && m.version !== version) location.reload(); return; }   // Studio itself was updated
      if (m.type !== "change") return;
      const mine = m.changes.filter(c => c.scope === "scene" || c.day === day);
      if (mine.length) cb({ names: [...new Set(mine.map(c => c.file))] });
    };
    return () => es.close();
  },
};
