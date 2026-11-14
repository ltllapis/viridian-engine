// The three read-only panels: Scenes, Script, Activity.
import { $, S, Studio, esc, ago, moodOf, curScene, voiceStale } from "../core.js";
import { seek } from "../player.js";

Studio.panel({
  id: "scenes", title: "Scenes",
  render: () => S.timing.scenes.map((s, i) => `<div class="sc${i === curScene() ? " cur" : ""}" data-i="${i}" style="--c:${moodOf(i)}"><span>${i + 1}. ${esc(s.id)}${voiceStale(i) ? ' <span class="warn">· needs new voice</span>' : ""}</span><small>${s.t0.toFixed(1)}s</small></div>`).join(""),
  bind(root) { root.querySelectorAll(".sc").forEach(el => (el.onclick = () => seek(S.timing.scenes[Number(el.dataset.i)].t0 + 0.3))); },
  onScene(root, i) { root.querySelectorAll(".sc").forEach(el => el.classList.toggle("cur", Number(el.dataset.i) === i)); root.querySelector(".sc.cur")?.scrollIntoView({ block: "nearest" }); },
});

Studio.panel({
  id: "script", title: "Script",
  render() {
    const i = curScene(); if (i < 0) return '<div class="hint">Press play or pick a scene.</div>';
    const sc = S.draft.scenes[i], tm = S.timing.scenes[i];
    return `<div class="kv">Scene ${i + 1} · ${esc(sc.id)} · ${esc(sc.visual?.type || "")}</div>
      <div class="words">${(tm.words || []).map((w, k) => `<span class="w" data-k="${k}">${esc(w.w)}</span> `).join("")}</div>
      <div class="kv">Narration text</div><div>${esc(sc.text || "")}</div>${voiceStale(i) ? '<div class="warn">This text no longer matches the recorded voice.</div>' : ""}
      <div class="kv">Scene data</div><pre>${esc(JSON.stringify(sc.visual, (k, v) => (Array.isArray(v) && v.length > 8 ? `[${v.length} values]` : v), 1))}</pre>`;
  },
  bind(root) { const i = curScene(); root.querySelectorAll(".w").forEach(el => (el.onclick = () => seek(S.timing.scenes[i].words[Number(el.dataset.k)].t0))); },
  onScene: "rerender",
  onTime(root, t) { const i = curScene(); if (i < 0) return; root.querySelectorAll(".w").forEach(el => { const w = S.timing.scenes[i].words[Number(el.dataset.k)]; if (w) el.className = "w" + (t >= w.t0 && t < w.t1 + 0.05 ? " on" : t >= w.t1 ? " past" : ""); }); },
});

Studio.panel({
  id: "activity", title: "Activity",
  render: () => '<div class="log">' + (S.activity.length ? S.activity.map(a => `<div><time>${ago(a.at)}</time>${esc(a.text)}</div>`).join("") : '<div class="hint">File changes, saves and status updates show up here.</div>') + "</div>",
});
Studio.on("activity", () => { if (S.tab === "activity") Studio.renderPanel(); });
