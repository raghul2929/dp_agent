# AI review report template

Copy this structure. Delete sections that genuinely do not apply - but never delete the Coverage, Refutation summary or Not reviewed sections. Those are the honesty guarantee.

---

# AI Review: <component> - <YYYY-MM-DD>

**Verdict: BLOCK | SHIP WITH FIXES | SHIP**
<one sentence of why, naming the rule that fired>

| | |
|---|---|
| Scope | <component path> |
| Autonomy | L0 / L1 / L2 / L3 / L4 |
| Audience | internal / authenticated / anonymous public |
| Stakes | none / money / health or safety / legal or compliance / children |
| Modalities | text / images / audio / documents / video |
| Commitments | can the system's words bind the operator: yes / no |
| Depth | Quick / Deep |
| Surface | <N files, ~N lines> - diff against `<base>` / full tree (no git history) |
| Probes | none / stub provider / real provider (<N> calls, budget <cap>) |
| Reviewed by | Claude Code `/dp-ai-review` |

**Summary:** <2-4 sentences. What the AI feature does, how it is exposed, and the one thing that most needs attention.>

Critical: N | High: N | Medium: N | Low: N

---

## AI inventory

| Component | Provider / model (pinned?) | Purpose | Data classes sent | Where it runs | Retention | Licence / terms (source) |
|---|---|---|---|---|---|---|
| | | | | | | e.g. Apache-2.0 (model card) / custom community licence - needs owner review / hosted API terms |

## Trust boundaries

| Untrusted source | Enters prompt at | Output reaches | Control | Control type |
|---|---|---|---|---|
| | `file:line` | `file:line` | | code / prompt-only / none |

`prompt-only` counts as none.

---

## Blockers - must fix before main

### 1. <One-line claim> `PROVEN | PROBED n/N | CONFIRMED | CONFIRMED (static)`
**Severity:** Critical
**Where:** `path/to/file.py:120`
**Maps to:** <OWASP LLM id(s), primary first, or "no OWASP LLM id"> · <NIST AI RMF function>
**Attack path:** <untrusted source> -> <control, or none> -> <sink / action>
**Failure scenario:** <Specific: a crawled page containing X is retrieved for tenant A; the reply renders it as HTML in the widget and runs a script on the merchant's shop page.>
**Why it happens:** <the actual mechanism, referencing the code>
**Control today:** code / prompt-only / none
**Fix:** <the concrete change, with the code or the exact line to add>

### 2. ...

---

## Should fix

Same format, severity High / Medium.

---

## Nits

Terse list. `file:line` - what and why.

---

## Automated scan results

| Scan | Tool | Result |
|---|---|---|
| Build / typecheck | | |
| Lint | | |
| Tests (deterministic) | | |
| Eval suite | | ran / none exists / could not run |
| Secret scan | | |
| Dependency audit (incl. ML libraries) | | |
| SAST | | |
| AI red-team / eval tool (e.g. promptfoo, garak) | | ran / not installed |
| PII detection (e.g. Presidio) | | ran / not installed |

Record "not installed" or "not configured" honestly. A missing eval suite is itself a finding when a model gates a decision.

---

## Coverage

Every dimension, every time: `Pass` / `Findings` / `N/A` / `Not checked` / `Delegated`. Not-checked requires a reason.

| Dimension | Status | Note |
|---|---|---|
| Prompt injection - direct | | |
| Prompt injection - indirect and stored | | |
| Decision steering | | |
| Authorization enforced outside the model | | |
| Client-supplied fields trusted | | |
| Output handling and sinks | | |
| Multimodal and file inputs | | |
| Streaming, embed and transport surface | | |
| AI deployment, egress and service auth | | |
| System prompt and secret exposure | | |
| Abuse, moderation, scope enforcement | | |
| Supply chain and model provenance | | |
| Tenant isolation in retrieval | | |
| Ingestion, crawling, poisoning | | |
| Index lifecycle and freshness | | |
| Tool permissions and confused deputy | | |
| Human approval for consequential actions | | |
| Loop bounds and kill switch | | |
| Agent memory | | |
| Data flow to third parties | | |
| Basis, retention and deletion | | |
| Disclosure and consent | | |
| Regulatory mapping | | |
| Auditability of decisions | | |
| Cost caps and quotas | | |
| Provider failure handling | | |
| Fallbacks and model pinning | | |
| Observability and alerting | | |
| AI incident readiness | | |
| Prompt quality (composed prompt) | | |
| Binding commitments and unauthorised claims | | |
| Training, fine-tuning and feedback loops | | |
| Evals and regression gate | | |
| Grounding and hallucination | | |
| Output parsing and validation | | |
| Human-in-the-loop design | | |
| Drift and change management | | |
| Open sweep (beyond checklist) | | |
| Completeness critic | | |
| Model, dataset and API licences | | `metadata` / `LICENSE read`; custom licences listed for owner review |
| Package licences (dependencies, vendored files, assets) | Delegated | `dp-module-review` licence pass - ran / offered / declined |
| Classic web / API / database dimensions | Delegated | `dp-module-review` - ran / offered / declined |

---

## Standards coverage

OWASP Top 10 for LLM Applications (2025). `0 found - checked` is different from `not checked`; the second is repeated under Not reviewed.

| ID | Risk | Findings | Status |
|---|---|---|---|
| LLM01 | Prompt Injection | | |
| LLM02 | Sensitive Information Disclosure | | |
| LLM03 | Supply Chain | | |
| LLM04 | Data and Model Poisoning | | |
| LLM05 | Improper Output Handling | | |
| LLM06 | Excessive Agency | | |
| LLM07 | System Prompt Leakage | | |
| LLM08 | Vector and Embedding Weaknesses | | |
| LLM09 | Misinformation | | |
| LLM10 | Unbounded Consumption | | |

---

## Owner-attested items (not verifiable from the repository)

Things the review could not check from code. Record the owner's answer and mark it `attested`, never `verified`.

| Item | Owner's answer | Status |
|---|---|---|
| Provider agreement / data-processing terms in place | | attested / unknown |
| Zero-retention or equivalent enabled at the provider | | attested / unknown |
| Hard spend cap and alert set in the provider console | | attested / unknown |
| Production configuration matches the repository | | attested / unknown |
| Regulations that apply to this product and data | | attested / unknown |
| Licence policy covers models, datasets and hosted APIs (not only packages) | | attested / unknown |

---

## Refutation summary

<N raised, M survived, K refuted, L plausible.> Refuted findings are not listed here, but each is recorded with its reason in the JSON sidecar so a missed real finding can be audited. A refutation that rested on prompt text alone is invalid and was reopened.

---

## Not reviewed

- <files or areas skipped, and why>
- <scans or probes that could not run - e.g. no provider key, so model-behaviour probes were not run>
- <context unavailable - e.g. no git history, so secrets were checked in the snapshot only>
- <regimes that may apply but could not be assessed without the owner>

---

## Recommended next steps

1. <ordered, concrete>
2. ...
