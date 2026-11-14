// Viridian Studio server: zero dependencies. Serves the player, the day files and the scene pages,
// and pushes a message over Server-Sent Events whenever a file of a day (or a scene page) changes.
//   node studio/server.mjs [dayFolder] [--port 4180] [--host 127.0.0.1]
// Days are found in examples/ and days/ (any folder holding script.json) plus the folder you pass.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const tpl = path.join(repo, "template");
const pub = path.join(here, "public");
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const port = Number(arg("--port", 4180));
const host = arg("--host", "127.0.0.1");
const extra = process.argv[2] && !process.argv[2].startsWith("--") ? path.resolve(process.argv[2]) : null;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };
const WATCH = ["script.json", "timing.json", "voice.wav", "music.wav", "sfx.wav", "narration.txt", "intraday.json", "data-check.md", "status.json", "notes.json"];

function findDays() {
  const out = new Map();
  const add = d => { if (fs.existsSync(path.join(d, "script.json"))) out.set(path.basename(d), d); };
  for (const root of ["examples", "days"]) {
    const r = path.join(repo, root);
    if (fs.existsSync(r)) for (const n of fs.readdirSync(r).sort().reverse()) add(path.join(r, n));
  }
  if (extra) add(extra);
  return out;
}
let days = findDays();
const dayDir = name => { days = findDays(); return days.get(name) || null; };
const stat = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

function dayInfo(name) {
  const d = dayDir(name); if (!d) return null;
  const files = {}; for (const f of WATCH) { const m = stat(path.join(d, f)); if (m) files[f] = Math.round(m); }
  const scenes = fs.readdirSync(tpl).filter(f => /^flat.*\.html$/.test(f)).sort();
  return { name, scenes, defaultScene: scenes.includes("flat4.html") ? "flat4.html" : scenes[scenes.length - 1], files, status: readJson(path.join(d, "status.json")) };
}

// --- change watching (stat polling: works on every OS and for network folders) ---
const seen = new Map(); const clients = new Set();
function scan() {
  days = findDays();
  const changes = [];
  const check = (key, file, day) => { const m = stat(file); const old = seen.get(key); seen.set(key, m); if (old !== undefined && old !== m) changes.push({ day, file: path.basename(file), scope: day ? "day" : "scene", at: Date.now() }); };
  for (const [name, d] of days) for (const f of WATCH) check(name + "/" + f, path.join(d, f), name);
  for (const f of fs.readdirSync(tpl)) if (/^flat.*\.html$/.test(f) || f === "preview.html") check("tpl/" + f, path.join(tpl, f), null);
  if (changes.length) { const msg = `data: ${JSON.stringify({ type: "change", changes })}\n\n`; for (const c of clients) c.write(msg); }
}
scan(); setInterval(scan, 400);
setInterval(() => { for (const c of clients) c.write(": ping\n\n"); }, 15000);

function serveFile(root, rel, req, res) {
  const f = path.normalize(path.join(root, rel));
  if (f !== root && !f.startsWith(root + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); return res.end("not found"); }
    const type = TYPES[path.extname(f).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);   // audio scrubbing needs byte ranges
    const h = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-store" };
    if (range) {
      const a = range[1] ? Number(range[1]) : 0, b = range[2] ? Number(range[2]) : st.size - 1;
      res.writeHead(206, { ...h, "content-range": `bytes ${a}-${b}/${st.size}`, "content-length": b - a + 1 });
      fs.createReadStream(f, { start: a, end: b }).pipe(res);
    } else { res.writeHead(200, { ...h, "content-length": st.size }); fs.createReadStream(f).pipe(res); }
  });
}
const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };

http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  if (u === "/" || u === "/index.html") return serveFile(pub, "index.html", req, res);
  if (u === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`); clients.add(res); req.on("close", () => clients.delete(res)); return;
  }
  if (u === "/api/days") { const names = [...days.keys()]; return json(res, 200, { days: names, default: names.find(n => stat(path.join(days.get(n), "voice.wav"))) || names[0] }); }   // open on the newest day that has a voice
  let m = /^\/api\/day\/([^/]+)$/.exec(u);
  if (m) { const i = dayInfo(m[1]); return i ? json(res, 200, i) : json(res, 404, { error: "unknown day" }); }
  m = /^\/day\/([^/]+)\/(.+)$/.exec(u);
  if (m) { const d = dayDir(m[1]); return d ? serveFile(d, m[2], req, res) : (res.writeHead(404), res.end("unknown day")); }
  if (u.startsWith("/t/")) return serveFile(tpl, u.slice(3), req, res);      // scene pages and their fonts/assets
  return serveFile(pub, u.slice(1), req, res);
}).listen(port, host, () => {
  console.log(`Viridian Studio  http://${host === "0.0.0.0" ? "localhost" : host}:${port}/`);
  console.log(`Days: ${[...days.keys()].join(", ") || "(none found)"}   Edit a day file or a scene page and the player refreshes by itself.`);
});
