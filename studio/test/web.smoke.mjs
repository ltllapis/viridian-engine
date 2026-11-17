// Browser smoke test of the web-hosted build, with a stand-in for the claude.ai `db` capability.
//   node studio/build-web.mjs --out /tmp/studio-web --days 2026-11-04 
//   node studio/test/web.smoke.mjs /tmp/studio-web [--shots <folder>]
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(process.argv[2] || "studio-web");
const shots = process.argv.includes("--shots") ? path.resolve(process.argv[process.argv.indexOf("--shots") + 1]) : null; if (shots) fs.mkdirSync(shots, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wav": "audio/wav", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split("?")[0]) === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(f); const t = TYPES[path.extname(f)] || "application/octet-stream";
  if (path.basename(f) === "index.html" && f === path.join(root, "index.html")) body = Buffer.from(`<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"></head><body>${body}</body></html>`);
  res.writeHead(200, { "content-type": t, "content-length": body.length }); res.end(body);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

// A small in-memory stand-in for claude.use("db"): documents by path, live listeners, stored in localStorage so a reload keeps them.
const stub = () => {
  const KEY = "stubdb", load = () => JSON.parse(localStorage.getItem(KEY) || "{}"), save = m => localStorage.setItem(KEY, JSON.stringify(m)), subs = [];
  const snapDoc = (id, v) => ({ id, exists: v !== undefined, data: () => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))), metadata: { fromCache: false, hasPendingWrites: false } });
  const fire = () => { const m = load(); for (const s of subs) s(m); };
  const docRef = p => ({ id: p.split("/").pop(), path: p,
    get: async () => snapDoc(p.split("/").pop(), load()[p]),
    set: async d => { const m = load(); m[p] = JSON.parse(JSON.stringify(d)); save(m); setTimeout(fire, 20); },
    delete: async () => { const m = load(); delete m[p]; save(m); setTimeout(fire, 20); },
    onSnapshot(next) { const f = m => next(snapDoc(p.split("/").pop(), m[p])); subs.push(f); setTimeout(() => f(load()), 10); return () => subs.splice(subs.indexOf(f), 1); } });
  const colRef = p => ({ path: p, doc: id => docRef(p + "/" + (id || Math.random().toString(36).slice(2))),
    onSnapshot(next) { const f = m => { const docs = Object.keys(m).filter(k => k.startsWith(p + "/") && k.split("/").length === p.split("/").length + 1).sort().map(k => snapDoc(k.split("/").pop(), m[k])); next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }); }; subs.push(f); setTimeout(() => f(load()), 10); return () => subs.splice(subs.indexOf(f), 1); } });
  window.claude = { use: async n => (n === "db" ? { doc: docRef, collection: colRef } : null) };
};
const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await ctx.newPage();
await p.addInitScript(stub);
const errs = []; p.on("pageerror", e => errs.push(e.message)); p.on("console", m => m.type() === "error" && errs.push(m.text()));
const delta = `input[data-p='["scenes",1,"callouts",0,"delta"]']`;
try {
  await p.goto(url); await p.waitForFunction(() => window.Studio && Studio.state.ready, null, { timeout: 15000 });
  assert.equal(await p.evaluate(() => Studio.backend.mode), "web");
  assert.ok(await p.evaluate(() => Studio.state.hasAudio), "audio files are found");
  await p.evaluate(() => Studio.seek(7)); await p.click("#tabs button[data-id=adjust]");
  await p.fill(delta, "9.9"); await p.waitForFunction(() => Studio.state.pending.size === 1 && Studio.state.ready);
  await p.keyboard.press("Control+s"); await p.waitForFunction(() => Studio.state.pending.size === 0 && Studio.state.info.history.undo === 1, null, { timeout: 8000 });
  await p.evaluate(() => { document.activeElement.blur(); Studio.seek(21.3); }); await p.keyboard.press("n"); await p.keyboard.type("Make the Microsoft line thicker"); await p.keyboard.press("Control+Enter");
  await p.waitForFunction(() => Studio.state.notes.length === 1, null, { timeout: 5000 }).catch(async e => { console.log("debug", await p.evaluate(() => [Studio.state.tab, document.activeElement && document.activeElement.id, document.getElementById("noteText") && document.getElementById("noteText").value, localStorage.getItem("stubdb").slice(0, 300)]), errs); throw e; });
  await p.evaluate(() => localStorage.setItem("stubdb", JSON.stringify({ ...JSON.parse(localStorage.getItem("stubdb")), "status/2026-11-04": { task: "Rebuilding the voice for scene 2", steps: ["Script", "Voice", "Timing", "Render"], at: 2, detail: "new narration take", state: "working", updated: new Date().toISOString(), log: [] } })));
  await p.evaluate(() => window.claude.use("db").then(d => d.doc("status/2026-11-04").set(JSON.parse(localStorage.getItem("stubdb"))["status/2026-11-04"])));
  await p.waitForFunction(() => document.getElementById("st-task").textContent.includes("Rebuilding"), null, { timeout: 8000 }).catch(async e => { console.log("debug", await p.evaluate(() => [document.getElementById("st-task").textContent, JSON.stringify(Studio.state.info.status), localStorage.getItem("stubdb").slice(0,200), document.getElementById("conn").textContent])); throw e; });
  if (shots) await p.screenshot({ path: path.join(shots, "web-studio.png") });
  // a fresh load (like opening the page again) keeps the saved edit and the note
  await p.reload(); await p.waitForFunction(() => window.Studio && Studio.state.ready, null, { timeout: 15000 });
  assert.equal(await p.evaluate(() => Studio.state.script.scenes[1].callouts[0].delta), 9.9, "saved edit survives a reload");
  assert.equal(await p.evaluate(() => Studio.state.notes.length), 1, "note survives a reload");
  await p.click("#handoff"); const text = await p.inputValue("#hoText");
  assert.match(text, /callouts 1 › delta: 3 -> 9\.9/); assert.match(text, /Make the Microsoft line thicker/);
  await p.click("#hoClose"); await p.click("#tabs button[data-id=adjust]"); await p.click("#adjUndo");
  await p.waitForFunction(() => Studio.state.script.scenes[1].callouts[0].delta === 3, null, { timeout: 8000 });
  assert.deepEqual(errs, [], "no errors in the page");
  console.log("web smoke test passed");
} finally { await b.close(); server.close(); }
