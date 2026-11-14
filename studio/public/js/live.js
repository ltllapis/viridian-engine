// Live updates: the server announces file changes; we refresh only what is needed and keep the place.
import { $, S, Studio } from "./core.js";
import { load, setPlay } from "./player.js";
let flashT;
export function connect() {
  const es = new EventSource("/events");
  es.onopen = () => { $("conn").className = "ok"; $("conn").lastChild.textContent = "live"; };
  es.onerror = () => { $("conn").className = ""; $("conn").lastChild.textContent = "reconnecting…"; };
  es.onmessage = async ev => {
    const m = JSON.parse(ev.data);
    if (m.type === "hello") { if (Studio.version && m.version !== Studio.version) location.reload(); return; }   // Studio itself was updated
    if (m.type !== "change") return;
    const mine = m.changes.filter(c => c.scope === "scene" || c.day === S.day); if (!mine.length) return;
    const names = [...new Set(mine.map(c => c.file))];
    const quiet = new Set(["status.json", "notes.json"]);
    const real = names.filter(n => !quiet.has(n));
    for (const n of real) Studio.log(n + " changed");
    if (real.length) { $("flash").textContent = "Updated " + real.join(", "); clearTimeout(flashT); flashT = setTimeout(() => ($("flash").textContent = ""), 4000); }
    Studio.emit("files", { names });
    if (!real.length) { S.info = await Studio.api(Studio.dayApi()); if (names.includes("status.json")) Studio.emit("status"); return; }
    if (real.length === 1 && real[0] === "script.json") {   // our own save or undo already showed this: skip the reload
      try { const disk = await fetch(Studio.dayFile("script.json"), { cache: "no-store" }).then(r => r.json()); if (JSON.stringify(disk) === JSON.stringify(S.script)) { S.info = await Studio.api(Studio.dayApi()); return; } } catch {}
    }
    const was = S.playing; setPlay(false); await load(); if (was) setTimeout(() => setPlay(true), 300);
  };
}
