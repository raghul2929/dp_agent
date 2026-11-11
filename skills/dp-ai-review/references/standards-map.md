# Standards mapping

Every finding carries a `Maps to:` line so an auditor, a customer security questionnaire, or a later review can trace it. The mapping is a label, not a verdict: it never changes severity, and it is never used to claim compliance.

Primary key is the **OWASP Top 10 for LLM Applications, 2025 edition**. Secondary key is the **NIST AI Risk Management Framework** function. MITRE ATLAS may be cited by name; do not cite ATLAS technique ids unless you have checked them against the current published matrix in this session - omit them rather than guess.

If a web search tool is available and the user's project names a different edition or framework (an internal control framework, ISO/IEC 42001, a customer's questionnaire), map to that as well, and say which edition the labels come from.

## OWASP LLM Top 10 (2025) to this skill

| ID | Risk | Where it is checked |
|---|---|---|
| LLM01 | Prompt Injection | `ai-security.md` Tier 1, Tier 2 §1-§2, §9; `ai-rag.md` §1; probe families A, F, G |
| LLM02 | Sensitive Information Disclosure | `ai-security.md` Tier 2 §3, §5; `ai-privacy.md`; `ai-rag.md` Tier 1 |
| LLM03 | Supply Chain | `ai-security.md` Tier 1 (last items), Tier 2 §7, §11; `ai-quality.md` §7 |
| LLM04 | Data and Model Poisoning | `ai-rag.md` §1; `ai-quality.md` Tier 1 training item, Tier 2 §7 |
| LLM05 | Improper Output Handling | `ai-security.md` Tier 1, Tier 2 §4; probe family A |
| LLM06 | Excessive Agency | `ai-agency.md`; `ai-quality.md` Tier 2 §8 |
| LLM07 | System Prompt Leakage | `ai-security.md` Tier 1, Tier 2 §3; probe family F |
| LLM08 | Vector and Embedding Weaknesses | `ai-rag.md`; probe family C |
| LLM09 | Misinformation | `ai-quality.md` (grounding, evals, commitments) |
| LLM10 | Unbounded Consumption | `ai-reliability.md` Tier 1, Tier 2 §1-§3; `ai-security.md` Tier 2 §6; probe family D |

Some findings map to more than one id - list the primary first. A finding with no honest mapping (a reliability or governance finding, for example) is labelled `no OWASP LLM id` rather than forced into one.

## NIST AI RMF function

| Function | Typical findings |
|---|---|
| **Govern** | no owner, no incident route, no disclosure, no regulatory mapping, no change-control for prompts and models |
| **Map** | missing inventory, unlabelled untrusted inputs, unknown data flows, undefined stakes or intended use |
| **Measure** | no eval set, no recall on the must-not-miss class, no calibration, no drift monitoring, no probe results |
| **Manage** | no kill switch, no rollback, no spend cap, no approval step, no containment |

## Output

The report template carries a `Maps to:` line per finding and a short table counting findings by OWASP id, with `0 found - checked` distinguished from `not checked`. A row marked `not checked` is a coverage gap and is repeated under **Not reviewed**.
