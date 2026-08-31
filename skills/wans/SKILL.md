---
name: wans
description: Use when the user types /wans to get the next steps for the current work, written in ASD-STE100, as a short numbered list.
---

# WANS

Answer one question: what are the next steps?

## Rules

1. **Take the steps from the session.** Use the work in progress, the open questions, and the decisions the user must make. Every step must come from what the conversation or the code shows. If a step depends on a fact you did not check, check it first or mark it as unknown.
2. **Write it in ASD-STE100 (Simplified Technical English)** per the Response Style rules in CLAUDE.md/AGENTS.md. Use a numbered list, one step for each line. Start each step with an action verb. Keep each step to one sentence of 20 words or less. No headers, and no preamble like "Here are the next steps".
3. **Give five steps or fewer**, in the order to do them. Put the step that unblocks the most work first.
4. **Name the owner of each step.** Start the line with `You:` when the user must act, or `Me:` when you can do the step. A step that only the user can do — an approval, a credential, a product decision — must say so.
5. **Name each blocker with its step.** If a step cannot start, add one clause that tells what stops it.
6. **Stay at the architecture and behavior altitude.** Do not use raw symbols or `file:line`, and do not show code. Use a file path only when the step has no meaning without it.
7. **Tell the user when there is nothing to do.** If the work is complete and no step is open, write one line that says so. If the session has no work in progress, write one line and ask what to plan.
