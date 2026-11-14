// Run with:  node --test studio/test/      (no installs needed)
// Covers the parts that write to disk: edits, undo/redo, the change list, notes, and the write guard.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStudio } from "../server.mjs";
import * as store from "../lib/store.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
function tempDay() {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "studio-")), "testday");
  fs.mkdirSync(d);
  for (const f of ["script.json", "timing.json"]) fs.copyFileSync(path.join(repo, "examples/2026-11-04", f), path.join(d, f));
  return d;
}
const script = d => JSON.parse(fs.readFileSync(path.join(d, "script.json"), "utf8"));
const P = ["scenes", 1, "callouts", 0, "delta"];

test("edit, undo and redo a value", () => {
  const d = tempDay(), before = script(d).scenes[1].callouts[0].delta;
  assert.deepEqual(store.editScript(d, [{ op: "set", path: P, value: 9.9 }], "test").undo, 1);
  assert.equal(script(d).scenes[1].callouts[0].delta, 9.9);
  store.undo(d); assert.equal(script(d).scenes[1].callouts[0].delta, before);
  store.redo(d); assert.equal(script(d).scenes[1].callouts[0].delta, 9.9);
  assert.throws(() => store.redo(d), /Nothing to redo/);
});
test("a batch applies fully or not at all", () => {
  const d = tempDay(), raw = fs.readFileSync(path.join(d, "script.json"), "utf8");
  assert.throws(() => store.editScript(d, [{ op: "set", path: P, value: 1 }, { op: "set", path: ["scenes", 99, "text"], value: "x" }]));
  assert.equal(fs.readFileSync(path.join(d, "script.json"), "utf8"), raw);
});
test("refuses anything that is not a single existing value", () => {
  const d = tempDay();
  assert.throws(() => store.editScript(d, [{ op: "set", path: ["scenes", 1, "visual"], value: "x" }]), /single values/);          // would replace an object
  assert.throws(() => store.editScript(d, [{ op: "set", path: ["scenes", 1, "text"], value: { a: 1 } }]), /single values/);
  assert.throws(() => store.editScript(d, [{ op: "set", path: ["__proto__", "x"], value: 1 }]), /Bad edit/);
  assert.throws(() => store.editScript(d, [{ op: "set", path: ["scenes", 1, "visual", "series", 0, "pts", 9999], value: 1 }]), /Nothing at/);
  assert.throws(() => store.editScript(d, [{ op: "set", path: P, value: Infinity }]));
});
test("an optional field can be added and undo removes it again", () => {
  const d = tempDay(), p = ["scenes", 1, "callouts", 0, "approx"];
  assert.equal(script(d).scenes[1].callouts[0].approx, undefined);
  store.editScript(d, [{ op: "set", path: p, value: true }]); assert.equal(script(d).scenes[1].callouts[0].approx, true);
  store.undo(d); assert.equal("approx" in script(d).scenes[1].callouts[0], false);
});
test("change list compares against the delivered script and can be cleared", () => {
  const d = tempDay();
  assert.deepEqual(store.changes(d), []);
  store.editScript(d, [{ op: "set", path: P, value: 9.9 }]);
  const c = store.changes(d); assert.equal(c.length, 1); assert.deepEqual(c[0].path, P); assert.equal(c[0].to, 9.9);
  store.undo(d); assert.deepEqual(store.changes(d), []);
  store.redo(d); store.resetBaseline(d); assert.deepEqual(store.changes(d), []);
});
test("notes: add, update, delete, sorted by time", () => {
  const d = tempDay();
  store.changeNotes(d, "add", { t: 20, scene: "mega", text: "second" });
  const notes = store.changeNotes(d, "add", { t: 3.14159, scene: "title", text: "first" });
  assert.deepEqual(notes.map(n => n.text), ["first", "second"]); assert.equal(notes[0].t, 3.14);
  assert.equal(store.changeNotes(d, "update", { id: notes[0].id, done: true })[0].done, true);
  assert.equal(store.changeNotes(d, "delete", { id: notes[0].id }).length, 1);
  assert.throws(() => store.changeNotes(d, "add", { t: 1, text: "  " }), /Write the note/);
  assert.throws(() => store.changeNotes(d, "delete", { id: "nope" }), /not found/);
});

test("server: reads, guarded writes, no dot-folders, no path escape", async () => {
  const d = tempDay(); const s = await startStudio({ repo, extraDay: d, port: 0, quiet: true });
  try {
    const j = async (p, o) => { const r = await fetch(s.url + p, o); return { status: r.status, body: await r.json().catch(() => null) }; };
    const post = (p, body, headers = { "x-studio": "1" }) => j(p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const days = (await j("api/days")).body; assert.ok(days.days.includes("testday")); assert.ok(days.default);
    assert.equal((await j("api/day/testday")).body.history.undo, 0);
    // a write without the Studio header, or from another site, is refused
    assert.equal((await post("api/day/testday/script", { ops: [{ op: "set", path: P, value: 5 }] }, {})).status, 403);
    assert.equal((await post("api/day/testday/script", { ops: [{ op: "set", path: P, value: 5 }] }, { "x-studio": "1", origin: "https://example.com" })).status, 403);
    const ok = await post("api/day/testday/script", { ops: [{ op: "set", path: P, value: 5 }], label: "t" }); assert.equal(ok.status, 200); assert.equal(ok.body.undo, 1);
    assert.equal(script(d).scenes[1].callouts[0].delta, 5);
    assert.equal((await post("api/day/testday/script", { ops: [{ op: "set", path: ["nope", "x"], value: 5 }] })).status, 400);
    assert.equal((await post("api/day/testday/undo", {})).body.redo, 1);
    assert.equal((await post("api/day/testday/notes", { action: "add", note: { t: 2, text: "hi" } })).body.notes.length, 1);
    assert.equal((await j("api/day/testday/notes")).body.notes[0].text, "hi");
    assert.equal((await j("api/day/nope")).status, 404);
    assert.equal((await fetch(s.url + "day/testday/.studio/history.json")).status, 404);
    assert.equal((await fetch(s.url + "day/testday/..%2f..%2fpackage.json")).status, 403);
    assert.equal((await fetch(s.url + "js/main.js")).status, 200);
  } finally { await s.close(); }
});
test("server: read-only mode refuses every write", async () => {
  const d = tempDay(); const s = await startStudio({ repo, extraDay: d, port: 0, quiet: true, readOnly: true });
  try { const r = await fetch(s.url + "api/day/testday/notes", { method: "POST", headers: { "content-type": "application/json", "x-studio": "1" }, body: JSON.stringify({ action: "add", note: { t: 1, text: "x" } }) }); assert.equal(r.status, 403); }
  finally { await s.close(); }
});
