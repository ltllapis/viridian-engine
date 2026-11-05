"""Music bed + sfx for ANY day, cues generated from script.json callouts (no hard-coded scene ids).
Usage: python3 -I audiomix_generic.py <day-dir> <music.mp3> <kenney-interface-dir> <kenney-impact-dir>
Cues: soft pop at each scene change, tick on number chips, rising ping on up chips, low blip on down chips, bell on end card."""
import json, os, subprocess, sys
import numpy as np, soundfile as sf
SR = 44100
def load(p):
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", p, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"])
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
def main(day, music, iface, impact):
    T = json.load(open(os.path.join(day, "timing.json"))); S = json.load(open(os.path.join(day, "script.json")))
    dur = T["duration"]; n = int(dur * SR)
    m = load(music)
    if len(m) < n: m = np.concatenate([m, m[: n - len(m)]])
    m = m[:n].copy(); t = np.arange(n) / SR
    m *= np.minimum(1, t / 2.0)[:, None] * np.minimum(1, np.maximum(0, dur - t) / 3.0)[:, None]
    m /= max(1e-6, np.abs(m).max()); sf.write(os.path.join(day, "music.wav"), m * 0.8, SR)
    sfx = np.zeros((n, 2), dtype=np.float32)
    def put(at, p, g):
        s = load(p)[: int(1.6 * SR)] * g; i = int(max(0, at) * SR); j = min(n, i + len(s)); sfx[i:j] += s[: j - i]
    I = lambda x: os.path.join(iface, x + ".wav"); X = lambda x: os.path.join(impact, x + ".ogg")
    W = lambda sc, key: next((w["t0"] for w in sc["words"] if "".join(ch for ch in w["w"].lower() if ch.isalnum() or ch == "&").startswith(key.lower())), sc["t0"] + .3)
    for k, sc in enumerate(T["scenes"]):
        if k: put(sc["t0"] - .1, I("maximize_003"), .5)
        if sc["id"] == "end": put(sc["t0"] + 1.1, X("impact_bell_heavy_001"), .45)
        for e in S["scenes"][k].get("sfx", []):
            kind = {"whoosh": (I, "maximize_006", .5), "whoosh2": (I, "scroll_003", .35), "thud": (X, "impact_soft_heavy_000", .7), "thud2": (X, "impact_soft_medium_001", .6), "pop": (I, "click_003", .5)}.get(e["kind"])
            if kind: put(W(sc, e["at"]) + e.get("o", 0), kind[0](kind[1]), kind[2])
        for c in S["scenes"][k].get("callouts", []):
            at = W(sc, c["at"]) if c.get("at") else sc["t0"] + .2
            d = c.get("delta")
            if c.get("num") is not None and d is None: put(at, I("tick_002"), .45)
            elif d is not None and d >= 0: put(at, I("confirmation_002"), .45)
            elif d is not None: put(at, I("error_003"), .3)
            else: put(at, I("tick_002"), .4)
    sf.write(os.path.join(day, "sfx.wav"), np.clip(sfx, -1, 1), SR); print("music + sfx written", round(dur, 1), "s")
if __name__ == "__main__": main(*sys.argv[1:5])
