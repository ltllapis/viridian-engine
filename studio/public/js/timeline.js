// The scene timeline: blocks per scene, voice waveform, playhead, scrubbing, and marker pins other modules can add.
import { $, S, Studio, esc, fmt, moodOf, curScene, voiceStale } from "./core.js";
import { seek } from "./player.js";

const layers = new Map();   // name -> [{t, title, cls, onClick}]
function build() {
  const D = S.timing.duration;
  $("blocks").innerHTML = S.timing.scenes.map((s, i) => `<div class="blk" data-i="${i}" style="--c:${moodOf(i)};left:${(s.t0 / D) * 100}%;width:${((s.t1 - s.t0) / D) * 100}%"><b>${i + 1}. ${esc(s.id)}</b><span>${esc(S.draft.scenes[i]?.visual?.type || "")} · ${fmt(s.t1 - s.t0)}s</span></div>`).join("");
  let tk = ""; const step = D > 120 ? 20 : D > 60 ? 10 : 5; for (let x = 0; x <= D; x += step) tk += `<span style="left:${(x / D) * 100}%">${x}s</span>`; $("ticks").innerHTML = tk;
  flags(); marks(); wave();
}
function flags() {
  const edited = new Set([...S.pending.values()].filter(e => e.path[0] === "scenes").map(e => e.path[1]));
  document.querySelectorAll(".blk").forEach(el => { const i = Number(el.dataset.i); el.style.setProperty("--c", moodOf(i)); el.classList.toggle("stale", voiceStale(i)); el.classList.toggle("edited", edited.has(i)); el.classList.toggle("cur", i === curScene()); });
}
function marks() {
  if (!S.timing) return; const D = S.timing.duration, box = $("marks"); box.innerHTML = "";
  for (const list of layers.values()) for (const m of list) {
    const el = document.createElement("div"); el.className = "mk " + (m.cls || ""); el.style.left = (m.t / D) * 100 + "%"; el.title = m.title || "";
    el.addEventListener("pointerdown", e => { e.stopPropagation(); seek(m.t); m.onClick && m.onClick(m); }); box.appendChild(el);
  }
}
let waveKey = "";
async function wave() {
  const cv = $("wave"), c = cv.getContext("2d"), key = S.day + ":" + (S.info.files["voice.wav"] || 0) + ":" + cv.clientWidth;
  if (key === waveKey) return; waveKey = key;
  cv.width = cv.clientWidth * 2; cv.height = cv.clientHeight * 2; c.clearRect(0, 0, cv.width, cv.height);
  if (!S.hasAudio) return;
  try {
    const buf = await (await fetch(Studio.dayFile("voice.wav") + "?v=" + S.info.files["voice.wav"])).arrayBuffer();
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext; const au = await new AC(1, 1, 22050).decodeAudioData(buf);
    if (key !== waveKey) return;
    const d = au.getChannelData(0), W = cv.width, H = cv.height, per = Math.floor(d.length / W); c.fillStyle = "#cfd5e2";
    for (let x = 0; x < W; x += 2) { let mx = 0; for (let k = 0; k < per; k += 8) mx = Math.max(mx, Math.abs(d[x * per + k] || 0)); const h = Math.min(1, mx * 1.6) * H * 0.5; c.fillRect(x, H / 2 - h / 2, 1.4, Math.max(1, h)); }
  } catch {}
}
const tl = $("tl"); let drag = false;
const at = ev => { const r = tl.getBoundingClientRect(); seek(((ev.clientX - r.left) / r.width) * S.timing.duration); };
tl.addEventListener("pointerdown", e => { if (!S.timing) return; drag = true; tl.setPointerCapture(e.pointerId); at(e); });
tl.addEventListener("pointermove", e => { if (drag) at(e); });
tl.addEventListener("pointerup", () => (drag = false)); tl.addEventListener("pointercancel", () => (drag = false));
addEventListener("resize", () => S.timing && wave());

Studio.on("loaded", build);
Studio.on("draft", flags);
Studio.on("scene", flags);
Studio.on("time", t => { $("head").style.left = (t / S.timing.duration) * 100 + "%"; });
/** Put pins on the timeline. Call again with the same name to replace them. */
Studio.setMarkers = (name, list) => { layers.set(name, list); marks(); };
