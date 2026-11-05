"""Check that a voice recording says the day's script: python3 -I voice_check.py <day-dir> <audio-file>
Transcribes offline with pocketsphinx (rough) and compares the non-number words with the script.
Prints PASS / CHECK / WRONG-SCRIPT, length vs expected, and per-scene keyword hits. Needs: pip install pocketsphinx."""
import difflib, json, os, re, subprocess, sys
from pocketsphinx import Decoder

def spoken(text):
    out = []
    for m in re.finditer(r"\{([^|}]*)\|([^}]*)\}|(\S+)", text):
        out.append(m.group(2) if m.group(1) is not None else m.group(3))
    return " ".join(out)

norm = lambda s: [w for w in re.findall(r"[a-z']+", s.lower().replace("&", " and ")) ]
day, audio = sys.argv[1], sys.argv[2]
S = json.load(open(os.path.join(day, "script.json")))
raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", audio, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"])
dur = len(raw) / 32000
d = Decoder(samprate=16000, loglevel="FATAL")
d.start_utt(); d.process_raw(raw, False, True); d.end_utt()
hyp = d.hyp().hypstr if d.hyp() else ""
want_scenes = [(sc["id"], spoken(sc["text"])) for sc in S["scenes"] if sc.get("text")]
want = []
for _, t in want_scenes:
    want += [w for w in norm(re.sub(r"\d[\d,.]*", " ", t))]
got = norm(hyp)
sm = difflib.SequenceMatcher(None, want, got, autojunk=False)
hit = sum(b.size for b in sm.get_matching_blocks())
ratio = hit / max(1, len(want))
print(f"length {dur:.1f}s | words matched {hit}/{len(want)} = {ratio:.0%}")
gs = set(got)
for sid, t in want_scenes:
    ws = [w for w in norm(re.sub(r"\d[\d,.]*", " ", t)) if len(w) > 4]
    h = sum(w in gs for w in ws)
    print(f"  {sid:6} key words heard {h}/{len(ws)}")
print("heard:", hyp[:300])
print("VERDICT:", "PASS" if ratio >= 0.65 else "CHECK" if ratio >= 0.5 else "WRONG-SCRIPT",
      "(pocketsphinx is rough: the right script scored 85%, Nov 2 audio against Nov 3 text scored 37%; read the 'heard' line when between)")
