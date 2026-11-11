# Prompt, evaluation and decision-safety pass

A model-backed feature is correct only as far as it has been measured. This pass reviews prompts as code, checks that behaviour is evaluated before it ships, and checks that a wrong answer cannot quietly become a wrong decision.


## Tier 1 - always check (Quick and Deep)

- [ ] Prompts live in version control as reviewable artefacts - not edited in a dashboard or database with no history - and any production call can be traced to a prompt version.
- [ ] **Read the composed prompt as the model sees it** (system + persona + injected rules + retrieved context + user turn + schema), and look for contradictions: told to refuse and to classify in the same prompt; a persona or escalation rule written for one product leaking into another; formatting instructions that conflict with the output schema; a rule that can never fire.
- [ ] An evaluation set exists for each model-gated behaviour: labelled examples including edge and adversarial cases, a metric, a threshold, and a command to run it locally or in CI. No eval means every prompt and model change ships blind.
- [ ] Changes to prompt, model, temperature, retrieval parameters or chunking trigger the eval before merge, by CI or a documented manual gate. The harness is in the repository - not gitignored, not on one person's machine.
- [ ] **The gate can actually fail.** A gate that exists is not a gate until it can block: the baseline is set (not `unset` or empty), the job is not `allow_failure` or skipped on a missing report, the labelled set has been reviewed by a domain expert, and a change in a *sibling* repo that alters the model's behaviour (prompt, model tier, SDK version) triggers it. Read the pipeline config and the baseline file; a configured-but-inert gate is recorded as no gate.
- [ ] For any classifier or extractor that gates a human workflow, **recall on the must-not-miss class** is measured and reported, not just overall accuracy, and the operating point errs toward the safe side.
- [ ] Factual answers are grounded in provided sources; a "don't know" path exists and is tested; citations come from code; ungrounded claims are detected or flagged.
- [ ] Model output is parsed against a schema. A parse failure is counted and is never silently replaced by a default - and the default, where one exists, is the safe value.
- [ ] Offsets, spans, ids and quotes the model returns are verified against the source text.
- [ ] Live-model tests are separated from deterministic unit tests; unit tests stub the provider; no test asserts equality with real model output; inherently variable checks use a threshold over N samples.
- [ ] Any confidence score used for routing is calibrated against labelled outcomes or is plainly labelled a heuristic. Nothing gates on a model's self-reported confidence.
- [ ] **Commitments.** Where the system's words could bind the operator (price, discount, refund, eligibility, delivery date, policy exception, medical / legal / financial statement), the figure or promise comes from authoritative data fetched by code and inserted into the reply - never from the model's own generation. The model cannot approve, waive or grant anything by saying so.
- [ ] **Training and feedback loops** (if present). Data entering a training or tuning set has provenance and a licence, is scrubbed for personal data and secrets, and cannot be influenced by anonymous users (thumbs-up, corrections, "was this helpful") without vetting. The tuned model is evaluated against the base model on the same held-out set before it replaces it.

---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Prompt design

- [ ] Instruction hierarchy is clear: platform rules, tenant rules and per-request rules do not contradict each other.
- [ ] Few-shot examples are representative, unbiased by label order, and contain no real data.
- [ ] Negative instructions ("do not…") are paired with what to do instead.
- [ ] Prompt size is justified; dead branches and unused sections are removed.
- [ ] Prompt templates built with `format`, f-strings or a template engine cannot be broken or abused by braces or template syntax in user or retrieved text.
- [ ] Language, locale and tone handling is intentional.
- [ ] Temperature and other parameters are justified for the task.

## 2. Evaluation design

- [ ] The eval set is separate from the prompt's few-shot examples (no leakage), large enough to see a regression, versioned, and has a stated source.
- [ ] A prompt or model change produces a diff against the previous run, per segment (language, tenant, content type).
- [ ] If a model grades the model (LLM-as-judge): the judge is a different model or a different configuration, calibrated against human labels, and position and verbosity bias are controlled.
- [ ] Adversarial and jailbreak suites run in CI where a tool is available.
- [ ] Production outputs are sampled for human review, including **auto-dismissed / negative** decisions - not only the positives a reviewer sees anyway.
- [ ] Online monitoring detects drift: score distributions, refusal rate, parse-failure rate, escalation rate.

## 3. Decision safety

- [ ] The workflow defines the cost of a false negative versus a false positive and the system is tuned accordingly.
- [ ] An automated "no" (not relevant, not an issue, not urgent) has a sampling or secondary check; a model's negative never silently ends a regulated obligation.
- [ ] Reviewers see evidence (quoted spans, sources), not just a label.
- [ ] Automation bias is considered: the reviewer's agree rate is tracked, and disagreements feed back into the eval set.
- [ ] Overrides are logged; queues cannot starve silently.

## 4. Change management

- [ ] Model upgrades, deprecations and provider-side alias changes trigger a re-eval.
- [ ] Canary or shadow runs exist for risky changes; rollback of prompt and model is a config change.
- [ ] Prompt and model versions are recorded in outputs so a regression can be bisected.

## 5. Error taxonomy

- [ ] Wrong, refused, truncated, off-topic, unsafe and stale are distinguished, each with a metric.
- [ ] Refusals and safety blocks have defined user-facing behaviour.

## 6. Routing and intent classifiers

- [ ] Thresholds and margins are calibrated on labelled queries; the cost of a misroute is known.
- [ ] A low-confidence route falls through to a safe default, not to a confident wrong answer.

## 7. Training, fine-tuning and feedback loops (if present)

- [ ] **Provenance and rights.** Every dataset has a source, a licence or consent basis, a snapshot id, and an owner. Scraped data respects its terms.
- [ ] **Scrubbing.** Personal data, secrets, credentials and customer-confidential text removed or pseudonymised before training; verified by a scan, not by assumption. A model can reproduce what it was trained on.
- [ ] **Poisoning.** Contributions from users, tenants, crawls or feedback are vetted before they enter a set: outlier and duplicate detection, label-flip and backdoor-trigger checks, rate limits per contributor, and a way to remove a contributor's data and retrain.
- [ ] **Split integrity.** Train / validation / test have no leakage (near-duplicates, same source across splits, eval items present in few-shot examples or training data).
- [ ] **Artefact integrity.** Checkpoints and adapters are stored with hashes, in a safe format (not pickle where a safe format exists), with access limited and a record of who produced them.
- [ ] **Memorisation test.** Probe the tuned model for verbatim reproduction of training records that should not be reproducible.
- [ ] **Promotion gate.** The tuned model beats or matches the base model on the same eval, including the must-not-miss class and adversarial cases, before it replaces anything; rollback to the previous model is one config change.
- [ ] **Reproducibility.** Seeds, versions, data snapshot and hyper-parameters recorded; a model card or equivalent states intended use, known limits and evaluation results.
- [ ] **Feedback integrity.** Feedback that adjusts ranking, prompts or training is attributable, rate-limited, and cannot be mass-submitted by one party to steer the system.

## 8. Commitments, claims and scope

Run when the map says commitments = yes, or the bot speaks for the operator.

- [ ] Prices, stock, delivery times, fees and policy text shown in a reply are read from the system of record at answer time; the model may phrase them but not originate them. A stale or absent value yields "I can't confirm that", not a guess.
- [ ] The system cannot grant exceptions, discounts, refunds or eligibility by agreement. Anything of that kind routes to a human or to a tool with its own authorisation (see `ai-agency.md`).
- [ ] Regulated advice (medical, legal, financial, safety-critical) is either out of scope with a tested refusal-and-redirect, or is delivered with the operator's required disclaimers and escalation - enforced in code, not only in the prompt.
- [ ] Statements about the operator's own products, certifications, security or compliance come from approved sources.
- [ ] The bot does not impersonate a named human, claim to be one, or deny being an AI when sincerely asked.
- [ ] Transcripts are retained long enough to show later what the system actually said to a customer.
- [ ] An off-topic or out-of-scope request is declined by a code-level or classifier check as well as by instruction, where the cost or harm of compliance is real.
