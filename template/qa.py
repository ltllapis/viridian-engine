#!/usr/bin/env python3
"""Quality check for a recap day. Fails (exit 1) when something is wrong, so a bad video never ships.

Usage:  python3 -I template/qa.py days/2026-11-04            # data and timing checks (fast, no render)
        python3 -I template/qa.py ../2026-11-04-v6 --pixels  # also renders stills and checks the safe zone
        python3 -I template/qa.py <day> --video recap.mp4    # also checks loudness and length of a finished cut
        python3 -I template/qa.py <day> --market-data ../viridian-market-data   # compare chips with the market-data repo's checked numbers

Checks (FAIL stops the run, WARN is for a human to look at):
  files     script.json, timing.json, voice.wav, narration.txt, data-check.md, post-caption.txt present
  timing    every script scene has timing, scenes run in order, words move forward, voice length matches
  anchors   every chip/sfx `at` word really exists in that scene's spoken words (a typo silently pops a chip at the scene start)
  chips     max 4 per scene; every percent the voice says has a chip showing it (within rounding); chips carry no spoken-number mismatch
  charts    a chip's percent must match the real chart line (last bar vs previous close), same direction
  narration narration.txt equals the spoken words in timing.json
  market    (with --market-data) every chip percent/close equals the checked entry for that date; BLOCK entries FAIL, SINGLE-SOURCE entries WARN
  news      (from 2026-11-09) a `news` scene with 1-3 headlines; days/<day>/news.json lists each with at least TWO different sources (name + url); every item's `at` word is spoken; headline lines fit the card; no digit in a headline the voice does not say
  rules     disclaimer present, numbers spoken per video, video length, safe zone pixels, loudness
"""
import json, os, re, subprocess, sys, wave

NUMW = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split())}
TENS = {w: 10 * (i + 2) for i, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split())}
DISCLAIMER = "entertainment only. not financial advice."
res = {"FAIL": [], "WARN": [], "OK": []}


def say(level, msg):
    res[level].append(msg)


def norm(w):
    return re.sub(r"[^\w&]", "", w).lower()


def spoken_numbers(words):
    """[(value, index_of_next_word)] for digit tokens and number words; 'fifteen hundred' -> 1500."""
    out, i, n = [], 0, len(words)
    toks = [norm(w) for w in words]
    while i < n:
        t = toks[i]
        v = None
        if re.fullmatch(r"\d+", t):
            raw = words[i].replace(",", "")
            m = re.match(r"\d+(\.\d+)?", raw.strip(".,?!;:"))
            v = float(m.group(0)) if m else float(t)
            j = i + 1
            if j < n and toks[j] in ("point",) and j + 1 < n and re.fullmatch(r"\d+", toks[j + 1]):
                v = float(f"{int(t)}.{toks[j + 1]}"); j += 2
        elif t in NUMW:
            v, j = NUMW[t], i + 1
            if t in ("zero",): v = 0
        elif t in TENS:
            v, j = TENS[t], i + 1
            if j < n and toks[j] in NUMW and 0 < NUMW[toks[j]] < 10:
                v += NUMW[toks[j]]; j += 1
        if v is not None:
            if j < n and toks[j] == "hundred":
                v *= 100; j += 1
            if j < n and toks[j] in ("thousand", "million", "billion"):
                v *= {"thousand": 1e3, "million": 1e6, "billion": 1e9}[toks[j]]; j += 1
            out.append((v, j, i)); i = j
        else:
            i += 1
    return out


def wav_len(p):
    with wave.open(p) as w:
        return w.getnframes() / w.getframerate()


def chips_of(sc):
    return sc.get("callouts") or []


def chip_pct(c):
    """The percent a chip shows, or None."""
    return abs(c["delta"]) if c.get("delta") is not None else None


def series_of(vis):
    if vis.get("type") == "schart":
        return []
    if vis.get("series"):
        return [(s.get("tag") or "", s) for s in vis["series"]]
    if vis.get("cards") and vis["cards"][0].get("pts"):
        return [(c.get("title") or c.get("sym") or "", c) for c in vis["cards"]]
    return []


def chart_move(s):
    return (s["pts"][-1] / s["base"] - 1) * 100


def check(day, pixels=False, video=None, mdata=None):
    f = lambda n: os.path.join(day, n)
    for n in ("script.json", "timing.json", "narration.txt"):
        if not os.path.exists(f(n)):
            say("FAIL", f"missing {n}")
    if res["FAIL"]:
        return
    S = json.load(open(f("script.json"))); T = json.load(open(f("timing.json")))
    for n in ("voice.wav", "data-check.md", "post-caption.txt"):
        if not os.path.exists(f(n)):
            say("WARN" if n != "voice.wav" else "FAIL", f"missing {n}")
    ts = {s["id"]: s for s in T["scenes"]}
    total_spoken_nums = 0

    # timing
    ids = [s["id"] for s in S["scenes"]]
    if ids != [s["id"] for s in T["scenes"]]:
        say("FAIL", f"scene ids differ: script {ids} vs timing {[s['id'] for s in T['scenes']]}")
    prev = -1
    for s in T["scenes"]:
        if s["t0"] < prev - 0.6:
            say("FAIL", f"scene {s['id']} starts at {s['t0']} before the previous scene ends")
        prev = s["t1"]
        last = -1
        for w in s["words"]:
            if w["t0"] < last - 0.01:
                say("FAIL", f"words go backwards in {s['id']} at '{w['w']}'")
            last = w["t0"]
    if os.path.exists(f("voice.wav")):
        d = wav_len(f("voice.wav"))
        if abs(d - T["duration"]) > 1.2:
            say("WARN", f"voice.wav is {d:.1f}s but timing says {T['duration']:.1f}s")
        if d < 25 or d > 80:
            say("WARN", f"video length {d:.0f}s is outside the usual 25-80 s")

    # per-scene
    for sc in S["scenes"]:
        t = ts.get(sc["id"])
        if not t:
            continue
        words = [w["w"] for w in t["words"]]
        wn = [norm(w) for w in words]
        for kind, items in (("chip", chips_of(sc)), ("sfx", sc.get("sfx") or [])):
            for c in items:
                k = c.get("at")
                if k and not any(w.startswith(norm(k)) for w in wn):
                    say("FAIL", f"{sc['id']}: {kind} anchor word '{k}' is not spoken in this scene (chip would pop at scene start)")
        chips = chips_of(sc)
        if len(chips) > 4:
            say("FAIL", f"{sc['id']}: {len(chips)} chips (max 4)")
        # spoken percents must have a chip
        nums = spoken_numbers(words)
        for v, j, i0 in nums:
            nxt = wn[j] if j < len(wn) else ""
            if nxt in ("percent", "%"):
                total_spoken_nums += 1
                ok = any(chip_pct(c) is not None and abs(chip_pct(c) - v) < 1.0 for c in chips) or any(c.get("num") is not None and abs(c["num"] - v) < 1.0 for c in chips)
                if not ok:
                    say("FAIL", f"{sc['id']}: the voice says '{words[i0]} percent' but no chip shows about {v:g}%")
                else:
                    # rounding sanity: 'more than six' must be >= six; 'about three' within 0.5
                    pre = " ".join(wn[max(0, i0 - 2):i0])
                    c = min((c for c in chips if chip_pct(c) is not None), key=lambda c: abs(chip_pct(c) - v), default=None)
                    if c is not None and "morethan" in pre.replace(" ", "") and chip_pct(c) < v:
                        say("FAIL", f"{sc['id']}: voice says 'more than {v:g}' but chip shows {chip_pct(c):g}%")
                    if c is not None and pre.endswith("about") and abs(chip_pct(c) - v) > 0.5:
                        say("WARN", f"{sc['id']}: voice says 'about {v:g}' but chip shows {chip_pct(c):g}%")
            elif v >= 100 and nxt in ("points", "point"):
                total_spoken_nums += 1
                say("WARN", f"{sc['id']}: voice says {v:g} points; make sure it is in data-check.md (no chip checks it)")
            elif v in (500,) or (1900 < v < 2100):
                pass
            else:
                total_spoken_nums += 1
        # chips vs real chart
        vis = sc.get("visual", {})
        for lab, ser in series_of(vis):
            if not ser.get("pts") or not ser.get("base"):
                continue
            mv = chart_move(ser)
            match = [c for c in chips if chip_pct(c) is not None and lab and (norm(lab) in norm(c["label"]) or norm(c["label"]) in norm(lab))]
            if not match:
                say("WARN", f"{sc['id']}: chart '{lab}' has no chip with a matching label")
                continue
            c = match[0]
            if (c["delta"] >= 0) != (mv >= 0):
                say("FAIL", f"{sc['id']}: chip '{c['label']}' is {c['delta']:+g}% but the real chart line moved {mv:+.2f}%")
            elif abs(abs(c["delta"]) - abs(mv)) > 0.25 and c["label"].upper() not in ("DOW JONES", "S&P 500", "NASDAQ"):
                say("FAIL", f"{sc['id']}: chip '{c['label']}' shows {abs(c['delta']):g}% but the real chart moved {abs(mv):.2f}%")
            elif abs(abs(c["delta"]) - abs(mv)) > 0.6:
                say("WARN", f"{sc['id']}: index chip '{c['label']}' {c['delta']:+g}% vs chart proxy {mv:+.2f}% (ETF proxy, shape only)")
        # a pulse/divider needs a spoken word
        if vis.get("zpulseAt") and not any(w.startswith(norm(vis["zpulseAt"])) for w in wn):
            say("WARN", f"{sc['id']}: zpulseAt '{vis['zpulseAt']}' not spoken")

    news_check(day, S, T, ts)

    # narration vs timing
    nar = [norm(w) for w in re.findall(r"\S+", open(f("narration.txt")).read())]
    spoken = [norm(w["w"]) for s in T["scenes"] for w in s["words"]]
    skip = set(NUMW) | set(TENS) | {"hundred", "thousand", "million", "billion", "point"}
    isnum = lambda w: bool(re.fullmatch(r"\d+", w)) or w in skip
    nar = [w for w in nar if w and not isnum(w)]; spoken = [w for w in spoken if w and not isnum(w)]
    spoken = [x for w in spoken for x in (["s", "and", "p"] if w == "s&p" else [w])]
    if nar != spoken:
        a = next((i for i, (x, y) in enumerate(zip(nar, spoken)) if x != y), min(len(nar), len(spoken)))
        say("WARN", f"narration.txt and timing.json differ at word {a}: '{(nar[a] if a < len(nar) else '')}' vs '{(spoken[a] if a < len(spoken) else '')}'")

    # rules
    if total_spoken_nums > 8:
        say("WARN", f"{total_spoken_nums} spoken numbers; balanced style is about six at most")
    cap = open(f("post-caption.txt")).read().lower() if os.path.exists(f("post-caption.txt")) else ""
    endtxt = " ".join(str(sc.get("text", "")) for sc in S["scenes"][-1:]).lower()
    if DISCLAIMER not in cap and DISCLAIMER not in endtxt:
        say("FAIL", "disclaimer 'Entertainment only. Not financial advice.' is missing from the caption and the end scene")
    dc = open(f("data-check.md")).read() if os.path.exists(f("data-check.md")) else ""
    if dc and re.search(r"\b(FAIL|MISMATCH)\b", dc):
        say("FAIL", "data-check.md contains a FAIL or MISMATCH row")
    elif dc and re.search(r"\b(REVIEW|single[- ]source)\b", dc, re.I):
        say("WARN", "data-check.md still has REVIEW or single-source rows; list them in the delivery message")
    if S["scenes"][-1]["visual"].get("type") != "end":
        say("WARN", "last scene is not the V-logo end card")
    if video:
        vp = video if os.path.isabs(video) or os.path.exists(video) else f(video)
        if os.path.exists(vp):
            r = subprocess.run(["ffmpeg", "-hide_banner", "-i", vp, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
            m = re.findall(r"I:\s+(-?\d+\.\d+) LUFS", r)
            if m and not (-16.5 <= float(m[-1]) <= -12.5):
                say("WARN", f"loudness {m[-1]} LUFS (target about -14)")
            elif m:
                say("OK", f"loudness {m[-1]} LUFS")
        else:
            say("WARN", f"video {video} not found")
    if mdata:
        market_check(S, mdata, day)
    if pixels:
        pixel_check(day, T)
    if not res["FAIL"]:
        say("OK", f"{len(ids)} scenes, {len(T['words']) if 'words' in T else sum(len(s['words']) for s in T['scenes'])} words, {T['duration']:.1f}s")


LABELS = {"DOW JONES": "DOW", "DOW CLOSE": "DOW", "S&P 500": "SPX", "S&P CLOSE": "SPX", "NASDAQ": "NASDAQ", "NASDAQ CLOSE": "NASDAQ", "VIX FEAR GAUGE": "VIX", "VIX": "VIX", "OIL": "OIL",
          "MICROSOFT": "MSFT", "AMAZON": "AMZN", "APPLE": "AAPL", "ALPHABET": "GOOGL", "META": "META", "NVIDIA": "NVDA", "TESLA": "TSLA", "ORACLE": "ORCL", "AMD": "AMD"}


def news_check(day, S, T, ts):
    """Top-news scene: present, confirmed by two sources, anchored and short enough to read."""
    date = re.sub(r"[^0-9-]", "", os.path.basename(os.path.abspath(day))[:10])
    required = date >= "2026-11-09"
    lvl = "FAIL" if required else "WARN"
    sc = next((x for x in S["scenes"] if x["visual"].get("type") == "news"), None)
    if not sc:
        say(lvl, "no `news` scene: every recap from Nov 9 2026 includes 1-3 top headlines that drove the day")
        return
    items = sc["visual"].get("items") or []
    if not 1 <= len(items) <= 3:
        say("FAIL", f"{sc['id']}: news scene has {len(items)} headlines (want 1 to 3)")
    t = ts.get(sc["id"]); wn = [norm(w["w"]) for w in t["words"]] if t else []
    spoken_digits = set(re.findall(r"\d+", " ".join(w["w"] for w in t["words"]))) if t else set()
    for i, it in enumerate(items, 1):
        k = it.get("at")
        if not k or not any(w.startswith(norm(k)) for w in wn):
            say("FAIL", f"{sc['id']}: headline {i} anchor word '{k}' is not spoken in the news scene")
        lines = it.get("lines") or []
        if not 1 <= len(lines) <= 2 or any(len(l) > 28 for l in lines):
            say("FAIL", f"{sc['id']}: headline {i} must be 1-2 lines of at most 28 characters (card width): {lines}")
        if set(re.findall(r"\d+", " ".join(lines))) - spoken_digits:
            say("WARN", f"{sc['id']}: headline {i} shows a number the voice does not say; add it to the voice or data-check.md")
    nj = os.path.join(day, "news.json")
    if not os.path.exists(nj):
        say("FAIL", "missing news.json (headline, why, sources with name and url for each news item)"); return
    N = json.load(open(nj)); N = N.get("items", N) if isinstance(N, dict) else N
    if len(N) < len(items):
        say("FAIL", f"news.json has {len(N)} entries but the scene shows {len(items)} headlines")
    for i, n in enumerate(N, 1):
        names = {re.sub(r"\W", "", str(x.get("name", "")).lower()) for x in n.get("sources", []) if x.get("url")}
        if len(names - {""}) < 2:
            say("FAIL", f"news.json item {i} ('{n.get('headline', '')[:40]}') needs two different confirming sources with urls")
        if not n.get("why"):
            say("WARN", f"news.json item {i} has no `why` (one plain-English line for new investors)")
    dc = open(os.path.join(day, "data-check.md")).read() if os.path.exists(os.path.join(day, "data-check.md")) else ""
    if dc and not re.search(r"\bnews\b", dc, re.I):
        say("WARN", "data-check.md has no News section; list each headline with its two sources")


def market_check(S, repo, day):
    """Compare chips with <repo>/data/<date>.json (the automatic run) or <repo>/data/manual/<date>.json (hand-checked)."""
    import datetime
    date = None
    for fmt in ("%Y-%m-%d", "%b %d, %Y", "%B %d, %Y"):
        try:
            date = datetime.datetime.strptime(str(S.get("date", "")).strip().title(), fmt).strftime("%Y-%m-%d"); break
        except ValueError:
            pass
    if not date:
        m = re.search(r"(\d{4}-\d{2}-\d{2})", os.path.basename(os.path.abspath(day)))
        date = m.group(1) if m else None
    cands = [os.path.join(repo, "data", f"{date}.json"), os.path.join(repo, "data", "manual", f"{date}.json")]
    entry = src = None
    for p in cands:
        if os.path.exists(p):
            d = json.load(open(p))
            usable = [i for i in d["items"] if i.get("close") is not None or i.get("change_pct") is not None]
            if usable:
                entry, src = d, p; break
    if not entry:
        say("FAIL", f"no usable market-data entry for {date} in {repo}/data (the automatic file is BLOCK or empty and there is no data/manual/{date}.json)")
        return
    items = {i["name"]: i for i in entry["items"]}
    say("OK", f"market data: {os.path.relpath(src, repo)} verdict {entry.get('verdict')}")
    seen = set()
    for sc in S["scenes"]:
        for c in chips_of(sc):
            key = LABELS.get(c["label"].upper())
            if not key:
                say("WARN", f"{sc['id']}: chip '{c['label']}' has no market-data mapping"); continue
            it = items.get(key)
            if not it:
                say("WARN", f"{sc['id']}: market-data has no entry for {key} ({c['label']})"); continue
            if it["status"] == "BLOCK":
                say("FAIL", f"{sc['id']}: market-data marks {key} BLOCK ({'; '.join(it.get('notes', []))})"); continue
            if c.get("delta") is not None and it.get("change_pct") is not None:
                tol = 0.15 if not c.get("approx") else 0.8
                if abs(abs(c["delta"]) - abs(it["change_pct"])) > tol or (c["delta"] >= 0) != (it["change_pct"] >= 0):
                    say("FAIL", f"{sc['id']}: chip {c['label']} {c['delta']:+g}% but market-data {key} is {it['change_pct']:+g}%")
            if c.get("num") is not None and it.get("close") is not None and c["label"].upper() in ("DOW CLOSE", "S&P CLOSE", "NASDAQ CLOSE", "VIX FEAR GAUGE"):
                if abs(c["num"] - it["close"]) / it["close"] * 100 > 0.15:
                    say("FAIL", f"{sc['id']}: chip {c['label']} {c['num']:g} but market-data {key} close is {it['close']:g}")
            seen.add(key)
    for k in sorted(seen):
        it = items[k]
        if it["status"] in ("SINGLE-SOURCE", "FIX"):
            say("WARN", f"market-data {k} is {it['status']}: " + "; ".join(it.get("notes", [])[:1]))


def pixel_check(day, T):
    """Render a still in the middle of each scene and make sure the bottom ~18% (y>800 of 960) is empty background."""
    here = os.path.dirname(os.path.abspath(__file__))
    scene = "flat5.html"
    times = [round((s["t0"] + s["t1"]) / 2 + 0.4, 2) for s in T["scenes"]]
    env = dict(os.environ); env.setdefault("NODE_PATH", "/opt/node-tools/node_modules")
    r = subprocess.run(["node", os.path.join(here, "render.mjs"), day, "--scene", scene, "--captions", "--stills", ",".join(map(str, times))], capture_output=True, text=True, env=env)
    if r.returncode:
        say("WARN", "could not render stills for the safe-zone check: " + (r.stderr or r.stdout)[-200:])
        return
    try:
        from PIL import Image
        import numpy as np
    except Exception:
        say("WARN", "Pillow/numpy missing, skipped safe-zone check"); return
    for s, t in zip(T["scenes"], times):
        p = os.path.join(day, f"still_{t}.png")
        if not os.path.exists(p):
            continue
        a = np.asarray(Image.open(p).convert("RGB")).astype(float)
        H = a.shape[0]
        low = a[int(H * 0.835):]
        sd = low.reshape(-1, 3).std(axis=0).max()
        if sd > 9:
            say("FAIL", f"{s['id']}: something is drawn in the bottom 16% (app buttons zone), pixel spread {sd:.0f}")
        top = a[:int(H * 0.115)]
        sdt = top.reshape(-1, 3).std(axis=0).max()
        if sdt > 40:
            say("WARN", f"{s['id']}: busy top strip (spread {sdt:.0f}); keep the top 12% clear for the app bar")
        os.remove(p)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__); sys.exit(2)
    day = args[0]
    video = sys.argv[sys.argv.index("--video") + 1] if "--video" in sys.argv else None
    if video in args: args.remove(video)
    md = sys.argv[sys.argv.index("--market-data") + 1] if "--market-data" in sys.argv else None
    if md in args: args.remove(md)
    check(day, pixels="--pixels" in sys.argv, video=video, mdata=md)
    for lv in ("FAIL", "WARN", "OK"):
        for m in res[lv]:
            print(f"{lv:4}  {m}")
    print("\nRESULT:", "FAIL" if res["FAIL"] else ("PASS with warnings" if res["WARN"] else "PASS"))
    sys.exit(1 if res["FAIL"] else 0)
