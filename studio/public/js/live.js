// Live updates: the backend announces what changed; we refresh only what is needed and keep the place.
import { $, S, Studio } from "./core.js";
import { load, setPlay } from "./player.js";
let flashT, stop = null;
/** (Re)start listening for the current day. */
export function connect() {
  stop && stop();
  stop = Studio.backend.subscribe(S.day, async m => {
    if (m.conn) { $("conn").className = m.conn === "live" ? "ok" : ""; $("conn").lastChild.textContent = m.conn; return; }
    if (!S.timing) return;
    const names = m.names, quiet = new Set(["status.json", "notes.json"]);
    const real = names.filter(n => !quiet.has(n));
    if (real.length && !(real.length === 1 && real[0] === "script.json" && S.pending.size === 0 && await sameAsDisk())) {
      for (const n of real) Studio.log(n + " changed");
      $("flash").textContent = "Updated " + real.join(", "); clearTimeout(flashT); flashT = setTimeout(() => ($("flash").textContent = ""), 4000);
    }
    Studio.emit("files", { names });
    if (!real.length) { S.info = await Studio.backend.info(S.day); if (names.includes("status.json")) Studio.emit("status"); return; }
    if (real.length === 1 && real[0] === "script.json" && await sameAsDisk()) { S.info = await Studio.backend.info(S.day); return; }   // our own save or undo already showed this
    const was = S.playing; setPlay(false); await load(); if (was) setTimeout(() => setPlay(true), 300);
  }, { version: Studio.version });
}
async function sameAsDisk() { try { return JSON.stringify(await Studio.backend.readJson(S.day, "script.json")) === JSON.stringify(S.script); } catch { return false; } }
