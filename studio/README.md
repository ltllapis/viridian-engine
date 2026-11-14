# Viridian Studio

Our own tool for watching a recap video while it is built, adjusting it yourself, and leaving notes on frames.
Zero dependencies: Node 18+ only. Free to run. Everything stays on your computer.

## Open it
- **Windows**: double-click `Start Studio.bat` in the main folder.
- **Mac**: double-click `Start Studio.command`.
- **Any**: `node studio/server.mjs --open` (or `npm run studio`), then http://localhost:4180/

Keep the black window open while you use Studio. Close it (or Ctrl+C) to stop.
Every folder under `examples/` and `days/` that has a `script.json` shows in the Day menu.

## What you can do
| | |
|---|---|
| **Watch** | The real scene page at phone size with voice, music and sfx in sync. Scene timeline with the voice waveform; click or drag to scrub. Safe-zone and caption toggles. |
| **Status strip** | What is being worked on now, which step, and how long ago it updated. |
| **Live refresh** | When a file of the day or a scene page changes, the player reloads in under a second and keeps your place. |
| **Adjust** | Change any single value of the video: narration, chip numbers and labels, colours, sounds, ticker, date. The player shows it at once. **Save** writes it to `script.json`; **Undo/Redo** step through saved changes. |
| **Notes** | Pause on a frame, write what should change, and it is pinned to the timeline and saved in `notes.json`. |
| **Send to Claude** | One button collects your saved changes and open notes as text to paste into the chat. |

Keys: Space play/pause, ←/→ 1 s (Shift for 0.1 s), `[` `]` scene, N new note, Ctrl+S save, S safe zone, C captions.

### What Adjust can and cannot do
- It edits `script.json`, so the **picture** follows straight away.
- The **voice** is a recording. If you change the narration, the scene is marked "needs new voice": Claude has to make a new take and timing.
- Numbers you change are not re-checked against market data here. `qa.py` still does that before a render.
- Chart points (the real price bars), scene ids and picture types are shown but not editable.
- The finished MP4 is still made by `template/render.mjs`.

## Feeding the status strip
```bash
node studio/status.mjs examples/2026-11-04 --task "Fixing the TSLA chart" --steps "Script,Timing,Voice,Render" --at 3 --detail "re-aligning words"
node studio/status.mjs examples/2026-11-04 --done
node studio/status.mjs examples/2026-11-04 --error "voice.py failed"
```

## Options
`--port 4181` another port · `--host 0.0.0.0` reachable from your network (anyone on it can then edit, so add `--read-only` unless you trust it) · `--read-only` watch only · a folder path as the first argument adds that day.

## Files Studio writes (all inside the day folder)
| File | What |
|---|---|
| `script.json` | Your saved adjustments (single values only, written atomically) |
| `notes.json` | Frame notes: `{notes:[{id,t,scene,text,done,created}]}` |
| `.studio/history.json` | Undo/redo steps (last 200) |
| `.studio/baseline.json` | The script as delivered, used to list "what changed" |
| `status.json` | Written by `status.mjs`, read by the status strip |

`.studio/` and `status.json` are ignored by git.

## How it is built
```
studio/
  server.mjs          routes, file watching (SSE), write guard. Exports startStudio() for tests
  lib/store.mjs       the only code that writes: edits, undo/redo, change list, notes
  status.mjs          command line for the status strip
  public/
    index.html, studio.css
    js/core.js        state, event bus, server calls, the draft (unsaved edits)
    js/player.js      scene iframe, audio sync, frame loop
    js/timeline.js    scene blocks, waveform, pins
    js/status.js      status strip        js/live.js   live refresh
    js/handoff.js     "Send to Claude"
    js/panels/        one file per tab: basic.js (Scenes, Script, Activity), adjust.js, notes.js
    js/main.js        start-up, tabs, keyboard
  test/               studio.test.mjs (no installs), browser.smoke.mjs (needs Playwright)
```

### Server API
| | |
|---|---|
| `GET /api/days` | `{days, default, version}` |
| `GET /api/day/<d>` | scene files, file times, status, history counts, notes count |
| `GET /api/day/<d>/notes`, `/changes` | notes list; changes since delivery |
| `POST /api/day/<d>/script` | `{ops:[{op:"set", path:[...], value}], label}`; all or nothing |
| `POST /api/day/<d>/undo`, `/redo`, `/changes/reset` | |
| `POST /api/day/<d>/notes` | `{action:"add"|"update"|"delete", note}` |
| `GET /events` | Server-Sent Events: `{type:"change", changes:[{day,file,scope}]}` |

Writes need the header `x-studio: 1` and a same-origin request, so another website open in your browser cannot edit your files.

### Adding a feature
A feature is one module that imports `core.js` and registers itself; add one `import` line in `main.js`.
```js
import { S, Studio } from "../core.js";
Studio.panel({ id: "mine", title: "Mine", render: () => "<p>hello</p>", bind(root) {}, badge: () => null,
               onScene(root, i) {}, onTime(root, t) {} });
Studio.on("loaded", () => {});            // also: time, scene, draft, saved, notes, files, status, activity
Studio.edit(["scenes", 1, "tag"], "NEW"); // goes through the draft, save, undo
Studio.setMarkers("mine", [{ t: 12.3, title: "pin" }]);
```
To give a new script field a friendly name, add it to `FIELD` in `js/panels/adjust.js`. Unknown fields already work under their raw name.
A new kind of write goes in `lib/store.mjs` plus one line in `ACTIONS` in `server.mjs`, with a test.

### Tests
```bash
npm run studio:test                      # edits, undo, notes, write guard (no installs)
node studio/test/browser.smoke.mjs       # drives the real page (needs Playwright)
```

## Ideas for later versions
Drag chips and labels on the picture · trim scene lengths on the timeline · "Run quality check" and "Render" buttons with progress in the status strip · snapshot a frame into a note · compare two versions side by side · rebuild the voice for one scene from inside Studio.
