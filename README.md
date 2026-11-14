# Viridian engine

Our own engine for the daily Wall Street recap videos (vertical 1080x1920, 30 fps) for TikTok and Instagram. It turns one `script.json` plus word timings and a voice into a finished video, with real intraday charts, number chips, captions, camera motion, sound mix and a quality gate. Everything here is ours except a few standard open-source tools listed in `THIRD-PARTY.md`.

Entertainment only. Not financial advice.

## What is in here
| Folder | What |
|---|---|
| `template/` | Scene pages (`flat5.html`, the 3D cream world, is the current look since Nov 14 2026; `flat4.html` is the earlier flat look, `flat2.html` the illustrated base), renderer (`render.mjs`), sound mix (`audiomix_generic.py`), cover maker, voice tools (`voice.py`, `align.py`, `voice_check.py`), quality check (`qa.py`), live preview (`preview.mjs`) |
| `examples/2026-11-04/` | A complete finished day: script, timing, voice, music, sfx, data check, caption, real intraday bars |
| `market-data/` | The numbers checker (`check.py`, `CHECKER-RULES.md`) and the hand-checked Nov 4 entry. The daily job lives in the separate `viridian-market-data` repo |
| `docs/ENGINE.md` | How the engine works, the daily run, quality rules and the roadmap |

## Quick start
```bash
npm install && npx playwright install chromium     # one time (also needs ffmpeg and python3 with numpy, soundfile, pillow)
python3 -I template/qa.py examples/2026-11-04 --market-data market-data --pixels
node template/preview.mjs examples/2026-11-04       # simple live player at http://localhost:4173
node studio/server.mjs                              # Viridian Studio at http://localhost:4180 (timeline, status strip, live refresh; see studio/README.md)
node template/render.mjs examples/2026-11-04 --captions --out recap.mp4   # flat5.html by default; add --scene flat4.html for the older flat look
```
Stills for checking a beat: `node template/render.mjs <day> --captions --stills 3,12,22`.

## A day's files
`script.json` (scenes, visuals, number chips, sound cues), `timing.json` (word times from the real voice), `voice.wav`, `music.wav`, `sfx.wav`, `narration.txt`, `post-caption.txt`, `data-check.md`, `intraday.json` (real bars the chart scenes draw).

## Voice
The standing voice is ElevenLabs "Adam" (a paid plan; narration is generated per day and timed with pocketsphinx). The free fallback is Kokoro (`template/voice.py`, set `KOKORO_MODELS` to the folder holding `kokoro-v1.0.onnx` and `voices-v1.0.bin`). See `docs/ENGINE.md`.

## Rules the engine enforces
Every spoken percent has a chip, every chip matches the real chart and the checked data, nothing sits in the bottom 16% (app buttons), the disclaimer is present, and loudness lands near -14 LUFS. `qa.py` fails the run otherwise.

## License
Not chosen yet (the owner decides before the repo goes public). Until then all rights are reserved by the owner.
