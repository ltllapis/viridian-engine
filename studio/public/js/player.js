// The player: loads a day, runs the scene page in an iframe, keeps audio in sync, draws each frame.
import { $, S, Studio, fmt, curScene, rebuildDraft } from "./core.js";

const frames = [$("f"), $("f2")], A = $("a"), Mu = $("m"), Sx = $("x");
let F = frames[0];   // the frame on show; the other one is where the next version loads
let clockT = 0, clockAt = 0, lastScene = -2, initSeq = 0;
const say = m => ($("msg").textContent = m || "");

/** Load the day from disk. Unsaved edits are kept and re-applied where they still fit. */
export async function load(keepT) {
  say("");
  try {
    S.info = await Studio.api(Studio.dayApi());
    Studio.version = S.info.version; $("ver").textContent = "v" + S.info.version;
    S.scene = S.scene && S.info.scenes.includes(S.scene) ? S.scene : S.info.defaultScene;
    $("sceneSel").innerHTML = S.info.scenes.map(s => `<option>${s}</option>`).join(""); $("sceneSel").value = S.scene;
    const get = f => fetch(Studio.dayFile(f), { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(f + " not found"); return r.json(); });
    [S.script, S.timing] = await Promise.all([get("script.json"), get("timing.json")]);
  } catch (e) { S.ready = false; say("Waiting for script.json and timing.json (" + e.message + ")"); return; }
  rebuildDraft();
  const fl = S.info.files;
  S.hasAudio = !!fl["voice.wav"];
  const src = (el, f, vol) => { if (fl[f]) { const u = Studio.dayFile(f) + "?v=" + fl[f]; if (!el.src.endsWith(u)) el.src = u; el.volume = vol; } else el.removeAttribute("src"); };
  src(A, "voice.wav", 1); src(Mu, "music.wav", 0.22); src(Sx, "sfx.wav", 0.9);
  Studio.emit("loaded");
  await reinit(keepT);
}

/** Restart the scene page with the current draft. Scene pages build themselves once, so a change means a fresh page. */
export function reinit(keepT) {   // no keepT: stay where the playhead is when the page is ready (the viewer may have moved it meanwhile)
  const seq = ++initSeq;
  const B = frames.find(x => x !== F);     // load into the hidden frame, show it once its first picture is drawn
  return new Promise(done => {
    B.onload = async () => {
      if (seq !== initSeq || B.contentWindow.location.href === "about:blank") return done();
      try {
        const w = B.contentWindow; await w.document.fonts.ready;
        await new Promise((r, j) => { let n = 0; const i = setInterval(() => { if (typeof w.init === "function") { clearInterval(i); r(); } else if (++n > 100) { clearInterval(i); j(new Error("this scene file has no init()")); } }, 50); });
        await w.init(JSON.parse(JSON.stringify(S.draft)), S.timing, { captions: S.caps });
        if (seq !== initSeq) return done();
        const t = typeof keepT === "number" ? keepT : S.t;
        w.render(Math.max(0, Math.min(S.timing.duration, t)));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (seq !== initSeq) return done();
        const old = F; F = B; B.classList.add("live"); old.classList.remove("live"); old.onload = null; old.src = "about:blank";
        S.ready = true; say(""); lastScene = -2; seek(typeof keepT === "number" ? keepT : S.t);
      } catch (e) { say("Scene error: " + e.message); }
      done();
    };
    B.src = "/t/" + S.scene + "?r=" + Date.now();
    layout();
  });
}
let reinitTimer = 0;
/** Debounced reinit while typing; keeps playing if it was. */
export function reinitSoon() {
  clearTimeout(reinitTimer);
  reinitTimer = setTimeout(async () => { const was = S.playing; if (was) setPlay(false); await reinit(); if (was) setPlay(true); }, 280);
}

export function draw() {
  if (!S.ready) return;
  try { F.contentWindow.render(S.t); } catch (e) { say("Render error: " + e.message); return; }
  const D = S.timing.duration, i = curScene();
  $("time").textContent = fmt(S.t) + " / " + fmt(D) + " s";
  $("hud").textContent = i >= 0 ? `scene ${i + 1}/${S.timing.scenes.length} · ${S.timing.scenes[i].id}` : "";
  if (i !== lastScene) { lastScene = i; Studio.emit("scene", i); }
  Studio.emit("time", S.t);
}
export function seek(s) {
  if (!S.timing) return;
  S.t = Math.max(0, Math.min(S.timing.duration, s));
  if (S.hasAudio) for (const a of [A, Mu, Sx]) if (a.src) { try { a.currentTime = S.t; } catch {} }
  clockT = S.t; clockAt = performance.now(); draw();
}
export function setPlay(p) {
  S.playing = p; $("play").textContent = p ? "Pause" : "Play";
  const r = Number($("speed").value); for (const a of [A, Mu, Sx]) a.playbackRate = r;
  if (p) {
    if (S.t >= S.timing.duration - 0.05) seek(0);
    clockT = S.t; clockAt = performance.now();
    if (S.hasAudio) for (const a of [A, Mu, Sx]) if (a.src) { try { a.currentTime = S.t; } catch {} a.play().catch(() => {}); }
  } else for (const a of [A, Mu, Sx]) a.pause();
}
export const jump = d => { const n = S.timing.scenes.length, c = curScene(); const i = Math.max(0, Math.min(n - 1, (c < 0 ? 0 : c) + d)); seek(S.timing.scenes[i].t0 + 0.3); };
export const seekScene = i => seek(S.timing.scenes[i].t0 + 0.3);

function loop() {
  if (S.playing && S.ready) {
    const r = Number($("speed").value);
    S.t = S.hasAudio && !A.paused && A.readyState > 2 ? A.currentTime : clockT + ((performance.now() - clockAt) / 1000) * r;
    if (S.t >= S.timing.duration) { S.t = S.timing.duration; setPlay(false); }
    draw();
  }
  requestAnimationFrame(loop);
}
// fit the 540x960 scene to the stage
export function layout() {
  const st = $("stage"), k = Math.max(0.1, Math.min((st.clientHeight - 28) / 960, (st.clientWidth - 28) / 540));
  $("phone").style.width = 540 * k + "px"; $("phone").style.height = 960 * k + "px"; for (const f of frames) f.style.transform = `scale(${k})`;
}
new ResizeObserver(layout).observe($("stage"));

Studio.on("draft", e => { $("draftTag").style.display = S.pending.size ? "block" : "none"; if (!e || !e.noRender) reinitSoon(); });
Studio.on("saved", e => { if (e && e.reload) load(); });
Object.assign(Studio, { seek, setPlay, jump, seekScene, reload: load, frame: () => F });
export function startLoop() { requestAnimationFrame(loop); }
