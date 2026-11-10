"""Own synthesized sound kit (no downloads): music bed from an existing CC0 track + pops, whooshes, thuds, ticks generated with numpy.
Usage: python3 -I sfx_synth.py <day-dir> <music.wav|mp3>
Writes <day>/music.wav (trimmed, faded) and <day>/sfx.wav. Cues: pop at each scene change, tick on chips, up/down blips, scene `sfx` kinds
(whoosh, whoosh2, thud, thud2, pop), bell on the end card. Used on days when the Kenney packs are not available."""
import json, os, subprocess, sys
import numpy as np, soundfile as sf
SR = 44100
rng = np.random.default_rng(7)
def load(p):
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", p, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"])
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
def env(n, a, d): t = np.arange(n) / SR; return np.minimum(1, t / a) * np.exp(-t / d)
def tone(f, n, a=.004, d=.08, f2=None):
    t = np.arange(n) / SR; fr = f if f2 is None else np.linspace(f, f2, n)
    return np.sin(2 * np.pi * np.cumsum(np.broadcast_to(fr, t.shape)) / SR) * env(n, a, d)
def pop(): return tone(520, int(.18 * SR), d=.05, f2=360) * .6
def tick(): return tone(1500, int(.08 * SR), a=.001, d=.015) * .35
def up(): return (tone(700, int(.22 * SR), d=.07, f2=1000) + .5 * tone(1400, int(.22 * SR), d=.05, f2=2000)) * .35
def dn(): return tone(300, int(.26 * SR), d=.09, f2=190) * .5
def thud(g=1): return (tone(90, int(.5 * SR), a=.002, d=.12, f2=45) + .15 * rng.standard_normal(int(.5 * SR)) * env(int(.5 * SR), .001, .02)) * .9 * g
def whoosh(n_s=.7, f=1.0):
    n = int(n_s * SR); x = rng.standard_normal(n); k = int(180 / f)
    x = np.convolve(x, np.ones(k) / k, "same") * 6
    t = np.arange(n) / n; return x * np.sin(np.pi * t) ** 1.5 * .5
def bell(): n = int(1.6 * SR); return sum(a * tone(f, n, a=.002, d=.5) for f, a in ((880, 1), (1320, .5), (2200, .25))) * .3
KINDS = {"pop": pop, "whoosh": whoosh, "whoosh2": lambda: whoosh(.55, 1.6), "thud": thud, "thud2": lambda: thud(.7)}
def main(day, music):
    T = json.load(open(os.path.join(day, "timing.json"))); S = json.load(open(os.path.join(day, "script.json")))
    dur = T["duration"]; n = int((dur + 1) * SR); m = load(music)
    if len(m) < n: m = np.concatenate([m, m[: n - len(m)]])
    m = m[:n].copy(); t = np.arange(n) / SR
    m *= np.minimum(1, t / 2.0)[:, None] * np.minimum(1, np.maximum(0, dur - t) / 3.0)[:, None]
    m /= max(1e-6, np.abs(m).max()); sf.write(os.path.join(day, "music.wav"), m * .8, SR)
    sfx = np.zeros((n, 2), dtype=np.float32)
    def put(at, s, g=1.0):
        i = int(max(0, at) * SR); j = min(n, i + len(s)); sfx[i:j, :] += (s[: j - i] * g)[:, None]
    W = lambda sc, key: next((w["t0"] for w in sc["words"] if "".join(c for c in w["w"].lower() if c.isalnum() or c == "&").startswith(key.lower())), sc["t0"] + .3)
    sj = {s["id"]: s for s in S["scenes"]}
    for k, sc in enumerate(T["scenes"]):
        if k: put(sc["t0"] - .1, pop(), .8)
        if sc["id"] == "end": put(sc["t0"] + 1.1, bell())
        s = sj.get(sc["id"], {})
        for c in s.get("callouts") or []:
            at = W(sc, c["at"]) if c.get("at") else sc["t0"] + .2
            d = c.get("delta"); put(at, up() if (d or 0) > 0 else dn() if (d or 0) < 0 else tick())
        for c in s.get("sfx") or []:
            f = KINDS.get(c["kind"])
            if f: put(W(sc, c["at"]) - .05, f(), .7)
        for it in (s.get("visual", {}).get("items") or []):
            if s["visual"].get("type") == "news" and it.get("at"): put(W(sc, it["at"]) - .1, whoosh(.45, 1.8), .5)
    sf.write(os.path.join(day, "sfx.wav"), sfx, SR)
if __name__ == "__main__": main(sys.argv[1], sys.argv[2])
