---
name: wans
description: Use when the user types /wans to get the next steps for the current work, written in ASD-STE100, as a short numbered list.
---

# WANS

Answer one question: what are the next steps?

## Rules

1. **Write it in ASD-STE100 (Simplified Technical English)** per the Response Style rules in CLAUDE.md/AGENTS.md. If there are multiple steps, give a numbered list. Order the steps by sequence when one step must come after another. If the order is free, put the most important step first. No preamble.
2. **Take the steps from the session.** Do not invent work the conversation or the code does not support.
3. **Say who acts.** Start each line with `You:` or `Me:`. If nothing is open, say so in one line.
