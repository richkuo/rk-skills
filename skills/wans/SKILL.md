---
name: wans
description: Use when the user types /wans to get the next steps for the current work, written in ASD-STE100, as a short numbered list.
---

# WANS

Answer one question: what are the next steps?

## Rules

1. **Write it in ASD-STE100 (Simplified Technical English)** per the Response Style rules in CLAUDE.md/AGENTS.md. Give a numbered list of five steps or fewer, most important first, one short sentence for each. No preamble.
2. **Take the steps from the session.** Do not invent work the conversation or the code does not support.
3. **Say who acts.** Start each line with `You:` or `Me:`. If nothing is open, say so in one line.
