// Hand-off: one piece of text with every saved change and every open note, to paste into the chat with Claude.
import { $, S, Studio, esc, clock, pathLabel, sceneAt } from "./core.js";

const show = v => (v === undefined ? "(not set)" : typeof v === "string" ? `"${v}"` : JSON.stringify(v));
export async function buildText() {
  let changes = []; try { changes = (await Studio.api(Studio.dayApi("changes"))).changes; } catch {}
  const notes = S.notes.filter(n => !n.done);
  const lines = [`Studio hand-off for ${S.day}`];
  lines.push("", `Changes I saved in script.json (${changes.length}):`);
  if (changes.length) for (const c of changes) lines.push(`- ${pathLabel(c.path)}: ${show(c.from)} -> ${show(c.to)}`); else lines.push("- none");
  lines.push("", `Notes (${notes.length}):`);
  if (notes.length) for (const n of notes) { const k = sceneAt(n.t); lines.push(`- ${clock(n.t)}${k >= 0 ? ` (scene ${k + 1}, ${S.timing.scenes[k].id})` : ""}: ${n.text.replace(/\s*\n\s*/g, " ")}`); } else lines.push("- none");
  if (S.pending.size) lines.push("", `(${S.pending.size} more change${S.pending.size > 1 ? "s are" : " is"} showing in the player but not saved yet.)`);
  return { text: lines.join("\n"), changes: changes.length, notes: notes.length };
}
async function openDialog() {
  const d = $("dlg"), r = await buildText();
  d.innerHTML = `<h2>Send to Claude</h2><div class="hint">Copy this and paste it into the chat. It lists what you changed and your open notes, so Claude can rebuild the video to match (new voice, timing and render where needed).</div>
    <textarea readonly id="hoText">${esc(r.text)}</textarea>
    <div class="row"><button class="primary" id="hoCopy">Copy</button><a href="${Studio.dayFile("script.json")}" download="script-${esc(S.day)}.json">Download script.json</a><span class="sp"></span>
    <button id="hoReset" ${r.changes ? "" : "disabled"} title="Start the change list again from how the script is now">Clear the change list</button><button id="hoClose">Close</button></div>`;
  d.querySelector("#hoCopy").onclick = async () => { const t = d.querySelector("#hoText"); try { await navigator.clipboard.writeText(t.value); } catch { t.select(); document.execCommand("copy"); } Studio.toast("Copied. Paste it into the chat."); };
  d.querySelector("#hoReset").onclick = async () => { try { await Studio.post(Studio.dayApi("changes/reset")); Studio.toast("Change list cleared"); d.close(); } catch (e) { Studio.toast(e.message, true); } };
  d.querySelector("#hoClose").onclick = () => d.close();
  d.showModal();
}
$("handoff").onclick = openDialog;
Studio.handoff = { buildText, open: openDialog };
