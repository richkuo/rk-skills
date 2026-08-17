---
name: tldr
description: Use when the user types /tldr to get a plain-simple-English summary, written in ASD-STE100, of the most recent response in under 55 words.
---

# TLDR

Produce a dead-simple recap of your most recent substantive response.

## Rules

1. **Write it as a Plain simple English block in ASD-STE100 (Simplified Technical English)** per the Response Style rules in CLAUDE.md/AGENTS.md, one sentence per line separated by a blank line. Bullet lists are allowed. No headers, no preamble like "Here's the TLDR" — just the summary itself.
2. **Summarize the prior answer**, not the original question. If there is no prior substantive response in the conversation, say so in one line and ask what to summarize.
3. **Keep critical caveats.** Simplify the answer without dropping a caveat that changes what the reader should do.
