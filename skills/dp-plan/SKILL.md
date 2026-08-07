---
name: dp-plan
description: Turn a validated ticket into an implementation plan — files to change, ordered steps, tests, risks, blast radius — grounded in the actual repo and CLAUDE.md conventions. Hands off to native plan mode for approval, then implements the approved plan. Use when the user has a ticket ready for implementation and asks to plan it, scope it, or figure out how to build it.
argument-hint: "[ticket text, ticket key, or reference to a /dp-ticket result]"
---

# /dp-plan — turn a ticket into a plan, then build it once approved

Planning and implementation are two distinct phases of this skill, in this order:
**plan first, without touching any files — then, only after the developer approves via
native plan mode, implement exactly that plan.** Never write or edit a file before the
plan is approved. Once it's approved, proceed straight into implementing it — that's the
expected continuation of this skill, not a separate step the developer has to ask for
again.

## 1. Ground yourself in the ticket

- If the conversation already has a ticket from `/dp-ticket`, use that (prefer the
  rewritten version if one was produced and accepted).
- Otherwise use whatever ticket text/key the user gives you directly.
- If the ticket looks like it would score poorly against
  `../../templates/ticket-quality-bar.md` (vague scope, no acceptance criteria), say so
  and suggest running `/dp-ticket` first — but don't hard-block; the developer may
  have context this skill doesn't.

## 2. Read team conventions

Read `CLAUDE.md` at the repo root. This is where naming, structure, testing style, and
architecture conventions live — do not assume or invent any of that here. If `CLAUDE.md`
doesn't exist, say so explicitly in the plan output rather than silently guessing team
convention (see `CLAUDE.md.example` at the plugin root for what should be in it).

## 3. Explore the repo — do not guess file paths

Use `Grep`/`Glob`/`Read` (and `Bash` for things like `git log --oneline -- <path>` if it
helps) to find the files actually involved:

- Search for the feature area, entity names, or error strings mentioned in the ticket.
- Follow imports/references to confirm you've found the real call sites, not just a
  plausible-looking file name.
- If you can't confidently locate the relevant code, say so in the plan's Risks section
  instead of listing a guessed file path as if it were confirmed.

## 4. Write the plan

Produce the plan in **exactly** the shape defined by `../../templates/plan-format.md` —
same section headers, same order, including that template's own brevity rules. Fill
every section; write "None identified" rather than omitting a section. Don't pad a
section to look thorough — a short "Risks: None identified" is a better answer than
three invented low-probability risks.

Include the one-line model recommendation this template calls for (e.g. `Sonnet — 6
files, no schema change`), with the exact `/model` command to switch. This is a
suggestion for the developer to act on manually — the skill does not switch models,
spawn other agents, or act on its own recommendation. Since step 8 implements
immediately once the plan is approved, mention that switching (if they want to) needs
to happen before they approve, not after — there's no pause between approval and
implementation to switch mid-flight.

## 5. Hand off to native plan mode — do not build your own approval flow

This environment exposes `EnterPlanMode` and `ExitPlanMode` as tools. Use them instead of
inventing an approve/reject prompt:

1. If you are not already in plan mode, call `EnterPlanMode` before or as you start
   step 3's exploration (it's designed to be entered before non-trivial work begins).
2. Do the exploration and planning in steps 1-4 as normal.
3. Write the finished plan to the plan file plan mode specifies (per that tool's
   instructions — plan mode tells you where when you're in it).
4. Call `ExitPlanMode` when the plan is complete. That tool itself requests the
   developer's approval — do not additionally ask "does this look OK?" yourself, and do
   not implement anything before it's approved.

If `EnterPlanMode`/`ExitPlanMode` are not available in whatever Claude Code environment
this runs in, fall back to: present the plan as your final message and explicitly tell
the developer implementation will not start until they say to proceed. Do not treat
silence or a vague acknowledgement as approval.

**If the developer picks "keep planning" and asks for changes**: update the plan file
in place and summarize only what changed (e.g. "Updated Steps 2-3 to also touch
`auth.py` per your note — everything else unchanged"). Don't re-paste the entire plan
again in the chat response; the developer can already see the full updated plan in the
plan file plan mode is showing them.

## 6. Implement the approved plan

Once plan mode signals approval, immediately start on step 1 of the plan's Steps
section, in order. Follow `CLAUDE.md` conventions (naming, testing approach, etc.) the
same way you referenced them while planning. Write the tests listed in the plan's "Tests
to add" section as part of implementing, not as an afterthought.

If the developer's approval response requested changes, or picked "manually approve
edits" rather than auto-accept, follow whatever native plan mode surfaces for that —
this section only applies once you're actually clear to proceed.

If something during implementation contradicts the plan (a file doesn't exist where
expected, a risk you flagged turns out to be real), stop and say so rather than silently
improvising past it — the plan was the developer's approval, not a suggestion you can
freely deviate from.

**Keep verification cheap by default.** Run the specific unit test(s) you just wrote or
touched — that's it, unless `CLAUDE.md`'s testing section explicitly says to do more.
Do not install browser binaries, run a full E2E suite, or run a full production build as
part of this step; those are slow and token-heavy, and are exactly the kind of thing the
developer can run locally in seconds. If the plan's "Tests to add" implies that heavier
kind of verification, name the exact command in your final message and say the developer
should run it themselves — don't run it yourself by default.

**Never run these, no matter what `CLAUDE.md` says** — this list isn't a cost
preference like the one above, it's a hard boundary: `git commit` / `git push` /
`git merge` / `git rebase` (drafting and committing is `/dp-agent:dp-cpr`'s job, not
this skill's), package installs (`npm install` and equivalents), database migrations or
seed scripts, deploy or release commands, and anything that deletes. If a plan step
genuinely needs one of these, name the exact command in your final message and say the
developer runs it — never run it yourself, and don't look for a workaround that
technically avoids the literal command while doing the same thing.

## 7. Check against acceptance criteria, and report what was tested

Before asking what's next, show two things plainly — don't fold them quietly into the
implementation summary, they need to be scannable on their own:

- **Acceptance criteria checklist**: if the ticket has acceptance criteria (from
  `/dp-ticket`'s draft, or stated directly in the ticket), list every one of them with a
  verdict: ✅ covered (name the specific change or test that covers it), ⚠️ partially
  covered (say exactly what's missing), or ❌ not addressed. One line per criterion —
  the "name the change/test" part is what makes it useful, not extra explanation. If the
  ticket had no acceptance criteria to check against, say that plainly instead of
  inventing criteria after the fact just to make the checklist look complete.
- **Testing summary**: one line per test — name + pass/fail. Then, separately, one line
  for what you deliberately did not run (E2E, full build, etc.) and the exact command
  the developer should run themselves to check those.

If any AC item is ⚠️ or ❌, lead with that — don't let a clean-looking "done" message
bury a real gap. A confident summary with a missed criterion is worse than a summary
that plainly says something's incomplete.

## 8. Offer to continue

Once implementation is done (and tests, if any were added, are passing), ask the
developer (e.g. via `AskUserQuestion`) whether to proceed to drafting a commit and PR
now. If they confirm, read `../dp-cpr/SKILL.md` and continue by following it directly —
don't wait for them to separately type `/dp-agent:dp-cpr`. If they decline, stop here.

## Notes

- Nothing gets written or edited before plan-mode approval (step 5) — that boundary is
  the whole point of planning separately. After approval, step 6 has normal tool access;
  nothing in this skill restricts it further.
- If the ticket is a bug report, still produce the full plan shape — "Tests to add"
  should include a regression test that fails before the fix, per whatever your team's
  testing convention (`CLAUDE.md`) says about that.
