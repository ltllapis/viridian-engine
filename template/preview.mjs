// Live preview of a recap day. Edit script.json / timing.json / a scene HTML and the page reloads itself.
//   node template/preview.mjs days/2026-11-04 [--scene flat4.html] [--port 4173]
// Open the printed address. Space = play/pause, arrows = step 1 s, S = safe-zone guides, C = captions.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const day = path.resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : ".");
const scene = arg("--scene", "flat4.html");
const port = Number(arg("--port", 4173));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".mp4": "video/mp4" };

const mtime = () => {
  const files = [path.join(day, "script.json"), path.join(day, "timing.json"), path.join(day, "voice.wav"), ...fs.readdirSync(here).filter(f => /^flat.*\.html$/.test(f)).map(f => path.join(here, f))];
  return Math.max(...files.map(f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }));
};
function serve(root, rel, req, res) {
  const f = path.normalize(path.join(root, rel));
  if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); res.end("not found"); return; }
    const type = TYPES[path.extname(f)] || "application/octet-stream";
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {   // audio scrubbing needs byte ranges
      const a = range[1] ? Number(range[1]) : 0, b = range[2] ? Number(range[2]) : st.size - 1;
      res.writeHead(206, { "content-type": type, "content-range": `bytes ${a}-${b}/${st.size}`, "accept-ranges": "bytes", "content-length": b - a + 1, "cache-control": "no-store" });
      fs.createReadStream(f, { start: a, end: b }).pipe(res);
    } else {
      res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes", "cache-control": "no-store" });
      fs.createReadStream(f).pipe(res);
    }
  });
}
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  if (u === "/" || u === "/index.html") return serve(here, "preview.html", req, res);
  if (u === "/api/info") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ scene, day: path.basename(day), mtime: mtime(), hasMusic: fs.existsSync(path.join(day, "music.wav")), hasSfx: fs.existsSync(path.join(day, "sfx.wav")), hasVoice: fs.existsSync(path.join(day, "voice.wav")) })); return; }
  if (u.startsWith("/day/")) return serve(day, u.slice(5), req, res);
  return serve(here, u.slice(1), req, res);
}).listen(port, "0.0.0.0", () => console.log(`Preview of ${path.basename(day)} (${scene}) at http://localhost:${port}/  (edit files, the page reloads itself)`));
