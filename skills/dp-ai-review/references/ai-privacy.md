# Privacy, compliance and governance pass

AI systems move data to third parties by design. This pass establishes what leaves, why it is allowed, how long it lives, and whether a decision can be explained later. It flags where a regime plausibly applies and what evidence is missing - it is not legal advice, and it does not assume which laws apply: state what the project's domain suggests and ask.


## Tier 1 - always check (Quick and Deep)

- [ ] **Data-flow inventory.** Which data classes (personal data, health data, financial data, credentials, children's data, customers' customers' data, trade secrets) go to which third party (model provider, embedding API, speech, search, crawler, observability), in which region.
- [ ] **Basis for each flow.** A data-processing agreement exists; the provider's data-use terms were checked (training on inputs, retention, abuse-monitoring access); a zero-retention or enterprise tier is used where the data class demands it; sub-processors are disclosed to customers.
- [ ] **Minimisation.** Only needed fields are sent; names, e-mails, phone numbers and identifiers are redacted or pseudonymised before the call where feasible; history is truncated; whole records are not dumped into a prompt.
- [ ] **Derived data is data.** Stored prompts, responses, embeddings, traces and caches are classified like their source: access-controlled, encrypted where the source is, with a retention period, and **deletable on request across every copy** - vector store, caches, logs, traces, eval datasets, backups.
- [ ] **Disclosure.** Users are told they are talking to an AI and what happens to what they type, where required; a route to a human exists.
- [ ] **No real data in the repo.** Prompts, few-shot examples, eval fixtures, notebooks and screenshots contain synthetic data only.
- [ ] **High-stakes decisions have an accountable human** who sees the evidence. This is enforced by workflow (the system cannot finalise), not by a disclaimer.
- [ ] **Residency.** Provider region and storage location meet any residency requirement.
- [ ] **Logging.** Prompt / response logging is on purpose, redacted, retention-limited, and access-controlled - not a side effect of `print`.

---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Regulatory mapping

Name which regimes the project's domain plausibly triggers, and list the missing evidence. Do not claim compliance.

- [ ] Personal data: lawful basis, purpose limitation, data-subject access and erasure, international transfers, a privacy impact assessment where profiling or large-scale sensitive data is involved, and rules on solely automated decisions with significant effects.
- [ ] Health data: business-associate or equivalent agreements with the provider, minimum-necessary use.
- [ ] Regulated life-sciences or safety workflows (e.g. pharmacovigilance): data integrity (attributable, legible, contemporaneous, original, accurate), audit trails, electronic-record and e-signature rules, computerised-system validation, regulatory clock obligations that an AI step must not silently miss.
- [ ] Payment data: card data never enters a prompt, a log or an embedding.
- [ ] Children: age gating and consent where the audience may include minors.
- [ ] AI-specific rules and frameworks: risk classification, transparency, human oversight, logging and record-keeping duties; a recognised management framework if the customer expects one.
- [ ] Contractual commitments to customers (security questionnaires, SLAs) match what the system really does.

## 2. Auditability

For every AI-assisted decision, can this be reconstructed months later?

- [ ] Reference to the exact input; prompt / template version; model identifier and version; parameters; retrieved context ids; raw output; parsed output; any human action and reviewer identity; timestamps.
- [ ] Records are tamper-evident or append-only where the domain requires it.
- [ ] Provider non-determinism is acknowledged: raw outputs are stored because re-running will not reproduce them.
- [ ] A fallback or retry that changed the model is visible in the record.

## 3. Bias and fairness (where decisions affect people)

- [ ] Error rates are measured by segment that matters (language, region, content type), not only overall.
- [ ] Non-English and low-resource-language behaviour is tested if users write in them.
- [ ] Responses are accessible (reading level, assistive technology) where the audience requires it.

## 4. Transparency and explanation

- [ ] User-visible reasons are drawn from real evidence (citations, quoted spans), not post-hoc rationalisation.
- [ ] Any "confidence" shown means something measurable (see `ai-quality.md`).
- [ ] Explanations do not leak the instructions.

## 5. Intellectual property and terms

- [ ] Scraped or retrieved content respects robots rules and terms; verbatim reproduction of third-party content is bounded and attributed.
- [ ] Generated content ownership and licence terms are known.
- [ ] Model, dataset and hosted-API licences and terms are checked against the licence policy - see `ai-licenses.md`.

## 6. Retention and deletion mechanics

- [ ] Provider-side retention is known and acceptable.
- [ ] Tenant offboarding and user deletion reach vectors, caches, logs, traces, eval sets and backups, with a stated lag for backups.

## 7. Observability vendors

- [ ] Any tracing / evaluation / monitoring service that receives prompts is listed as a sub-processor, with redaction applied before export.
