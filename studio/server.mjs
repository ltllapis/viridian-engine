// Viridian Studio server: zero dependencies. Serves the player, the day files and the scene pages,
// pushes a message over Server-Sent Events whenever a file changes, and saves edits and notes.
//   node studio/server.mjs [dayFolder] [--port 4180] [--host 127.0.0.1] [--read-only] [--open]
// Days are found in examples/ and days/ (any folder holding script.json) plus the folder you pass.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exec } from "node:child_process";
import * as store from "./lib/store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };
const WATCH = ["script.json", "timing.json", "voice.wav", "music.wav", "sfx.wav", "narration.txt", "intraday.json", "data-check.md", "status.json", "notes.json"];
export const VERSION = "0.2.0";

/** Start a Studio server. Returns { server, url, close }. Used by the command line below and by the tests. */
export function startStudio({ repo = path.resolve(here, ".."), extraDay = null, port = 4180, host = "127.0.0.1", readOnly = false, quiet = false } = {}) {
  const tpl = path.join(repo, "template"), pub = path.join(here, "public");
  const findDays = () => {
    const out = new Map();
    const add = d => { if (fs.existsSync(path.join(d, "script.json"))) out.set(path.basename(d), d); };
    for (const root of ["examples", "days"]) {
      const r = path.join(repo, root);
      if (fs.existsSync(r)) for (const n of fs.readdirSync(r).sort().reverse()) add(path.join(r, n));
    }
    if (extraDay) add(path.resolve(extraDay));
    return out;
  };
  let days = findDays();
  const dayDir = name => { days = findDays(); return days.get(name) || null; };
  const stat = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const sceneFiles = () => { try { return fs.readdirSync(tpl).filter(f => /^flat.*\.html$/.test(f)).sort(); } catch { return []; } };

  function dayInfo(name) {
    const d = dayDir(name); if (!d) return null;
    const files = {}; for (const f of WATCH) { const m = stat(path.join(d, f)); if (m) files[f] = Math.round(m); }
    const scenes = sceneFiles();
    // newest look first: flat5 (3D cream) when present, else flat4
    const defaultScene = ["flat5.html", "flat4.html"].find(s => scenes.includes(s)) || scenes[scenes.length - 1] || null;
    return { name, scenes, defaultScene, files, status: store.readJson(path.join(d, "status.json")), history: store.historyInfo(d), notes: store.listNotes(d).length, readOnly, version: VERSION };
  }

  // --- change watching (stat polling: works on every OS and for network folders) ---
  const seen = new Map(), clients = new Set();
  function scan() {
    days = findDays();
    const changes = [];
    const check = (key, file, day) => { const m = stat(file); const old = seen.get(key); seen.set(key, m); if (old !== undefined && old !== m) changes.push({ day, file: path.basename(file), scope: day ? "day" : "scene", at: Date.now() }); };
    for (const [name, d] of days) for (const f of WATCH) check(name + "/" + f, path.join(d, f), name);
    for (const f of sceneFiles()) check("tpl/" + f, path.join(tpl, f), null);
    if (changes.length) { const msg = `data: ${JSON.stringify({ type: "change", changes })}\n\n`; for (const c of clients) c.write(msg); }
  }
  scan();
  const timers = [setInterval(scan, 400), setInterval(() => { for (const c of clients) c.write(": ping\n\n"); }, 15000)];

  function serveFile(root, rel, req, res) {
    const f = path.normalize(path.join(root, rel));
    if (f !== root && !f.startsWith(root + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
    if (rel.split(/[\\/]/).some(s => s.startsWith("."))) { res.writeHead(404); return res.end("not found"); }   // never serve dot-folders
    fs.stat(f, (e, st) => {
      if (e || !st.isFile()) { res.writeHead(404); return res.end("not found"); }
      const type = TYPES[path.extname(f).toLowerCase()] || "application/octet-stream";
      const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);   // audio scrubbing needs byte ranges
      const h = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-store" };
      if (range) {
        const a = range[1] ? Number(range[1]) : 0, b = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
        res.writeHead(206, { ...h, "content-range": `bytes ${a}-${b}/${st.size}`, "content-length": b - a + 1 });
        fs.createReadStream(f, { start: a, end: b }).pipe(res);
      } else { res.writeHead(200, { ...h, "content-length": st.size }); fs.createReadStream(f).pipe(res); }
    });
  }
  const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };
  const readBody = req => new Promise((ok, bad) => { let n = 0; const parts = []; req.on("data", c => { n += c.length; if (n > 2e6) { bad(new store.StoreError("Too large", 413)); req.destroy(); } else parts.push(c); }); req.on("end", () => { try { ok(parts.length ? JSON.parse(Buffer.concat(parts).toString("utf8")) : {}); } catch { bad(new store.StoreError("Bad JSON")); } }); req.on("error", bad); });

  // Writes only come from the Studio page itself: a custom header (which other websites cannot send without
  // permission) and a matching Origin. Together these stop a random web page from editing your files.
  function writeAllowed(req) {
    if (readOnly) return "Studio is running read-only";
    if (req.headers["x-studio"] !== "1") return "Missing Studio header";
    const o = req.headers.origin; if (o) { try { if (new URL(o).host !== req.headers.host) return "Wrong origin"; } catch { return "Wrong origin"; } }
    return null;
  }
  // POST /api/day/<name>/<action>
  const ACTIONS = {
    script: (d, b) => store.editScript(d, b.ops, b.label),
    undo: d => store.undo(d),
    redo: d => store.redo(d),
    notes: (d, b) => ({ notes: store.changeNotes(d, b.action, b.note) }),
    "changes/reset": d => store.resetBaseline(d),
  };
  const READS = {
    notes: d => ({ notes: store.listNotes(d) }),
    changes: d => ({ changes: store.changes(d) }),
  };

  const server = http.createServer(async (req, res) => {
    let u; try { u = decodeURIComponent(req.url.split("?")[0]); } catch { res.writeHead(400); return res.end(); }
    try {
      if (req.method === "POST") {
        const m = /^\/api\/day\/([^/]+)\/(.+)$/.exec(u); const act = m && ACTIONS[m[2]];
        if (!act) return json(res, 404, { error: "Unknown action" });
        const no = writeAllowed(req); if (no) return json(res, 403, { error: no });
        const d = dayDir(m[1]); if (!d) return json(res, 404, { error: "Unknown day" });
        return json(res, 200, { ok: true, ...act(d, await readBody(req)) });
      }
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
      if (u === "/" || u === "/index.html") return serveFile(pub, "index.html", req, res);
      if (u === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(`data: ${JSON.stringify({ type: "hello", version: VERSION })}\n\n`); clients.add(res); req.on("close", () => clients.delete(res)); return;
      }
      if (u === "/api/days") { const names = [...days.keys()]; return json(res, 200, { days: names, default: names.find(n => stat(path.join(days.get(n), "voice.wav"))) || names[0] || null, version: VERSION }); }   // open on the newest day that has a voice
      let m = /^\/api\/day\/([^/]+)$/.exec(u);
      if (m) { const i = dayInfo(m[1]); return i ? json(res, 200, i) : json(res, 404, { error: "Unknown day" }); }
      m = /^\/api\/day\/([^/]+)\/(.+)$/.exec(u);
      if (m && READS[m[2]]) { const d = dayDir(m[1]); return d ? json(res, 200, READS[m[2]](d)) : json(res, 404, { error: "Unknown day" }); }
      m = /^\/day\/([^/]+)\/(.+)$/.exec(u);
      if (m) { const d = dayDir(m[1]); if (!d) { res.writeHead(404); return res.end("unknown day"); } return serveFile(d, m[2], req, res); }
      if (u.startsWith("/t/")) return serveFile(tpl, u.slice(3), req, res);      // scene pages and their fonts/assets
      return serveFile(pub, u.slice(1), req, res);
    } catch (e) {
      const code = e instanceof store.StoreError ? e.code : 500;
      if (code === 500) console.error(e);
      json(res, code, { error: e.message || "Something went wrong" });
    }
  });
  const close = () => new Promise(r => { timers.forEach(clearInterval); for (const c of clients) c.end(); server.close(r); server.closeAllConnections?.(); });
  return new Promise((ok, bad) => {
    server.once("error", bad);
    server.listen(port, host, () => {
      const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${server.address().port}/`;
      if (!quiet) { console.log(`Viridian Studio ${VERSION}  ${url}`); console.log(`Days: ${[...days.keys()].join(", ") || "(none found)"}   Edit a day file or a scene page and the player refreshes by itself.`); }
      ok({ server, url, close });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
  const extraDay = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
  startStudio({ extraDay, port: Number(arg("--port", 4180)), host: arg("--host", "127.0.0.1"), readOnly: process.argv.includes("--read-only") })
    .then(s => { if (process.argv.includes("--open")) exec((process.platform === "win32" ? 'start "" ' : process.platform === "darwin" ? "open " : "xdg-open ") + s.url, () => {}); })
    .catch(e => { console.error(e.code === "EADDRINUSE" ? "Studio is already running (that address is in use). Open http://localhost:4180/ or pass --port 4181." : e.message); process.exit(1); });
}
