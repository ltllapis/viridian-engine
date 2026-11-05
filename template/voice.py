"""Voice + timing + music bed for a daily recap.

Modes: default Kokoro (script voice, e.g. am_fenrir); --splice or "voice":"vince-splice" builds it from Vince's recorded clips; --coverage lists words missing from his clip library.

Usage: python3 voice.py <day-dir>   (reads script.json, writes voice.wav, music.wav, timing.json)
Display text uses {shown|spoken} for words that should be read differently from how they show.
"""
import json, re, sys, os
import numpy as np, soundfile as sf

SR = 24000
GAP = 0.28          # silence between scenes
LEAD = 0.5          # silence before first line
MODELS = os.environ.get("KOKORO_MODELS", "/mnt/project-files/video-maker/models")  # folder with kokoro-v1.0.onnx and voices-v1.0.bin

def tokens(text):
    out = []
    for m in re.finditer(r"\{([^|}]*)\|([^}]*)\}|(\S+)", text):
        if m.group(3):
            out.append((m.group(3), m.group(3)))
        else:
            out.append((m.group(1), m.group(2)))
    # a {shown|spoken} group may hold several shown words; split them, share spoken weight
    res = []
    for shown, spoken in out:
        parts = shown.split()
        for i, p in enumerate(parts):
            res.append((p, spoken if i == 0 else ""))
    return res

def syll(w):
    w = re.sub(r"[^a-z0-9]", " ", w.lower())
    n = 0
    for word in w.split():
        if word.isdigit():
            n += len(word) * 1.2
            continue
        n += max(1, len(re.findall(r"[aeiouy]+", word)) - (1 if word.endswith("e") and len(word) > 3 else 0))
    return n

def speech_bounds(a, thr=0.01):
    env = np.convolve(np.abs(a), np.ones(240) / 240, "same")
    idx = np.where(env > thr)[0]
    return (idx[0], idx[-1]) if len(idx) else (0, len(a))

def music(dur, sr=44100):
    """Soft synth pad + muted pulse, in A minor-ish, slow chord changes."""
    t = np.arange(int(dur * sr)) / sr
    chords = [[220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66], [164.81, 207.65, 246.94]]
    out = np.zeros_like(t)
    seg = 4.0
    for i, ch in enumerate(chords * int(dur // (seg * 4) + 2)):
        s, e = i * seg, (i + 1) * seg + 1.5
        if s > dur: break
        m = (t >= s) & (t < e)
        tt = t[m] - s
        env = np.minimum(1, tt / 1.2) * np.minimum(1, np.maximum(0, (e - s - tt)) / 1.5)
        for f in ch + [ch[0] / 2]:
            for det in (-0.6, 0.6):
                out[m] += env * 0.06 * np.sin(2 * np.pi * (f + det) * tt + det)
    # pulse: filtered kick-ish thump every beat at 100 bpm
    beat = 60 / 100
    for k in np.arange(0, dur, beat):
        i0 = int(k * sr); n = int(0.18 * sr)
        if i0 + n > len(out): break
        tt = np.arange(n) / sr
        out[i0:i0 + n] += 0.22 * np.sin(2 * np.pi * (55 + 40 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 18)
        h0 = i0 + int(beat / 2 * sr)
        if h0 + 2000 < len(out):
            out[h0:h0 + 2000] += 0.02 * np.random.randn(2000) * np.exp(-np.arange(2000) / 300)
    fade = np.minimum(1, t / 1.5) * np.minimum(1, (dur - t) / 2.5)
    out *= fade
    out /= np.max(np.abs(out)) + 1e-9
    return np.stack([out, out], 1) * 0.5, sr

def polish(path, fx=None):
    """Broadcast polish keeping duration identical. fx (script.json "fx": {pitch, eq: low|mid, echo}) gives the urban radio sound
    (Vince's pick, Nov 4: am_fenrir, speed 1.10, pitch -0.5, eq mid, echo)."""
    import subprocess
    tmp = path + ".tmp.wav"
    if fx:
        low = fx.get("eq") == "low"
        af = (f"rubberband=pitch={2 ** (fx.get('pitch', 0) / 12):.4f},highpass=f=65,equalizer=f=100:t=q:w=1:g={4 if low else 2.5},"
              "equalizer=f=2800:t=q:w=1.1:g=2.5,equalizer=f=7500:t=q:w=2:g=-2,acompressor=threshold=-22dB:ratio=4:attack=8:release=120:makeup=4"
              + (",aecho=0.8:0.85:55:0.12" if fx.get("echo") else ""))
    else:
        af = "highpass=f=70,equalizer=f=120:t=q:w=1:g=2,equalizer=f=3500:t=q:w=1.2:g=1.5,acompressor=threshold=-20dB:ratio=3:attack=15:release=150:makeup=3"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", path, "-af", af, "-ar", str(SR), tmp], check=True)
    os.replace(tmp, path)

# ---------------- splice mode: Vince's own voice, built from his recorded clips ----------------
# Use: set "voice": "vince-splice" in script.json (or pass --splice). Clips live in CLIPDIR (recaps/voice-samples/vince/clips).
# Every spoken word must exist in the clip library; run with --coverage to list missing words per scene.
CLIPDIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "voice-samples", "vince", "clips")
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()

def num_words(n):
    if n < 20: return [ONES[n]]
    if n < 100: return [TENS[n // 10]] + ([ONES[n % 10]] if n % 10 else [])
    if n < 1000: return [ONES[n // 100], "hundred"] + (num_words(n % 100) if n % 100 else [])
    if n < 1000000: return num_words(n // 1000) + ["thousand"] + (num_words(n % 1000) if n % 1000 else [])
    return num_words(n // 1000000) + ["million"] + (num_words(n % 1000000) if n % 1000000 else [])

def norm_tokens(text):
    t = text.lower().replace("s&p", "s and p").replace("&", " and ").replace("%", " percent ")
    t = re.sub(r"(?<=\d),(?=\d{3})", "", t)
    t = t.replace("'", "").replace("’", "")
    return re.findall(r"\d+\.\d+|\d+|[a-z]+", t)

def load_clips():
    import subprocess
    lib = {}
    for f in sorted(os.listdir(CLIPDIR)):
        if not f.endswith(".wav"): continue
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", os.path.join(CLIPDIR, f), "-ar", str(SR), "-ac", "1", "-f", "f32le", "-"], capture_output=True, check=True).stdout
        a = np.frombuffer(raw, dtype=np.float32).copy()
        b0, b1 = speech_bounds(a, 0.004)
        a = a[max(0, b0 - 300): b1 + 700]
        rms = np.sqrt(np.mean(a ** 2)) + 1e-9
        a = a * min(0.1 / rms, 0.95 / (np.max(np.abs(a)) + 1e-9))   # even loudness across clips
        lib[tuple(norm_tokens(f[:-4].replace("-", " ")))] = a
    return lib

def expand(pairs, lib):
    """pairs: [(word, shown_index)]. Greedy longest phrase match across the whole scene; digits become number words.
    Returns ([(clip key, shown_index)], missing words)."""
    maxn = max(len(k) for k in lib)
    out, missing, i = [], [], 0
    pairs = list(pairs)
    while i < len(pairs):
        for n in range(min(maxn, len(pairs) - i), 0, -1):
            k = tuple(w for w, _ in pairs[i:i + n])
            if k in lib:
                out.append((k, [ix for _, ix in pairs[i:i + n]])); i += n; break
        else:
            tk, ix = pairs[i]
            if re.fullmatch(r"\d+\.\d+", tk):
                ip, fp = tk.split(".")
                pairs[i:i + 1] = [(w, ix) for w in num_words(int(ip)) + ["point"] + [ONES[int(c)] for c in fp]]
            elif tk.isdigit():
                pairs[i:i + 1] = [(w, ix) for w in num_words(int(tk))]
            else:
                missing.append(tk); i += 1
    return out, missing

def splice_main(day, coverage_only=False):
    sc = json.load(open(os.path.join(day, "script.json")))
    lib = load_clips()
    plans, bad = [], {}
    for s in sc["scenes"]:
        toks = tokens(s["text"])
        pairs = [(w, i) for i, (_, sp) in enumerate(toks) if sp for w in norm_tokens(sp)]
        placed, miss = expand(pairs, lib)
        plans.append((toks, placed))
        if miss: bad[s["id"]] = miss
    if bad:
        print("MISSING WORDS (record these to use splice mode):")
        for sid, ws in bad.items(): print(f"  {sid}: {', '.join(sorted(set(ws)))}")
        if not coverage_only: raise SystemExit("splice mode needs every word recorded; see list above")
    if coverage_only:
        print("coverage:", "complete" if not bad else "incomplete"); return
    gap_w, gap_c, gap_s = 0.07, 0.16, 0.30
    audio = [np.zeros(int(LEAD * SR))]; t = LEAD; timing = {"scenes": []}
    for s, (toks, placed) in zip(sc["scenes"], plans):
        t0 = t; starts = {}; ends = {}
        for k, ixs in placed:
            a = lib[k]; ix = ixs[-1]; d = len(a) / SR
            for j, x in enumerate(ixs): starts.setdefault(x, t + d * j / len(ixs))   # spread the phrase's words across its clip
            audio.append(a); t += d
            audio.append(np.zeros(int(gap_w * SR))); t += gap_w; ends[ix] = t
            shown = toks[ix][0]
            if re.search(r"[,:;]$", shown): audio.append(np.zeros(int(gap_c * SR))); t += gap_c; ends[ix] = t
            if re.search(r"[.!?]$", shown): audio.append(np.zeros(int(gap_s * SR))); t += gap_s; ends[ix] = t
        words, last = [], t0
        for i, (shown, _) in enumerate(toks):
            w0 = starts.get(i, last); w1 = ends.get(i, w0); last = max(last, w1)
            words.append({"w": shown, "t0": round(w0, 3), "t1": round(w1, 3)})
        for j in range(len(words) - 1):   # words inside one phrase clip end where the next begins
            if words[j]["t1"] <= words[j]["t0"]: words[j]["t1"] = max(words[j]["t0"], words[j + 1]["t0"])
        hold = s.get("hold", 0) + GAP
        audio.append(np.zeros(int(hold * SR))); t += hold
        timing["scenes"].append({"id": s["id"], "t0": round(t0, 3), "t1": round(t, 3), "words": words})
    v = np.concatenate(audio)
    sf.write(os.path.join(day, "voice.wav"), v, SR)
    timing["duration"] = round(t + 0.6, 3)
    json.dump(timing, open(os.path.join(day, "timing.json"), "w"), indent=1)
    m, msr = music(timing["duration"])
    sf.write(os.path.join(day, "music.wav"), m, msr)
    print("splice duration", timing["duration"])

def main(day):
    sc = json.load(open(os.path.join(day, "script.json")))
    if "--coverage" in sys.argv: return splice_main(day, True)
    if sc.get("voice") == "vince-splice" or "--splice" in sys.argv: return splice_main(day)
    from kokoro_onnx import Kokoro
    full = f"{MODELS}/kokoro-v1.0.onnx"   # full-precision model sounds cleaner than int8 (GitHub release model-files-v1.0)
    k = Kokoro(full if os.path.exists(full) else f"{MODELS}/kokoro-v1.0.int8.onnx", f"{MODELS}/voices-v1.0.bin")
    vname = sc.get("voice", "am_michael")
    if "+" in vname:   # blend, e.g. "am_onyx+am_michael" (equal mix)
        vs = vname.split("+"); vname = sum(k.get_voice_style(x) for x in vs) / len(vs)
    audio = [np.zeros(int(LEAD * SR))]
    t = LEAD
    timing = {"scenes": []}
    for s in sc["scenes"]:
        toks = tokens(s["text"])
        spoken = " ".join(sp for _, sp in toks if sp)
        a, sr = k.create(spoken, voice=vname, speed=sc.get("speed", 1.0), lang="en-us")
        assert sr == SR
        b0, b1 = speech_bounds(a)
        a = a[max(0, b0 - 600): b1 + 1200]
        dur = len(a) / SR
        # word weights
        w = []
        for shown, sp in toks:
            wt = syll(sp) if sp else 0.6
            if re.search(r"[,:;]$", shown): wt += 1.6
            if re.search(r"[.!?]$", shown): wt += 2.2
            w.append(wt)
        w = np.array(w); cum = np.concatenate([[0], np.cumsum(w)]) / w.sum()
        speak0 = t + 0.03
        span = dur - 0.08
        words = [{"w": shown, "t0": round(speak0 + cum[i] * span, 3), "t1": round(speak0 + cum[i + 1] * span, 3)} for i, (shown, _) in enumerate(toks)]
        hold = s.get("hold", 0)
        timing["scenes"].append({"id": s["id"], "t0": round(t, 3), "t1": round(t + dur + GAP + hold, 3), "words": words})
        audio += [a, np.zeros(int((GAP + hold) * SR))]
        t += dur + GAP + hold
    v = np.concatenate(audio)
    sf.write(os.path.join(day, "voice.wav"), v, SR)
    polish(os.path.join(day, "voice.wav"), sc.get("fx"))
    timing["duration"] = round(t + 0.6, 3)
    json.dump(timing, open(os.path.join(day, "timing.json"), "w"), indent=1)
    m, msr = music(timing["duration"])
    sf.write(os.path.join(day, "music.wav"), m, msr)
    print("duration", timing["duration"])

if __name__ == "__main__":
    main(sys.argv[1])
