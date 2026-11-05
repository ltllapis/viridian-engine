"""Market data checker (rules from CHECKER-RULES.md), applied to fetched numbers.
Every item gets status PASS / SINGLE-SOURCE / FIX / BLOCK. Pure functions, unit tested."""

def pct(close, prev):
    return round((close - prev) / prev * 100, 2)

def check_item(name, primary, secondary, expected_date, cfg):
    """primary: {date, close, prev_close}; secondary: same shape or None."""
    notes, status = [], "PASS"
    if not primary or primary.get("prev_close") is None:
        return {"name": name, "status": "BLOCK", "notes": ["no primary data"]}
    if primary["date"] != expected_date:
        status = "BLOCK"; notes.append(f"primary date {primary['date']} is not the expected trading day {expected_date} (stale or not closed yet)")
    item = {"name": name, "date": primary["date"], "close": primary["close"], "prev_close": primary["prev_close"],
            "change_pct": pct(primary["close"], primary["prev_close"])}
    if secondary is None:
        if status == "PASS": status = "SINGLE-SOURCE"
        notes.append("only one source; cut it, soften it (about, nearly), or confirm by hand")
    else:
        if secondary["date"] != primary["date"]:
            status = "BLOCK"; notes.append(f"sources disagree on date: {primary['date']} vs {secondary['date']}")
        diff = abs(secondary["close"] - primary["close"]) / primary["close"] * 100
        if diff > cfg["tolerance_price_pct"]:
            status = "BLOCK"; notes.append(f"close differs by {diff:.2f}% between sources ({primary['close']} vs {secondary['close']})")
        if secondary.get("prev_close"):
            d2 = abs(pct(secondary["close"], secondary["prev_close"]) - item["change_pct"])
            if d2 > cfg["tolerance_pct_points"]:
                status = "BLOCK"; notes.append(f"daily move differs by {d2:.2f} points between sources")
        item["second_source_close"] = secondary["close"]
    item.update(status=status, notes=notes)
    return item

def verdict(items):
    s = {i["status"] for i in items}
    return "BLOCK" if "BLOCK" in s else "REVIEW" if s & {"SINGLE-SOURCE", "FIX"} else "PASS"
