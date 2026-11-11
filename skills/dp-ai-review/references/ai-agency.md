# Agency pass - tools, agents, memory, MCP

Run when the map shows tools, function calling, agents, memory or MCP. Excessive agency turns a text bug into an action bug: the model is a confused deputy that can be steered by anything it reads.


## Tier 1 - always check (Quick and Deep)

- [ ] Inventory every tool / function / action the model can call, the permission class of each (read / write / delete / send / spend / execute), and the credential it runs under. Anything broader than the least-privileged user of that session could do directly is a finding.
- [ ] Tools run as the **end user** or a narrowly scoped identity, never a god-mode token, and their arguments are authorised server-side against that caller (confused deputy).
- [ ] Irreversible, costly or externally visible actions - send e-mail / SMS, pay, refund, delete, deploy, publish, change permissions - need human approval or are not possible. The approval screen shows the real arguments, not the model's description of them.
- [ ] Tool arguments are validated like any untrusted input (schema, allowlist, path / URL / SQL checks). No free-form shell, SQL, URL or code tool without sandbox and limits.
- [ ] Loops are bounded: max steps, max tool calls, max tokens or cost, wall-clock timeout, no unbounded self-invocation, circuit breaker on repeated failure.
- [ ] Tool results are treated as untrusted data. A result cannot raise the privileges of the next call.
- [ ] The three-way combination - **private data + untrusted content + a way to send data out** - is broken apart in the design, or explicitly accepted with the mitigation named.
- [ ] Every action is audit-logged with caller, conversation id, tool, arguments, result and timestamp, and can be reconstructed and where possible reversed.
- [ ] External tool servers and plugins (MCP and similar) are pinned, from known publishers, minimally scoped, and new tools are not auto-approved. Their descriptions are reviewed - a tool description is a prompt.

---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Multi-agent systems

- [ ] One agent's output is never treated as another agent's instruction without the same validation applied to a user message.
- [ ] Roles and permissions are fixed in code, not negotiated in conversation.
- [ ] Delegation chains cannot widen privilege at each hop.
- [ ] Shared scratchpads and memory are writable only by the parties that should write them.

## 2. Memory

- [ ] What is persisted, who can write it, how long it lives, and whether the user can see and delete it.
- [ ] Memory is isolated per user / tenant and cannot be written by untrusted content (stored injection).
- [ ] Memory content is counted as data in every later prompt, not as instructions.

## 3. Execution environments

- [ ] Code interpreters: network off by default, filesystem scoped, CPU / memory / time limits, no access to cloud metadata, fresh state per session.
- [ ] Browser / computer-use agents: no credentials in the profile, no cross-site session reuse, downloads quarantined, allowed domains bounded.

## 4. Control and safety rails

- [ ] A kill switch disables tool use (or the whole agent) without a deploy.
- [ ] A configuration flag cannot silently raise autonomy (L2 to L4) in production.
- [ ] A dry-run mode exists for destructive tools.
- [ ] Approval fatigue is considered: batched approvals show a real diff; low-risk and high-risk actions are not asked the same way.
- [ ] Per-user and per-tenant rate limits on actions, not only on messages.

## 5. Reliability of actions

- [ ] Retried tool calls are idempotent - a retry must not double-send or double-charge.
- [ ] Long-running tasks resume or fail cleanly after a crash; partial work is visible.
- [ ] Tool-selection accuracy and argument correctness are in the eval set (see `ai-quality.md`).
- [ ] Human override and hand-off states exist and are tested.
