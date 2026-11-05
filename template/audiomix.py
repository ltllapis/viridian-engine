"""Build the music bed and sound-effect track from free CC0 files.

Usage: python3 -I audiomix.py <day-dir> <music.mp3> <kenney-interface-dir> <kenney-impact-dir>
Writes <day>/music.wav (trimmed, faded) and <day>/sfx.wav (cues at scene changes and key words).
Sources (all CC0): Kenney Interface Sounds + Impact Sounds; music from effacestudios/Royalty-Free-Music-Pack.
"""
import json, os, subprocess, sys
import numpy as np, soundfile as sf

SR = 44100

def load(path):
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", path, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"])
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)

def main(day, music_path, iface, impact):
    T = json.load(open(os.path.join(day, "timing.json")))
    dur = T["duration"]
    n = int(dur * SR)
    m = load(music_path)
    if len(m) < n:
        m = np.concatenate([m, m[: n - len(m)]])
    m = m[:n].copy()
    t = np.arange(n) / SR
    m *= np.minimum(1, t / 2.0)[:, None] * np.minimum(1, np.maximum(0, (dur - t)) / 3.0)[:, None]
    m /= max(1e-6, np.abs(m).max())
    sf.write(os.path.join(day, "music.wav"), m * 0.8, SR)

    sfx = np.zeros((n, 2), dtype=np.float32)
    def put(at, path, gain):
        s = load(path)[: int(1.6 * SR)] * gain
        i = int(max(0, at) * SR)
        j = min(n, i + len(s))
        sfx[i:j] += s[: j - i]

    W = lambda sc, key: next((w["t0"] for w in sc["words"] if w["w"].lower().strip(".,:;").startswith(key)), sc["t0"] + .3)
    ids = {s["id"]: s for s in T["scenes"]}
    I = lambda n: os.path.join(iface, n + ".wav")
    X = lambda n: os.path.join(impact, n + ".ogg")
    # scene changes: soft pop as each new illustration arrives
    for k, s in enumerate(T["scenes"][1:], 1):
        put(s["t0"] - .1, I("maximize_003"), .55)
    put(ids["title"]["t0"] + .55, I("drop_002"), .5)                  # ballot drops in
    put(W(ids["dow"], "slipped"), I("error_003"), .35)                 # Dow down
    put(W(ids["stack"], "rose"), I("confirmation_002"), .5)            # S&P up
    put(W(ids["stack"], "gained"), I("confirmation_003"), .5)          # Nasdaq up
    put(ids["chips"]["t0"] + .4, X("impact_metal_light_001"), .35)     # chip lands
    put(W(ids["nvda"], "climbed"), I("pluck_001"), .55)
    put(W(ids["nvda"], "added"), I("pluck_002"), .55)
    put(W(ids["orcl"], "rebounded"), I("confirmation_001"), .55)
    put(W(ids["aapl"], "slid"), I("error_002"), .35)
    put(W(ids["amd"], "jumped"), X("impact_glass_light_002"), .5)
    put(W(ids["amd"], "jumped") + .05, I("confirmation_004"), .45)
    put(W(ids["ahead"], "options"), I("tick_002"), .5)
    put(ids["end"]["t0"] + 1.1, X("impact_bell_heavy_001"), .45)
    sf.write(os.path.join(day, "sfx.wav"), np.clip(sfx, -1, 1), SR)
    print("music + sfx written,", round(dur, 1), "s")

if __name__ == "__main__":
    main(*sys.argv[1:5])
