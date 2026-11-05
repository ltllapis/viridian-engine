"""Use an outside voiceover (e.g. ElevenLabs "Brian") instead of the local voice.

Usage: python3 align.py <day-dir> <voiceover.wav|mp3>
Reads <day>/script.json, finds each scene's start at the pause nearest its expected position,
then writes <day>/voice.wav, timing.json and music.wav (overwriting the local-voice versions).
The voiceover must read the scenes in order (narration.txt is the text to paste).
"""
import json, os, re, subprocess, sys
import numpy as np, soundfile as sf
sys.path.insert(0, os.path.dirname(__file__))
from voice import tokens, syll, music, LEAD

SR = 24000

def main(day, src):
    tmp = os.path.join(day, "_vo.wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", str(SR), tmp], check=True)
    a, _ = sf.read(tmp); os.remove(tmp)
    sc = json.load(open(os.path.join(day, "script.json")))
    env = np.convolve(np.abs(a), np.ones(480) / 480, "same")
    thr = max(0.004, np.percentile(env, 30) * 1.5)
    voiced = env > thr
    idx = np.where(voiced)[0]; s0, s1 = idx[0], idx[-1]
    # silent gaps (>=0.15 s) inside speech: candidate boundaries at their middle
    gaps, i = [], s0
    while i < s1:
        if not voiced[i]:
            j = i
            while j < s1 and not voiced[j]: j += 1
            if j - i > 0.15 * SR: gaps.append(((i + j) // 2, j - i))
            i = j
        i += 1
    toks = [tokens(s["text"]) for s in sc["scenes"]]
    w = np.array([sum(syll(sp) if sp else .6 for _, sp in t) + 2 for t in toks])
    exp = s0 + np.cumsum(w)[:-1] / w.sum() * (s1 - s0)
    bounds = [s0]
    for e in exp:  # nearest gap, preferring longer pauses, keeping order
        cands = [g for g in gaps if g[0] > bounds[-1] + 0.5 * SR]
        g = min(cands, key=lambda g: abs(g[0] - e) / SR - 0.6 * g[1] / SR)
        bounds.append(g[0])
    bounds.append(s1)
    shift = LEAD - s0 / SR
    timing = {"scenes": []}
    for k, s in enumerate(sc["scenes"]):
        b0, b1 = bounds[k], bounds[k + 1]
        seg = np.where(voiced[b0:b1])[0]
        v0, v1 = (b0 + seg[0]) / SR, (b0 + seg[-1]) / SR
        ww = []
        for shown, sp in toks[k]:
            x = syll(sp) if sp else .6
            if re.search(r"[,:;]$", shown): x += 1.6
            if re.search(r"[.!?]$", shown): x += 2.2
            ww.append(x)
        cum = np.concatenate([[0], np.cumsum(ww)]) / sum(ww)
        words = [{"w": sh, "t0": round(v0 + shift + cum[i] * (v1 - v0), 3), "t1": round(v0 + shift + cum[i + 1] * (v1 - v0), 3)} for i, (sh, _) in enumerate(toks[k])]
        t1 = (b1 / SR + shift) + (s.get("hold", 0) if k == len(sc["scenes"]) - 1 else 0)
        timing["scenes"].append({"id": s["id"], "t0": round(b0 / SR + shift - (0.15 if k else 0), 3), "t1": round(t1, 3), "words": words})
    out = np.concatenate([np.zeros(int(LEAD * SR)), a[s0:], np.zeros(int(1.5 * SR))])
    sf.write(os.path.join(day, "voice.wav"), out, SR)
    timing["duration"] = round(timing["scenes"][-1]["t1"] + 0.8, 3)
    json.dump(timing, open(os.path.join(day, "timing.json"), "w"), indent=1)
    m, msr = music(timing["duration"]); sf.write(os.path.join(day, "music.wav"), m, msr)
    for s in timing["scenes"]: print(s["id"], s["t0"], s["t1"])

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
