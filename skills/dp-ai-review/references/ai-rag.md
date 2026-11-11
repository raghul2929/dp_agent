# Retrieval, ingestion and tenant isolation pass

Run when the map shows retrieval, embeddings, a vector store, a crawler, or any ingestion path. Retrieval is where multi-tenant AI systems leak: the model cannot be trusted to keep tenants apart, so the data layer has to.


## Tier 1 - always check (Quick and Deep)

- [ ] Every retrieval query is filtered by tenant / user / ACL **inside the vector-store query** (pre-filter), using an identifier taken from the verified session - not post-filtered, not supplied by the client, not chosen by the model.
- [ ] The filter is applied on **every** store operation: vector search, keyword / scroll search, count, get-by-id, re-ranker candidate fetch, cache lookup, update, delete. Diff the list of store operations against the list that carry the filter.
- [ ] Writes, updates and deletes verify the caller owns the target ids, not merely that the ids exist. A service that "only receives ids its caller owns" is a trust assumption - record it and check the caller really does enforce it.
- [ ] The tenant identifier has one type end to end. A string compared with an integer, or a client value that can arrive as a list / object / operator (`any`, `$ne`), must not turn the filter into a wildcard or a silent no-match.
- [ ] Ingested external content (crawl, upload, connector, tenant-editable knowledge base) is treated as untrusted: size and type caps, crawler SSRF protection (internal ranges and metadata addresses blocked, redirects bounded), and provenance stored per chunk (source, uploader, time).
- [ ] Retrieved text enters the prompt as quoted, attributed data and never in the instruction channel.
- [ ] Context budget is enforced and cannot go negative or silently empty; dropped or truncated chunks are observable. An arbitrary drop reads to a customer as "the bot does not know our content".
- [ ] Index and query use the same embedding model, dimension and distance metric; changing the embedder forces a re-index and nothing hard-codes the old dimension in a way that fails silently.
- [ ] Disabled, deleted and expired documents are excluded on **every** retrieval path, including the keyword lane and any cache.
- [ ] Sources shown or cited to the user (titles, URLs, snippets) are limited to what that caller may see.
- [ ] "Nothing relevant found" is a handled state: the model is told what to do and the path does not invent content.

---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Index integrity and poisoning

- [ ] Who can write to the index? Can a low-privilege contributor add a document that outranks authoritative ones (keyword stuffing, title-match boosts, near-duplicate flooding)?
- [ ] Ranking features an attacker controls (title, tags, popularity, recency) are identified. A boost rule keyed to an attacker-writable field is an attack surface.
- [ ] Hidden text in ingested HTML / PDF (zero-size, off-screen, white-on-white, comments, metadata) is stripped or flagged before chunking.
- [ ] A way to quarantine or remove a poisoned source and prove it is gone from retrieval.

## 2. Retrieval quality

- [ ] Chunk size, overlap and heading handling are intentional; metadata survives chunking.
- [ ] Score thresholds and cut-offs are calibrated on real queries and a labelled set, not guessed.
- [ ] Candidate-set limits (scroll limits, top-k) cannot silently exclude the relevant document; the truncation is recorded.
- [ ] Hybrid (keyword + vector) merge logic de-duplicates by id and is stable across runs.
- [ ] Recall is measured on a labelled query set (see `ai-quality.md`).

## 3. Freshness and lifecycle

- [ ] Re-crawl / re-sync cadence is defined; stale content (prices, policies, availability) is not served as current.
- [ ] Update replaces the old chunks rather than adding to them; a failed re-ingest does not leave the document half-deleted.
- [ ] Backfill exists for existing rows when chunking, metadata or the embedder changes.
- [ ] The vector store can be rebuilt from source of record; backups and restore tested.

## 4. Multi-tenant design

- [ ] The choice between a shared collection with a payload filter and one collection per tenant is deliberate and documented; the filter field is indexed.
- [ ] Per-tenant quotas on documents, chunks and ingestion rate - one tenant cannot degrade others.
- [ ] A tenant offboarding path deletes vectors, payloads, caches, logs and eval copies.

## 5. Exposure through the store

- [ ] The vector database is not reachable from outside the trust zone without authentication and TLS; its API key is not shared with unrelated services.
- [ ] Full documents duplicated into every chunk payload are intentional (size, leakage and backup cost noted).
- [ ] Embeddings of sensitive text sent to a third-party embedding API are covered by the same basis as other provider traffic (see `ai-privacy.md`).

## 6. Caches

- [ ] Response and semantic caches are keyed by tenant, user, prompt version, model and knowledge-base version; they expire or are invalidated when the knowledge base changes.

## 7. Attribution and grounding

- [ ] Citations are produced by code from retrieval metadata, not written by the model.
- [ ] Behaviour when retrieved sources conflict is defined.
- [ ] A groundedness check exists, is tested, and its failure has a defined consequence (flag, regenerate, escalate).
