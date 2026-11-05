# The Viridian recap engine

This is our own video engine for the daily Wall Street recap. Every new video starts from what is here, so each day builds on the last one instead of starting over.

## What we built and own
| Piece | Where | What it does |
|---|---|---|
| Script format | `days/YYYY-MM-DD/script.json` | Scenes, the line spoken (`{shown|spoken}`), the visual for each scene, number chips (`callouts`), header tag, sound cues |
| Scene designs | `template/flat2.html` (cream, the standing look) | Hand-drawn flat vector art for each story (Capitol and fog gauge, cloud servers, V-shaped rebound, ramps, chips), header pills, number chips, captions, V-logo end card |
| Other looks | `flat3.html` (night), `flat3d.html` (3D glass), `flatveo.html` (generated-video backdrop), `lineart.html`, `scene.html` (neon) | Same script, different look; switch with `--scene` |
| Renderer | `template/render.mjs`, `template/render3d.mjs` (for 3D and backdrop pages) | Draws each frame at 30 fps, 1080x1920, mixes voice, music and sound effects, masters to about -14 LUFS, burns captions |
| Sound mix | `template/audiomix_generic.py` | Places whooshes, pops and thuds on the spoken numbers and scene cues; music ducks under the voice |
| Quality check | `template/qa.py` | Fails a day before render if a chip anchor word is missing, a spoken percent has no chip, a chip disagrees with the real chart line, narration differs from the timing, the disclaimer is missing, or art enters the bottom 16% (with `--pixels`); warns on loudness, length, too many spoken numbers |
| Live preview | `template/preview.mjs` + `preview.html` | `node template/preview.mjs days/<day>` opens a player (play, scrub, scene list, safe-zone guides, captions) that reloads when script, timing or a scene file changes |
| Cover | `template/cover.mjs`, `cover*.html` | Thumbnail image for each post |
| Voice | **viridian-voiceover** (`src/voice.py`, `config/voice.json`) | Free local voice (Kokoro `am_echo`), word timings that drive the chips and captions, voice check against the script, cleanup for a recording of Vince |
| Numbers | **viridian-market-data** | Daily data file and checker; every number on screen and in the voice must pass it |
| Brand | `template/assets/vc-logo.png`, fonts | Vince's V logo end card, Montserrat |

## What we borrow (free, open source, standard)
We rely on a few basic tools the whole industry uses, the way a carpenter buys a saw instead of forging one:
- **Chromium + Playwright** to draw the HTML pages into frames.
- **FFmpeg** to turn frames and audio into the MP4.
- **Kokoro** voice model (Apache-2.0) for the narration.
- **three.js** (MIT, copy in `template/vendor/three`) for the 3D look.
Optional paid add-ons: ElevenLabs (Starter plan) for Veo backdrop clips, music or sound effects. The engine works without them; they are never a dependency.

## Daily run (short version)
1. Gather and check the day's numbers (market-data checker).
2. Write `days/<day>/script.json`, `narration.txt`, `design-brief.md` from the closest earlier day.
3. Voice: `python3 voice.py <day>` (in viridian-voiceover), then `voice_check.py`.
4. Sound: `python3 template/audiomix_generic.py <day> <music> <sfx dirs>`.
4b. Run the quality check: `python3 -I template/qa.py days/<day> --pixels` (fix every FAIL; read every WARN).
5. Watch it live while editing: `node template/preview.mjs days/<day>`; check stills a second after each beat: `node template/render.mjs days/<day> --scene flat2.html --stills 3,12,20`.
6. Render plain and captioned cuts, then the cover and caption.
7. Push the day's files to the three repos (no mp4s; videos go in the Library).

## Backdrop clips (optional look)
`flatveo.html` plays frames from `template/_vbg/` behind the title, chips and captions. Make them from any 9:16 clip:
```
ffmpeg -i clip.mp4 -vf "fps=30,tpad=stop_mode=clone:stop_duration=3" -frames:v 210 -q:v 3 template/_vbg/f%04d.jpg
node template/render3d.mjs days/<day> --scene flatveo.html --captions --from 0 --dur 5 --out preview.mp4
```
Frames and clips are not committed (see `.gitignore`).

## Quality rules (what makes a video good)
- Every number spoken is on screen, and every number on screen was checked.
- Story first, question hook, about six spoken numbers at most.
- One clear picture per beat, tied to the spoken word. Never reuse one story's art for another.
- Safe zone: nothing important above y 125 or below y 785 (of 960).
- Ends with the V logo and "Entertainment only. Not financial advice."

## Roadmap: owning more of it
1. **Scene library catalog**: a page that shows every shape and scene we have drawn, so new days reuse and extend it.
2. **Story templates**: starting scripts for common days (rally, selloff, earnings, Fed decision, mixed day).
3. ~~Automatic quality check~~ done Nov 5 (`qa.py`). Added `--market-data ../viridian-market-data` (Nov 5): chips are compared with that repo's checked entry (`data/<date>.json`, or `data/manual/<date>.json` for hand-checked days); BLOCK fails, SINGLE-SOURCE warns.
4. **Our own sound kit**: an intro sting, music bed and effects made for the channel, so every video sounds like ours.
5. **Explainer segments**: short reusable "what is the VIX / what is a rate cut" scenes viewers can learn from.
6. **Automated data pull**: run the market-data Action daily once its secret is set.
