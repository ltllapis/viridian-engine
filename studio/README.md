# Viridian Studio

Our own player for watching a recap video while it is being built. Zero dependencies: Node 18+ only. Free to run.

## Open it
```bash
node studio/server.mjs            # or: npm run studio
# then open http://localhost:4180/ in your browser
```
Pick a day in the top bar (every folder under `examples/` and `days/` with a `script.json` shows up). Open one directly with `?day=2026-11-04`.
To watch from another machine on your network: `node studio/server.mjs --host 0.0.0.0`.

## What you get
- **Player**: the real scene page (`template/flat*.html`) at phone size, with the voice, music and sfx playing in sync. Safe-zone guides and captions toggles.
- **Scene timeline**: one block per scene, sized by length, coloured by mood, with the voice waveform behind it. Click or drag to scrub.
- **Status strip**: what is being worked on now, the step it is on, and how long ago it updated.
- **Live refresh**: edit `script.json`, `timing.json`, the audio files or a scene page and the player reloads within about half a second, keeping your place and whether it was playing.
- **Side panel**: Scenes list, Script (current scene, word by word with the voice), Activity (what changed and when). Adjust and Notes tabs are placeholders for the next steps.

Keys: Space play/pause, left/right 1 s, `[` `]` scene, S safe zone, C captions.

## Feeding the status strip
Whoever builds the video (a script, or Claude) runs:
```bash
node studio/status.mjs examples/2026-11-04 --task "Fixing the TSLA chart" --steps "Script,Timing,Voice,Render" --at 3 --detail "re-aligning words"
node studio/status.mjs examples/2026-11-04 --done
node studio/status.mjs examples/2026-11-04 --error "voice.py failed"
```
This writes `status.json` in the day folder (it is a working file, not part of the video).

## How it is built (so the next steps slot in)
- `server.mjs`: static files, `/api/days`, `/api/day/<name>`, and `/events` (Server-Sent Events that announce file changes).
- `public/index.html`: the player. `window.Studio` exposes `panel({id,title,render,bind})` to add a tab, `on('time'|'scene'|'reload', fn)` and `seek(t)`.
- Next: **Adjust** is a panel that edits `script.json` through a small write endpoint (the watcher then refreshes the player). **Frame notes** is a panel plus a `notes.json` per day holding `{t, scene, text}`.
