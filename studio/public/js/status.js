// Status strip: what is being worked on now (status.json in the day folder), plus the activity feed source.
import { $, S, Studio, esc, ago } from "./core.js";
let cur = null;
function apply(st) {
  cur = st; const el = $("strip");
  if (!st) { el.className = "idle"; $("st-task").textContent = "Nothing in progress"; $("st-detail").textContent = "The strip fills in while a build is running."; $("st-steps").innerHTML = ""; $("st-age").textContent = ""; return; }
  const fresh = Date.now() - new Date(st.updated) < 10 * 60e3;
  el.className = st.state === "working" && !fresh ? "idle" : st.state || "idle";
  $("st-task").textContent = st.task || "Working"; $("st-detail").textContent = st.detail || "";
  $("st-steps").innerHTML = (st.steps || []).map((s, i) => `<span class="step ${st.at > i + 1 ? "done" : st.at === i + 1 ? "now" : ""}">${esc(s)}</span>`).join("");
  $("st-age").textContent = ago(st.updated);
  if (st.log) { const known = new Set(S.activity.map(a => a.at)); let add = 0; for (const l of st.log.slice(-12)) if (!known.has(l.at)) { S.activity.push({ at: l.at, text: l.text }); add++; } if (add) { S.activity.sort((a, b) => (b.at < a.at ? -1 : 1)); Studio.emit("activity"); } }
}
setInterval(() => { if (cur) $("st-age").textContent = ago(cur.updated); }, 2000);
Studio.on("loaded", () => apply(S.info.status));
Studio.on("status", () => apply(S.info.status));
