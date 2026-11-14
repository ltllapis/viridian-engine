// Tell the Studio what is being worked on right now. The status strip shows it live.
//   node studio/status.mjs <dayFolder> --task "Fixing the TSLA chart" --steps "Script,Timing,Voice,Render" --at 2 --detail "re-aligning words"
//   node studio/status.mjs <dayFolder> --done            (marks everything finished)
//   node studio/status.mjs <dayFolder> --error "voice.py failed"
import fs from "node:fs"; import path from "node:path";
const a = process.argv.slice(2); const day = path.resolve(a[0] || ".");
const arg = k => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
const f = path.join(day, "status.json");
let s = {}; try { s = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
const now = new Date().toISOString();
if (arg("--task") !== undefined) s.task = arg("--task");
if (arg("--steps") !== undefined) s.steps = arg("--steps").split(",").map(x => x.trim()).filter(Boolean);
if (arg("--at") !== undefined) s.at = Number(arg("--at"));           // 1-based index of the step in progress
if (arg("--detail") !== undefined) s.detail = arg("--detail");
s.state = a.includes("--done") ? "done" : arg("--error") !== undefined ? "error" : "working";
if (a.includes("--done")) { s.at = (s.steps || []).length + 1; s.detail = arg("--detail") || "Finished"; }
if (arg("--error") !== undefined) s.detail = arg("--error");
s.updated = now;
s.log = [...(s.log || []).slice(-39), { at: now, text: [s.task, s.steps && s.at ? s.steps[s.at - 1] : null, s.detail].filter(Boolean).join(" · ") }];
fs.writeFileSync(f, JSON.stringify(s, null, 1));
console.log("status:", s.state, s.task || "", s.detail || "");
