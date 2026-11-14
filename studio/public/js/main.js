// Start-up and wiring. Features live in their own modules; each registers itself with Studio (see core.js).
import { $, S, Studio } from "./core.js";
import { load, seek, setPlay, jump, startLoop, reinit } from "./player.js";
import "./timeline.js";
import "./status.js";
import "./panels/basic.js";      // Scenes, Script, Activity
import "./panels/adjust.js";
import "./panels/notes.js";
import "./handoff.js";
import { connect } from "./live.js";

// ---- tabs ----
const ORDER = ["scenes", "adjust", "notes", "script", "activity"];   // tabs not listed here go last, in the order they registered
Studio.panels.sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));
const panelOf = id => Studio.panels.find(p => p.id === id);
Studio.renderTabs = () => {
  $("tabs").innerHTML = Studio.panels.map(p => { const b = p.badge && S.timing ? p.badge() : null; return `<button role="tab" data-id="${p.id}" class="${S.tab === p.id ? "on" : ""}">${p.title}${b ? `<span class="badge">${b}</span>` : ""}</button>`; }).join("");
  $("tabs").querySelectorAll("button").forEach(b => (b.onclick = () => Studio.showTab(b.dataset.id)));
};
Studio.renderPanel = () => {
  if (!S.timing) return;
  const p = panelOf(S.tab), old = $("panel"), top = old.scrollTop;
  const root = old.cloneNode(false); old.replaceWith(root);      // a fresh node drops the previous panel's listeners
  root.innerHTML = p.render(); p.bind && p.bind(root); root.scrollTop = top;
};
Studio.showTab = id => { if (S.tab !== id) { S.tab = id; try { localStorage.setItem("studio.tab", id); } catch {} $("panel").scrollTop = 0; } Studio.renderTabs(); Studio.renderPanel(); };
Studio.on("loaded", () => { Studio.renderTabs(); Studio.renderPanel(); });
Studio.on("scene", i => { const p = panelOf(S.tab); if (p.onScene === "rerender") Studio.renderPanel(); else if (p.onScene) p.onScene($("panel"), i); });
Studio.on("time", t => { const p = panelOf(S.tab); p.onTime && p.onTime($("panel"), t); });
Studio.on("draft", () => { const n = S.pending.size; $("unsaved").textContent = n ? `${n} unsaved change${n > 1 ? "s" : ""}` : ""; });

// ---- transport ----
$("play").onclick = () => setPlay(!S.playing); $("back").onclick = () => seek(S.t - 1); $("fwd").onclick = () => seek(S.t + 1);
$("prev").onclick = () => jump(-1); $("next").onclick = () => jump(1);
$("speed").onchange = () => { if (S.playing) { setPlay(false); setPlay(true); } };
$("sg").onclick = () => { $("guides").classList.toggle("on"); $("sg").classList.toggle("on"); };
$("cap").onclick = () => { S.caps = !S.caps; $("cap").classList.toggle("on", S.caps); try { Studio.frame().contentDocument.body.classList.toggle("captions", S.caps); } catch {} };
$("daySel").onchange = async () => {
  if (S.pending.size && !confirm("You have unsaved changes on this day. Leave them behind?")) { $("daySel").value = S.day; return; }
  S.pending.clear(); S.day = $("daySel").value; try { localStorage.setItem("studio.day", S.day); } catch {} setPlay(false); S.activity = []; await load(0);
};
$("sceneSel").onchange = () => { S.scene = $("sceneSel").value; reinit(); };
addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); Studio.save(); return; }
  if (["SELECT", "INPUT", "TEXTAREA"].includes(e.target.tagName) || $("dlg").open || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.code === "Space") { e.preventDefault(); setPlay(!S.playing); }
  else if (e.key === "ArrowLeft") seek(S.t - (e.shiftKey ? 0.1 : 1)); else if (e.key === "ArrowRight") seek(S.t + (e.shiftKey ? 0.1 : 1));
  else if (e.key === "[") jump(-1); else if (e.key === "]") jump(1);
  else if (k === "s") $("sg").click(); else if (k === "c") $("cap").click(); else if (k === "n") { e.preventDefault(); Studio.newNote(); }
});
addEventListener("beforeunload", e => { if (S.pending.size) { e.preventDefault(); e.returnValue = ""; } });

// ---- go ----
(async () => {
  try { const t = localStorage.getItem("studio.tab"); if (t && panelOf(t)) S.tab = t; } catch {}
  Studio.renderTabs();
  try {
    const { days, default: dflt } = await Studio.api("/api/days");
    if (!days.length) { $("msg").textContent = "No days found. Put a day folder with script.json under examples/ or days/."; return; }
    $("daySel").innerHTML = days.map(d => `<option>${d}</option>`).join("");
    let want = new URLSearchParams(location.search).get("day"); try { want = want || localStorage.getItem("studio.day"); } catch {}
    S.day = days.includes(want) ? want : dflt; $("daySel").value = S.day;
    await load(0);
  } catch (e) { $("msg").textContent = "Studio could not start: " + e.message; }
  connect(); startLoop();
})();
