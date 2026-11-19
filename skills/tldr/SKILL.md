---
name: tldr
description: Use when the user types /tldr to get a plain-simple-English summary, written in ASD-STE100, of the most recent response, aiming for under 25 words and never over 50.
---

# TLDR

Produce a dead-simple recap of your most recent substantive response.

## Rules

1. **Write it as a Plain simple English block in ASD-STE100 (Simplified Technical English)** per the Response Style rules in CLAUDE.md/AGENTS.md. Aim for under 25 words. If 25 words would cut critical information (a caveat, a decision, or a required action), use more, up to a hard maximum of 50 words. No headers.
2. **Summarize the prior answer**, not the original question. If there is no prior substantive response in the conversation, say so in one line and ask what to summarize.
3. **Keep critical caveats.** Simplify the answer without dropping a caveat that changes what the reader should do.
