---
name: tldr
description: Use when the user types /tldr to get a plain-simple-English summary of the most recent response in under 55 words.
---

# TLDR

Produce a dead-simple recap of your most recent substantive response.

## Rules

1. **Write it as a Plain simple English block** per the Response Style rules in CLAUDE.md/AGENTS.md: ASD-STE100, under 55 words. Going over is a failure. Count them.
2. **No jargon and no unspelled acronyms.** Do not assume domain knowledge.
3. **One sentence per line, separated by a blank line.** No headers, no bullet lists, no preamble like "Here's the TLDR" — just the summary itself.
4. **Summarize the prior answer**, not the original question. If there is no prior substantive response in the conversation, say so in one line and ask what to summarize.
5. **Keep it accurate.** Simplify, never fabricate. If the real answer has a critical caveat, keep it.
