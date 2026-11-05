// Render the cover: node cover.mjs <day-dir> [--scene cover.html] [--out cover.png]
// Edit the headline, pills and subtitle text in cover.html (or a copy) before rendering.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const day = path.resolve(process.argv[2]);
const arg = k => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
p.on("pageerror", e => console.log("PAGE ERROR", e.message));
await p.goto("file://" + path.join(here, arg("--scene") || "cover.html"));
await p.evaluate(async () => { await document.fonts.ready; });
await p.waitForTimeout(900);
await p.screenshot({ path: path.join(day, arg("--out") || "cover.png") });
await b.close();
