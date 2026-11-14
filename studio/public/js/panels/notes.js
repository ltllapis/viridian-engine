// Frame notes: pause on a frame, write what you want changed, and it is saved with the time and scene.
import { $, S, Studio, esc, clock, curScene, sceneAt } from "../core.js";
import { seek, setPlay } from "../player.js";

let draftText = "";
const open = () => S.notes.filter(n => !n.done).length;
async function refresh() { try { S.notes = (await Studio.api(Studio.dayApi("notes"))).notes; } catch { S.notes = []; } pins(); Studio.emit("notes"); }
function pins() { Studio.setMarkers("notes", S.notes.map(n => ({ t: n.t, cls: n.done ? "done" : "", title: clock(n.t) + "  " + n.text, onClick: () => Studio.showTab("notes") }))); }
async function act(action, note) { try { S.notes = (await Studio.post(Studio.dayApi("notes"), { action, note })).notes; pins(); Studio.emit("notes"); return true; } catch (e) { Studio.toast(e.message, true); return false; } }

function render() {
  const i = curScene(), where = `${clock(S.t)}${i >= 0 ? ` · scene ${i + 1} (${esc(S.timing.scenes[i].id)})` : ""}`;
  return `<div class="hint">Pause where something should change, write it down, and send your notes to Claude from the button at the top.</div>
    <textarea id="noteText" placeholder="What should change at this moment?" ${S.info.readOnly ? "disabled" : ""}>${esc(draftText)}</textarea>
    <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><button class="primary" id="noteAdd" ${S.info.readOnly ? "disabled" : ""}>Add note at <span id="noteAt">${where}</span></button><span class="hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd></span></div>
    <div class="kv">${S.notes.length ? `${open()} open · ${S.notes.length - open()} done` : "No notes yet"}</div>
    ${S.notes.map(n => { const k = sceneAt(n.t); return `<div class="note${n.done ? " done" : ""}" data-id="${esc(n.id)}"><div class="nh"><input type="checkbox" data-done ${n.done ? "checked" : ""} title="Mark as done"><a data-go="${n.t}">${clock(n.t)}</a><span>${k >= 0 ? `scene ${k + 1} · ${esc(S.timing.scenes[k].id)}` : esc(n.scene)}</span><span class="sp"></span><button class="ghost" data-del title="Delete this note">✕</button></div><div class="tx" data-edit title="Click to edit">${esc(n.text)}</div></div>`; }).join("")}`;
}
function bind(root) {
  const ta = root.querySelector("#noteText");
  ta.oninput = () => (draftText = ta.value);
  const add = async () => { const i = curScene(); if (!ta.value.trim()) return ta.focus(); if (await act("add", { t: S.t, scene: i >= 0 ? S.timing.scenes[i].id : "", text: ta.value.trim() })) { draftText = ""; Studio.log("Note added at " + clock(S.t)); } };
  root.querySelector("#noteAdd").onclick = add;
  ta.onkeydown = e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } };
  root.querySelectorAll(".note").forEach(el => {
    const id = el.dataset.id, n = S.notes.find(x => x.id === id);
    el.querySelector("[data-go]").onclick = () => { setPlay(false); seek(n.t); };
    el.querySelector("[data-done]").onchange = e => act("update", { id, done: e.target.checked });
    el.querySelector("[data-del]").onclick = () => act("delete", { id });
    el.querySelector("[data-edit]").onclick = ev => {
      const box = ev.currentTarget; if (box.querySelector("textarea")) return;
      box.innerHTML = `<textarea>${esc(n.text)}</textarea>`; const t = box.querySelector("textarea"); t.focus();
      t.onblur = () => { const v = t.value.trim(); if (v && v !== n.text) act("update", { id, text: v }); else Studio.renderPanel(); };
      t.onkeydown = e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) t.blur(); if (e.key === "Escape") { t.value = n.text; t.blur(); } };
    };
  });
}
Studio.panel({
  id: "notes", title: "Notes", render, bind, badge: () => open() || null,
  onTime(root) { const el = root.querySelector("#noteAt"); if (el) { const i = curScene(); el.textContent = `${clock(S.t)}${i >= 0 ? ` · scene ${i + 1} (${S.timing.scenes[i].id})` : ""}`; } },
});
Studio.on("loaded", refresh);
Studio.on("files", e => { if (e.names.includes("notes.json")) refresh(); });
Studio.on("notes", () => { Studio.renderTabs(); const a = document.activeElement; if (S.tab === "notes" && !(a && a.tagName === "TEXTAREA" && a.id !== "noteText" && $("panel").contains(a))) { const had = a && a.id === "noteText"; Studio.renderPanel(); if (had) $("noteText")?.focus(); } });
/** Jump to the note box (keyboard N). */
Studio.newNote = () => { setPlay(false); Studio.showTab("notes"); $("noteText")?.focus(); };
