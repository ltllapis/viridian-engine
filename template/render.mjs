// Render a daily recap: node render.mjs <day-dir> [--stills 1,12,30] [--draft]
// Needs <day-dir>/script.json, timing.json, voice.wav, music.wav (from voice.py).
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const day = path.resolve(process.argv[2]);
const arg = k => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
// 3D pages (three.js import map: flat5) need a local server and software WebGL, so hand them to render3d.mjs.
const sceneFile = arg("--scene") || "flat5.html";
if (fs.readFileSync(path.join(here, sceneFile), "utf8").includes('type="importmap"')) {
  const { spawnSync } = await import("node:child_process");
  const a = process.argv.slice(2); if (!arg("--scene")) a.push("--scene", sceneFile);
  process.exit(spawnSync(process.execPath, [path.join(here, "render3d.mjs"), ...a], { stdio: "inherit" }).status ?? 1);
}
const script = JSON.parse(fs.readFileSync(path.join(day, "script.json")));
const timing = JSON.parse(fs.readFileSync(path.join(day, "timing.json")));
const FPS = 30;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
page.on("pageerror", e => console.error("PAGE ERROR", e.message));
await page.goto("file://" + path.join(here, sceneFile));
await page.evaluate(async ([s, t, c]) => { await document.fonts.ready; await window.init(s, t, { captions: c }); }, [script, timing, process.argv.includes("--captions")]);

// preload-wait: let SVG <image> assets decode
await page.evaluate(() => window.render(66));
await page.waitForTimeout(800);

if (arg("--stills")) {
  for (const t of arg("--stills").split(",").map(Number)) {
    await page.evaluate(t => window.render(t), t);
    await page.screenshot({ path: path.join(day, `still_${t}.png`) });
  }
  await browser.close();
  process.exit(0);
}

const silent = path.join(day, `_video_${process.pid}.mp4`);
const FROM = Number(arg("--from") || 0), DUR = Number(arg("--dur") || (timing.duration - FROM));
const frames = Math.round(DUR * FPS);
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
  "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", silent], { stdio: ["pipe", "inherit", "inherit"] });
const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  await page.evaluate(t => window.render(t), FROM + i / FPS);
  const buf = await page.screenshot({ type: "jpeg", quality: 92 });
  if (i % 150 === 0) console.log(`frame ${i}/${frames} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
}
ff.stdin.end();
await new Promise(r => ff.on("close", r));
await browser.close();

const out = path.join(day, arg("--out") || "recap.mp4");
// voice on top, music bed ducked under the voice, louder on the end card
const hasSfx = fs.existsSync(path.join(day, "sfx.wav"));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, ...["voice.wav", "music.wav", ...(hasSfx ? ["sfx.wav"] : [])].flatMap(f => ["-ss", String(FROM), "-t", String(DUR), "-i", path.join(day, f)]),
  "-filter_complex",
  "[1:a]aresample=44100,pan=stereo|c0=c0|c1=c0,volume=1.5,asplit=2[v][vk];" +
  "[2:a]volume=0.45[m];[m][vk]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[md];" +
  (hasSfx ? "[3:a]aresample=44100[sx];[v][md][sx]amix=inputs=3:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]" : "[v][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]"),
  "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out], { stdio: "inherit" });
fs.unlinkSync(silent);
console.log("done", out, ((Date.now() - t0) / 1000).toFixed(0) + "s");
