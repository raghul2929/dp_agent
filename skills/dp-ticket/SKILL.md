---
name: dp-ticket
description: Validate and improve a Jira ticket against the team's quality bar before work starts on it. Scores title, description, acceptance criteria, and ambiguity; rewrites the ticket and drafts acceptance criteria if it falls short of the bar; classifies bug/feature/improvement if it passes. Use whenever the user pastes a ticket, gives a ticket key, or asks to check, improve, validate, or grade a ticket.
argument-hint: "[pasted ticket text, or TICKET-123]"
---

# /dp-ticket — validate and improve a ticket

This skill must be useful standalone — the developer running it may never touch
`/dp-plan`, `/dp-cpr`, or `/dp-git-help`. Do not assume any of that context exists.

## 1. Get the ticket

- If the user pasted ticket text (title + description, however rough), use it as-is.
- If the user gave a ticket key (e.g. `TICKET-123`) instead of pasted text, look for a
  connected Jira/Atlassian MCP tool via `ToolSearch` (query: `"jira issue"`). If one is
  found, fetch the ticket by key. If none is connected, ask the user to paste the ticket
  — do not fabricate ticket content.
- If both a key and pasted text are given, prefer the pasted text (it may be a draft the
  user hasn't saved to Jira yet) but note the key for the final output.

## 2. Score it

Read `../../templates/ticket-quality-bar.md` and score the ticket on all four axes it
defines (title, description, acceptance criteria, ambiguity), using the scale and
verdict thresholds defined there. Do not invent your own bar — if the template still has
unfilled `TODO(team)` placeholders, say so explicitly in your output instead of silently
making up a standard.

Show the four scores plainly, e.g.:

```
Title: 4/5
Description: 2/5
Acceptance Criteria: 1/5
Ambiguity: 3/5
```

## 3. Branch on the verdict

Apply the verdict thresholds from `ticket-quality-bar.md` to decide which path below
you're on. If the template's thresholds are still TODO, use your judgment but flag that
the bar is unconfigured.

### 3a. Falls short → rewrite

- Rewrite the ticket (title + description) to close the specific gaps you scored low on.
  Don't rewrite parts that already scored well — minimize unnecessary churn.
- Draft acceptance criteria using the format in `../../templates/acceptance-criteria.md`.
- Show the rewrite as a **diff against the original**, not just the new version — the
  developer needs to see exactly what changed and why. Use a standard `diff`-style or
  markdown before/after block, whichever renders more clearly for the size of the change.
- Below the diff, list the specific gaps that drove the rewrite — one line per gap, tied
  back to the axis that scored low (e.g. "AC scored 1/5 — no testable criteria at all").
  Don't re-explain the scoring rubric here; the developer just saw the scores in step 2.
- Keep the rewritten title/description close in length to the original unless the
  original was genuinely too thin to be usable — a rewrite that's 3x longer than the
  original usually means you added speculative detail the developer didn't ask for.

### 3b. Passes → classify

- Classify the ticket as **bug**, **feature**, or **improvement**, using the definitions
  in `ticket-quality-bar.md`'s classification section. If those definitions are still
  TODO, classify using ordinary judgment and say the classification is a best guess
  pending a team definition.
- State the classification and a one-sentence justification. Do not rewrite a ticket
  that already passed — don't churn a good ticket for style preferences.

### 3c. Any axis scored 1 (severe)

Per the quality bar's guidance, a severe score usually means the ticket needs a
conversation with the reporter, not a guess. Say so explicitly rather than inventing
intent to paper over a 1/5 score — a confident-sounding rewrite of a ticket you don't
understand is worse than no rewrite.

## 4. Always end with one line

Regardless of path, end your response with exactly one line stating readiness:

```
Ready for /dp-plan: yes|no — [reason]
```

`yes` only applies to 3b (passed) or a 3a rewrite the developer has explicitly accepted.
A ticket that just got rewritten in this same turn is not yet "ready" until the developer
confirms the rewrite — default to `no — awaiting developer confirmation of the rewrite`
in that case.

## 5. Ask what's next — always, not just when ready

Don't leave the developer to notice the line above and type a reply unprompted. Always
follow it with an actual `AskUserQuestion` call, shaped by which path you took:

- **3b (passed), or 3a where the developer has already told you they accept the
  rewrite**: ask whether to proceed straight to `/dp-plan` now. If yes, read
  `../dp-plan/SKILL.md` and continue by following it directly, using this ticket as
  input — don't wait for a separate `/dp-agent:dp-plan` invocation.
- **3a (rewrite just proposed, not yet accepted)**: ask the developer to decide on the
  rewrite and the next step together, e.g. options like "Accept the rewrite and proceed
  to /dp-plan" / "Accept the rewrite, I'll plan later myself" / "Don't accept — I'll
  revise it myself". Accepting the rewrite and proceeding are one decision for the
  developer to make in one prompt, not two separate round-trips.
- **3c (severe — needs a conversation with the reporter)**: don't offer to proceed to
  `/dp-plan` at all; ending here without a question is correct.
