# Model, data and API licence pass

Package licences (libraries, vendored files, fonts, icons) belong to `dp-module-review`'s `licenses.md` and are marked `Delegated` here. This pass covers the artefacts only an AI project has: **model weights, datasets, embedders and rerankers, tokenizers and corpora, prompt and agent packs, hosted-model terms, and generated output**.

The same boundaries apply as there: this is a compliance check against the declared policy, not legal advice. **Custom model licences are never declared "compatible" by the review** - they are listed with the clause that needs a human, and sent to the owner. Read the policy from `LICENSE_POLICY.md` / `CLAUDE.md` (format: `templates/license-policy.md`); if there is none, run report-only.

The cardinal rule: **a model being free to download is not a licence**. "Open weights" ranges from Apache-2.0 and MIT, through custom community licences with conditions, to research-only and non-commercial terms.

## Tier 1 - always check (Quick and Deep)

- [ ] Every model in use - hosted API, open weights, embedder, reranker, tokenizer, speech model - is listed in the AI inventory with its **licence or terms and where they came from** (the licence file, the model card, the provider's terms page) - read in this session, not recalled from memory.
- [ ] Open-weight licences are compared with the policy. Apache-2.0 and MIT weights match an "MIT or Apache" allowlist. **Custom community licences, use-restricted (RAIL-family) licences, research-only and non-commercial licences do not**, however freely the weights download. List each with its conditions (user-count thresholds, naming or attribution requirements, acceptable-use flow-down, field-of-use limits, territory limits).
- [ ] **Model-card licence versus training-data terms.** A model that declares a permissive licence but was trained or fine-tuned on data with narrower terms (non-commercial or research-only datasets, scraped content) is flagged for a human reading. The review does not decide it either way.
- [ ] Datasets used for training, fine-tuning, evaluation, few-shot examples and the retrieval corpus have a recorded **source and licence**. Scraped data is checked against the site's terms and robots rules; user-submitted data is covered by terms that allow the use.
- [ ] **Hosted APIs** are governed by terms of service, not by an open-source licence. Record: output ownership, restrictions on using outputs (for example to build a competing model), acceptable-use obligations, attribution or branding requirements - and the owner's answer to whether the policy covers hosted APIs at all (`attested`).
- [ ] Obligations that attach to what the project **redistributes or sells** on top of a model are identified: notices, name requirements, flow-down of acceptable-use terms to customers.
- [ ] Weights, tokenizers and corpora downloaded at runtime from a hub are **pinned to a revision** with the licence recorded for that revision. For gated models, whose account accepted the terms - a named individual's or the organisation's?
- [ ] Prompt, template, agent and skill packs taken from public hubs or repositories are licence-checked like code. Many have none.
- [ ] Output rights are recorded: who owns generated content, whether outputs may be used to train other models, and - for any code-generating feature - whether output may reproduce licensed code.

---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Derivatives and redistribution

- [ ] Fine-tuned, merged, distilled or quantised models inherit the base model's terms. Publishing or shipping weights, adapters or merges triggers redistribution conditions.
- [ ] Distilling from a hosted model's outputs, or training on conversation logs that contain such outputs, may be restricted by the provider.

## 2. Conditions inside custom licences

- [ ] Scale thresholds (monthly active users, revenue), naming rules ("built with…" notices, required model-name prefixes), prohibited uses, and territory or field-of-use limits are checked against the product's actual size, audience and markets.
- [ ] The project does not depend on a licence grant that the provider can withdraw on notice, without a fallback model.

## 3. Embedders, rerankers and classifiers

- [ ] Licence **and** training-data terms recorded for each (see Tier 1). Switching an embedder forces a re-index and may change the licence - the change is reviewed, not just the benchmark.
- [ ] Embedding or reranking through a third-party API: terms for stored vectors and for sending content.

## 4. Language data shipped with libraries

- [ ] Tokenizer vocabularies, NLTK-style corpora, language-model packages (for example spaCy-style model downloads) and word lists carry licences **separate from the library's code**. Inventory them; the code licence does not cover them.

## 5. The retrieval and screening corpus

- [ ] Crawled third-party pages: copyright and terms of the sites, robots rules, whether storing and quoting the text is permitted, and what the product shows back to users.
- [ ] Scientific and literature sources have their own reuse terms, which can differ between a database's metadata, abstracts and full texts, and between articles. Verify before storing, embedding, or displaying them at scale.
- [ ] Customer-provided content: the contract allows indexing and model processing; deletion on exit reaches the vectors (see `ai-privacy.md`).

## 6. AI tooling

- [ ] Orchestration frameworks, MCP servers, plugins and eval tools: licence recorded (their code licences are in `licenses.md`; their terms for hosted services are here).
- [ ] Observability and evaluation SaaS: terms on data use and retention (see `ai-privacy.md` §7).

## 7. Evidence

- [ ] The AI inventory (report template) carries a **Licence / terms** column, and every custom or restricted entry is in the exceptions register with an owner and expiry.
- [ ] A named person (counsel or the product owner) has reviewed each custom licence. Until then it is `unknown` in the report.

## Severity guidance

- **Critical** - a model, dataset or weight set under a non-commercial, research-only or deny-listed licence in a shipped or commercial path.
- **High** - a custom or use-restricted model licence with no recorded review; training or retrieval data with unknown or unsuitable terms; hosted-API terms that conflict with the product's use (for example competing-model training).
- **Medium** - model-card licence in tension with training-data terms and not reviewed; unpinned revision for a model whose licence may change; missing notice or attribution a licence requires.
- **Low** - undocumented licence for a non-shipped evaluation asset; no licence column in the inventory.

Label each finding **`metadata`** (read from a card or manifest) or **`LICENSE read`**, and name the clause that needs a human.
