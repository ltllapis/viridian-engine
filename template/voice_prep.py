"""Prepare the voiceover brief for a day: python3 -I voice_prep.py <day-dir>
Writes <day>/voiceover-script.txt: the exact text to paste into a voice tool (spoken form, one paragraph,
no markup) plus a per-scene breakdown and delivery notes. Source of truth is script.json scenes[].text."""
import json, os, re, sys

def spoken(text):
    out = []
    for m in re.finditer(r"\{([^|}]*)\|([^}]*)\}|(\S+)", text):
        out.append(m.group(2) if m.group(1) is not None else m.group(3))
    return re.sub(r"\s+([.,;:!?])", r"\1", " ".join(out)).strip()

day = sys.argv[1]
S = json.load(open(os.path.join(day, "script.json")))
lines = [(sc["id"], spoken(sc["text"])) for sc in S["scenes"] if sc.get("text")]
full = " ".join(t for _, t in lines)
words = len(full.split())
with open(os.path.join(day, "voiceover-script.txt"), "w") as f:
    f.write("PASTE THIS EXACT TEXT INTO THE VOICE TOOL (voice: Brian)\n" + "=" * 56 + "\n\n" + full + "\n\n")
    f.write("=" * 56 + f"\nWords: {words}. Target length about {words / 2.5:.0f} to {words / 2.1:.0f} seconds at a calm newsreader pace.\n")
    f.write("Delivery: calm, steady, confident newsreader. Small pause after each sentence. Read numbers as written (51,787 is fifty-one thousand seven hundred eighty-seven). Do not add or change words.\n\n")
    f.write("Per-scene breakdown (for checking, not for pasting):\n")
    for i, t in lines:
        f.write(f"  [{i}] {t}\n")
print(f"wrote {day}/voiceover-script.txt ({words} words)")
