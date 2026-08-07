---
name: dp-version
description: Show which version of the dp-agent plugin is currently installed — nothing else. Use when the user asks "what version of dp-agent", runs "/dp-agent --version" or similar, or wants to confirm whether an update actually took effect.
argument-hint: ""
disallowed-tools: Edit, Write, NotebookEdit, Bash
---

# /dp-version — show the plugin version, nothing else

Read `../../.claude-plugin/plugin.json`'s `version` field fresh — don't guess it or
reuse a number from earlier in the conversation.

Respond with exactly one line, nothing before or after it:

```
dp-agent v<version>
```

No summary of what's new, no list of skills, no commentary — the developer asked a
single factual question and wants a single factual answer. If they want to know what
changed in this version, that's a different question; answer this one only.
