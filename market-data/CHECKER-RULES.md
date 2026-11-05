---
name: market-data-checker
description: Before a recap video or post goes final, verify every market number on screen, in the voice and in the caption against two sources, and flag anything single-sourced.
---

# Market data checker

Run this after `script.json` is written and again after any edit to narration or callouts, and always before Vince posts. A wrong number on a finance page costs trust, so this step is not optional.

## What to check
Collect every number from three places and make sure they agree with each other and with the sources:
1. `narration.txt` (spoken form, including `{shown|spoken}` pairs).
2. `script.json` visuals and `callouts` (what appears on screen: index closes, percent moves, dollar amounts, guidance figures).
3. `post-caption.txt` and the cover (`cover.html` pills).

Build a table: item, value as shown, value as spoken, source 1, source 2, status.

## Sources, in order of trust
- Robinhood MCP, read-only only (never place, cancel or modify orders): `get_equity_quotes` for stock closes and day change, `get_index_quotes` for S&P 500 (SPX), NDX and VIX. Robinhood does not offer the Dow (DJI) or Nasdaq Composite (COMP), so those need news sources.
- Alpha Vantage tools (for example `GLOBAL_QUOTE`, `TOP_GAINERS_LOSERS`, `EARNINGS`) as an independent second source for stocks.
- WebSearch for index closes, earnings figures, guidance, and the story behind a move. Prefer two different outlets or an official release. finance.yahoo.com and stocktitan.net are blocked in this sandbox.

## Rules
- Every number needs two independent sources. If only one exists, mark it SINGLE-SOURCE and either cut it, soften the wording (about, nearly), or ask Vince.
- Percent changes: recompute from close and previous close when both are available. Rounding must match what is on screen (script says 2.2, screen says 2.2%).
- Spoken and shown must be the same quantity: "nearly 6 percent" with 5.9% on screen is fine; "about 2" needs a chip marked with ~. Flag mismatches.
- Index closes: confirm trading date, that it is the final close and not intraday, and that after-hours moves are labeled as after hours.
- Causes ("margin worries", "weighed down by Apple") are claims too. Check at least one reputable source and note if it rests on one analyst note.
- Dates and events (earnings after the bell, midterm results, options-implied move) must be checked for the right day.
- Never invent a number to fill a visual. If a callout cannot be verified, remove it.

## Output
Write `YYYY-MM-DD/data-check.md` with the table, a PASS / FIX / BLOCK verdict per line, the list of single-source items, and the exact edits needed (file, field, old value, new value). Apply approved fixes to `script.json` and `narration.txt`, then re-run `voice.py` if narration changed (word timings move) and re-render. Tell Vince the verdict in two or three sentences and link the file.

## Disclosure
The videos carry "Entertainment only. Not financial advice." Never add price targets, buy or sell language, or predictions beyond what a source states.
