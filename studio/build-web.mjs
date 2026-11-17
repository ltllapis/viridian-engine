// Build the web-hosted Studio: a folder of files you can publish as a private claude.ai page.
//   node studio/build-web.mjs --out <folder> [--days 2026-11-04,2026-11-05] [--no-end-frames]
// The page keeps your saved adjustments, notes and the status strip in its shared database, not in these files.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "./server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, ".."), tpl = path.join(repo, "template");
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const out = path.resolve(arg("--out", "studio-web")), want = arg("--days", "").split(",").filter(Boolean);
const FILES = ["script.json", "timing.json", "voice.wav", "music.wav", "sfx.wav", "narration.txt", "intraday.json", "data-check.md"];
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });

// page: the artifact tool wraps it in its own skeleton, so only the content goes in (no doctype/html/head/body)
const src = fs.readFileSync(path.join(here, "public/index.html"), "utf8");
const body = src.slice(src.indexOf("<body>") + 6, src.indexOf('<script type="module"'));
fs.writeFileSync(path.join(out, "index.html"), `<title>Viridian Studio</title>
<meta name="studio-backend" content="web">
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="studio.css">
${body}<script type="module" src="js/main.js"></script>
`);
copy(path.join(here, "public/studio.css"), path.join(out, "studio.css"));
for (const f of walk(path.join(here, "public/js"))) copy(f, path.join(out, "js", path.relative(path.join(here, "public/js"), f)));

// scene pages and what they load
const scenes = fs.readdirSync(tpl).filter(f => /^flat.*\.html$/.test(f)).sort();
for (const s of scenes) copy(path.join(tpl, s), path.join(out, "t", s));
for (const dir of ["fonts", "assets", "vendor"]) if (fs.existsSync(path.join(tpl, dir))) for (const f of walk(path.join(tpl, dir))) {
  if (process.argv.includes("--no-end-frames") && f.includes(path.join("assets", "vlogo3d"))) continue;
  copy(f, path.join(out, "t", path.relative(tpl, f)));
}

// days
const found = new Map();
for (const root of ["examples", "days"]) { const r = path.join(repo, root); if (fs.existsSync(r)) for (const n of fs.readdirSync(r).sort().reverse()) if (fs.existsSync(path.join(r, n, "script.json"))) found.set(n, path.join(r, n)); }
const days = [...found].filter(([n]) => !want.length || want.includes(n)).map(([name, dir]) => {
  const files = {}; for (const f of FILES) if (fs.existsSync(path.join(dir, f))) { copy(path.join(dir, f), path.join(out, "days", name, f)); files[f] = Math.round(fs.statSync(path.join(dir, f)).mtimeMs / 1000); }
  return { name, files };
});
const withVoice = days.find(d => d.files["voice.wav"]);
const defaultScene = ["flat4.html", "flat5.html"].find(s => scenes.includes(s)) || scenes[0];   // flat5 (3D) is opt-in on the web until it is checked there
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ version: VERSION, built: new Date().toISOString(), days, scenes, defaultScene, default: (withVoice || days[0]).name }, null, 1));

const all = walk(out).map(f => path.relative(out, f).split(path.sep).join("/")).sort();
const bytes = all.reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
fs.writeFileSync(path.join(out, ".files.json"), JSON.stringify(all.filter(f => f !== "index.html")));
console.log(`Built ${all.length} files, ${(bytes / 1e6).toFixed(1)} MB in ${out}`);
console.log(`Days: ${days.map(d => d.name).join(", ")}  ·  scenes: ${scenes.join(", ")}`);
if (all.length > 255) console.log("More than 255 files: publish in more than one call (the Artifact tool takes 255 per publish).");
