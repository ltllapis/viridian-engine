// Browser smoke test: drives the real page. Needs Playwright (npm install), so it is separate from the unit tests.
//   node studio/test/browser.smoke.mjs [--shots <folder>]
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { startStudio } from "../server.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "../..");
const shots = process.argv.includes("--shots") ? path.resolve(process.argv[process.argv.indexOf("--shots") + 1]) : null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const day = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "studio-")), "smoke");
fs.cpSync(path.join(repo, "examples/2026-11-04"), day, { recursive: true });
const s = await startStudio({ repo, extraDay: day, port: 0, quiet: true });
const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
const errs = []; p.on("pageerror", e => errs.push(e.message)); p.on("console", m => m.type() === "error" && errs.push(m.text()));
const st = f => p.evaluate(f), shot = async n => shots && p.screenshot({ path: path.join(shots, n + ".png") });
const delta = `input[data-p='["scenes",1,"callouts",0,"delta"]']`;
try {
  await p.goto(s.url + "?day=smoke"); await p.waitForFunction(() => window.Studio && Studio.state.ready);
  await st(() => Studio.seek(7)); await p.click("#tabs button[data-id=adjust]");
  await p.fill(delta, "9.9"); await p.waitForFunction(() => Studio.state.ready && Studio.state.pending.size === 1);
  await p.frameLocator("#f").locator("body").filter({ hasText: "9.9%" }).waitFor({ timeout: 5000 });   // the player shows the unsaved value
  await p.fill(`textarea[data-p='["scenes",1,"text"]']`, "Stocks took off. The Dow jumped 9.9 percent."); await p.waitForTimeout(600);
  assert.equal(await p.locator(".blk.stale").count(), 1, "changed narration is flagged as needing a new voice");
  await shot("adjust");
  await p.keyboard.press("Control+s"); await p.waitForFunction(() => Studio.state.pending.size === 0 && Studio.state.info.history.undo === 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(day, "script.json"))).scenes[1].callouts[0].delta, 9.9, "saved to disk");
  await p.waitForFunction(() => Studio.state.ready); await p.waitForTimeout(900);
  await p.click("#adjUndo"); await p.waitForFunction(() => Studio.state.info.history.redo === 1 && Studio.state.script.scenes[1].callouts[0].delta === 3);
  await p.waitForFunction(() => Studio.state.ready); await p.click("#adjRedo"); await p.waitForFunction(() => Studio.state.script.scenes[1].callouts[0].delta === 9.9);
  await st(() => Studio.seek(21.3)); await p.keyboard.press("n"); await p.keyboard.type("Make the Microsoft line thicker"); await p.keyboard.press("Control+Enter");
  await p.waitForFunction(() => Studio.state.notes.length === 1); assert.equal(await p.locator(".mk").count(), 1, "note pin on the timeline");
  await st(() => Studio.seek(36)); await p.fill("#noteText", "Hold on Tesla a little longer"); await p.click("#noteAdd"); await p.waitForFunction(() => Studio.state.notes.length === 2);
  await shot("notes");
  execFileSync("node", [path.join(repo, "studio/status.mjs"), day, "--task", "Rebuilding the voice for scene 2", "--steps", "Script,Voice,Timing,Render", "--at", "2", "--detail", "new narration take"]);
  await p.waitForFunction(() => document.getElementById("st-task").textContent.includes("Rebuilding"));
  await p.click("#handoff"); const text = await p.inputValue("#hoText");
  assert.match(text, /callouts 1 › delta: 3 -> 9\.9/); assert.match(text, /0:21\.3 \(scene 4, mega\): Make the Microsoft line thicker/);
  await shot("send-to-claude");
  assert.deepEqual(errs, [], "no errors in the page");
  console.log("browser smoke test passed");
} finally { await b.close(); await s.close(); }
