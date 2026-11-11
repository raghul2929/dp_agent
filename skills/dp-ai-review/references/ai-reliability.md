# Reliability, cost and robustness pass

Model calls are slow, metered, rate-limited, non-deterministic and occasionally wrong or absent. This pass checks that the surrounding code treats them that way.


## Tier 1 - always check (Quick and Deep)

- [ ] Every provider call has an explicit timeout, a `max output tokens` limit, and bounded retries with exponential backoff and jitter. Retries happen only on retryable errors; a 429 does not trigger a retry storm.
- [ ] Spend is bounded at three levels: per request (input and output caps), per tenant / user (quota or budget), and globally (a provider-side hard limit plus an alert). An unauthenticated caller cannot trigger unbounded spend.
- [ ] Each of these is handled deliberately - what the caller sees, whether it retries, whether it is logged - and none is swallowed into an empty success: provider outage, rate limit, quota exhaustion, safety block, empty response, truncated output (finish reason = length), malformed JSON.
- [ ] A fail-soft path that returns HTTP 200 on failure is correct only for a human-facing widget. For machine callers and batch jobs the failure must propagate with a typed error, or the caller treats nothing as success.
- [ ] Fallback models: behaviour differences are known and acceptable for the task, and the fallback is visible in logs and audit records. For decisions, falling back to a weaker or different model is an explicit choice, not an accident of config order.
- [ ] Model identifiers are pinned to dated versions, or the alias risk is accepted in writing. Deprecation dates are tracked.
- [ ] Concurrency model matches the deployment: per-process limiters multiplied by worker count, sync workers wrapping async calls, blocking sleeps inside async code, connection pools sized.
- [ ] Per-call usage (tokens in / out, model, latency, cost, cache hit) is recorded with a trace id and tenant, and the total covers **all** helper calls (rewrite, rerank, summarise, extraction), each priced at its own model's rate.
- [ ] Alerts or dashboards exist for error rate, latency p95, daily cost per tenant, refusal rate, fallback rate, and empty / truncated rate.
- [ ] A kill switch or flag disables the AI path, or degrades to non-AI behaviour, without a deploy.
- [ ] **Incident readiness.** There is a written route for an AI incident - a successful injection, a leaked prompt or key, harmful or false output reaching customers, cross-tenant exposure, a provider breach or outage - naming who decides, how the AI path is switched off, how keys are rotated without a redeploy, how a prompt or model is rolled back, and how affected customers are told.

---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Cost design

- [ ] Cheaper tiers for helper tasks do not degrade the task they serve; the downgrade was evaluated, not assumed.
- [ ] Prompt caching and semantic caching are correct (keys, TTL, invalidation) before they are fast.
- [ ] Needless calls are skipped when the answer is deterministic (gating, pre-matching, empty-retrieval short circuits) and the skip is reported as skipped, not as a result.
- [ ] Output length is capped by task, and verbose "explain your reasoning" blocks are paid for on purpose.

## 2. Batch and backfill work

- [ ] Idempotent and resumable; a re-run does not re-pay for finished items.
- [ ] Budget-capped and rate-limit-aware, with a checkpoint.
- [ ] Failures are distinguished: transient (retry), permanent (park for a human), misconfiguration (stop). A permanent error must not be retried forever by an unattended loop.
- [ ] Progress and failures are visible while the job runs.

## 3. Context management

- [ ] History growth is bounded; truncation order is deliberate (what is dropped first).
- [ ] Budget arithmetic cannot go negative or zero (history consuming the whole window, then retrieval silently dropped).
- [ ] Very long inputs are chunked or rejected, not sent and billed.

## 4. Latency and streaming

- [ ] Independent calls run in parallel; sequential helper chains are justified.
- [ ] Streaming clients disconnecting cancels generation.
- [ ] Time-to-first-token and total latency have targets and are measured.

## 5. Start-up and capacity

- [ ] Model and tokenizer downloads at boot do not break start-up when the network is slow; readiness probes include model readiness; health probes do not spend tokens.
- [ ] Local models: memory, GPU and CPU sized; one copy of each model per process, not two.
- [ ] In-memory caches keyed by tenant have a bound.

## 6. Determinism

- [ ] Temperature and sampling are chosen for the task. Temperature zero is not a guarantee of identical output.
- [ ] Anything depending on output equality (tests, audit comparison, caching) accepts that.

## 7. Resilience

- [ ] Degraded mode is designed: what the user sees when the model is unavailable.
- [ ] Graceful shutdown finishes or requeues in-flight model work.
- [ ] Vector store and other AI state are recoverable, with the recovery tested.
- [ ] Webhook- or event-triggered AI jobs are de-duplicated.

## 8. Incident readiness

- [ ] **Detect.** Signals exist that would reveal an incident: spikes in refusals, canary strings or system-prompt fragments appearing in outputs, outputs containing URLs / HTML / code where none are expected, cost or token spikes per tenant, unusual retrieval across tenants, tool-call anomalies.
- [ ] **Report.** Users and staff have a way to flag a bad answer (a visible "report this answer" or equivalent), and flagged items reach a person with the full record of that turn.
- [ ] **Contain.** The kill switch works per feature and per tenant, not only globally; a specific document, prompt version, or source can be quarantined without redeploying.
- [ ] **Evidence.** The records needed to investigate (input, prompt version, model version, retrieved context, output, tool calls) are retained long enough, access-controlled, and not overwritten by the incident response itself.
- [ ] **Recover.** Provider keys can be rotated without downtime; a previous prompt and model version can be restored by configuration; the vector store can be rebuilt (see §7).
- [ ] **Notify.** Someone owns the decision to notify customers, regulators or the provider, and the contact paths are written down (including the provider's abuse and security contacts).
- [ ] **Learn.** A confirmed incident produces a new eval case and a new checklist item (see `SKILL.md` Step 10), so the same class cannot ship again.
- [ ] The runbook has been exercised at least once (a drill or a real event), not only written.
