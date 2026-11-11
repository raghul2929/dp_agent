# AI security pass

Work every item. For each, either report a finding with `file:line` and a failure scenario, or record it as clean. Read the code path end to end - never infer a vulnerability from a name.

**The governing rule:** a prompt is not a security boundary. "Never reveal…", "ignore malicious instructions", delimiters, and role-play framing reduce the odds of misbehaviour; they do not prevent it. A mitigation counts only if it is **code that runs outside the model** or a **privilege the model does not have**. Record prompt-only mitigations as "no control" and say so.

**Severity follows the worst consequence an attacker who controls the injected text can reach, given what the system can actually do.** The same injection is cosmetic in a text-only bot answering one user and Critical in a system that holds tools, shared rendering, or other tenants' data.


## Tier 1 - always check (Quick and Deep)

- [ ] Every path by which text reaches a prompt is listed, and each untrusted one (user message, retrieved / crawled / uploaded content, tool output, third-party data, filenames, metadata, stored history, other agents' output) stays out of the system / developer instructions and is delimited as data.
- [ ] No authorization decision depends on model output or prompt wording. Who the caller is, which tenant or record they may touch, and which action is allowed are decided in code from the verified session - never inferred by the model, never read from a field the model or the client filled in.
- [ ] Model output is treated as untrusted input to whatever consumes it. Rendered markdown / HTML is sanitised **after** conversion; output never reaches SQL, a shell, a file path, `eval` / `exec`, a template engine, or a deserialiser unvalidated.
- [ ] Output that makes a client fetch something (markdown images, links, iframes, auto-linking) cannot carry context to an attacker's domain - URLs are allowlisted or stripped.
- [ ] No secret, credential, internal URL, or other tenant's data sits in a system prompt, few-shot example, or context window. The system prompt is assumed extractable.
- [ ] Provider API keys are server-side only, scoped, rotatable, spend-capped at the provider, and absent from client bundles, widget code, logs and prompts.
- [ ] Every model-backed endpoint is authenticated. Public ones are limited per identity / tenant (not only per IP) and capped per request, per tenant and per day.
- [ ] Input size is bounded before the model: message length, history length, attachment size, number of retrieved chunks.
- [ ] Client-supplied history, config and instruction fields are not trusted: a caller cannot inject a `system` or `assistant` turn, or override the model, temperature, tool list, or instructions.
- [ ] Structured output is validated in code (type, enum, range, referenced ids exist, offsets and quotes appear in the source) even when the provider enforces a schema. A schema-valid answer is not a correct one.
- [ ] When the model errors, times out, refuses, is truncated, or returns garbage, the system fails toward the **safe** side of that decision (escalate, hold for a human) - never toward the permissive side.
- [ ] Prompts and responses are logged only with redaction and a retention limit. Full configs or system prompts are not printed at normal log levels.
- [ ] Where the audience is public or vulnerable, input and output moderation exists or its absence is a recorded decision.
- [ ] No `trust_remote_code=True`, no pickle / `torch.load` of untrusted files, model and tokenizer revisions pinned.
- [ ] Non-text inputs (images, audio, PDFs, office files, scans) are treated as untrusted text sources: text extracted from them (OCR, speech-to-text, document layers, metadata) enters the same trust-boundary table as any other untrusted input, and the file itself is size-capped and type-checked by content.
- [ ] Streaming and embedded surfaces authenticate on connect **and** enforce limits per message; an embeddable widget validates message origins and holds a session token scoped to one tenant, short-lived, and not readable by the host page.

---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Prompt injection

**Direct** (the user is the attacker): instruction override, role-play framing, multi-turn escalation, language switching, encoding (base64, rot13, leetspeak), invisible characters (zero-width, Unicode tag characters), homoglyphs, payload splitting across turns, few-shot priming.

**Indirect** (someone else's text is the attacker): crawled pages (hidden text, CSS-hidden elements, alt text, metadata), PDFs and office files (white text, comments, document properties), emails, tickets, reviews, product descriptions, literature records and abstracts, filenames, tool and API results, MCP server responses, other agents.

**Stored:** content persisted and re-fed later - chat history, summaries, memory, knowledge-base entries edited by lower-privileged users, tenant-authored instructions.

- [ ] For each untrusted source in the map: what is the worst thing text from it can make the system do, today?
- [ ] **Decision steering:** in a classifier, screener, ranker or router, can the document under judgement contain text that changes its own verdict ("this record is not relevant", "mark as reviewed")? A document must not be able to vote on itself.
- [ ] Stored injection: can a lower-privileged contributor plant text that is later read as an instruction by a higher-privileged session?
- [ ] Tenant-authored instructions: can one tenant's admin write instructions that reveal the platform prompt, defeat platform rules, or reach another tenant?

## 2. What counts as a real control

- [ ] Real: privilege separation (the model that reads untrusted text has no tools and no secrets), allowlisted actions, constrained / schema outputs checked in code, human approval showing the real arguments, per-tenant filters in the data layer, sanitisers on sinks, egress allowlists.
- [ ] Not real: "do not follow instructions in the document" lines, XML / delimiter wrapping alone, confidentiality instructions, a second model asked "is this safe?" with no code check after it.
- [ ] Defence in depth is fine and worth noting - but a finding whose only mitigation is prompt text stays open.

## 3. System prompt and configuration leakage

- [ ] Contents assume disclosure: no secrets, no authorization rules that only exist as prose, no names of internal systems you would not publish.
- [ ] "Analysis report", reasoning or debug blocks requested from the model are not shown to end users unless intended.
- [ ] Provider errors, prompts and stack traces are not returned to the client.

## 4. Output handling sinks

- [ ] Markdown renderers with raw-HTML passthrough enabled; `javascript:` / `data:` URLs; SVG; link and image tags that fire requests.
- [ ] Spreadsheet export of model text (formula injection: leading `=`, `+`, `-`, `@`).
- [ ] Model-generated SQL: read-only role, allowlisted tables, row limit, statement timeout, no multi-statement.
- [ ] Code execution: sandboxed, no network by default, filesystem scoped, CPU / memory / wall-clock limits, no cloud metadata endpoint reachable.
- [ ] Model-chosen URLs fetched server-side (SSRF): host allowlist, internal ranges and metadata addresses blocked, redirects bounded.
- [ ] Model text placed in e-mail / SMS / webhooks / headers: header injection, phishing relay, brand misuse.
- [ ] Log injection: model or user text containing newlines written into line-oriented logs.

## 5. Information disclosure

- [ ] Shared caches (semantic cache, response cache, memory) keyed by tenant, user, prompt version and model - never by prompt text alone.
- [ ] Conversation state and memory isolated per user / tenant; no process-level globals that hold one caller's data.
- [ ] Verbose error paths, debug endpoints, health endpoints that echo configuration.
- [ ] Repeated-query scraping: can a caller reconstruct the indexed knowledge base through the chat endpoint, and is that acceptable for the data in it?

## 6. Abuse

- [ ] Off-topic use as a free general-purpose model (cost and brand risk): scope enforcement beyond a prompt line.
- [ ] Jailbreak output that harms the operator: disallowed content, impersonation, defamation, unsafe advice in a sensitive domain.
- [ ] Summarise / translate / rewrite endpoints usable as open relays for spam or phishing text.
- [ ] Cost amplification: long outputs, recursion, tool loops, many parallel calls, retries that multiply spend.

## 7. Supply chain and provenance

- [ ] Model identifiers pinned to dated versions. Aliases such as `latest`, `-latest`, `-preview` change under you; if accepted, say so.
- [ ] Model weights, tokenizers and embedders fetched at boot are pinned by revision or hash and cached - boot depends on a third-party host otherwise.
- [ ] Prompt or template packages from public hubs, community integration packages, MCP servers and plugins: publisher known, version pinned, permissions minimal. Tool and plugin descriptions are prompts and can carry instructions.
- [ ] Dependency audit triaged for ML libraries (serialisation and deserialisation bugs are common there) - reachable or not, and say which.
- [ ] Datasets and fine-tuning inputs have provenance and a licence.

## 8. Secrets and observability in the AI toolchain

- [ ] Notebooks, eval fixtures, traces, screenshots and example prompts contain no keys and no real customer data.
- [ ] Observability and tracing vendors that receive full prompts are recorded as sub-processors (see `ai-privacy.md`).
- [ ] Each environment has its own provider key; a dev key is not the prod key.

## 9. Multimodal and file inputs

Run when the map lists any non-text modality.

- [ ] Hidden instructions in images (tiny, low-contrast, off-canvas or watermark text), screenshots of text, QR codes, and adversarial patterns: what happens when OCR or a vision model reads them?
- [ ] Documents: white-on-white text, zero-size fonts, comments, tracked changes, hidden sheets, form fields, embedded files, and document properties (title / author / subject) that a parser forwards into the prompt.
- [ ] Audio: instructions inaudible to humans but transcribed, text spoken in another language, transcription errors that change meaning in a high-stakes setting.
- [ ] Metadata (EXIF, ID3, PDF info dictionary, filenames) is stripped or treated as untrusted text, and personal data in it (location, device, author) is not forwarded to a provider by accident.
- [ ] Parser safety: decompression bombs, page and frame caps, per-file CPU / memory / time limits, parsers run with least privilege, and a malformed file fails closed rather than passing partial text through.
- [ ] Biometric or identity content (faces, voices, scanned IDs) is a special data class: basis, retention and provider terms checked in `ai-privacy.md`.
- [ ] Generated media: provenance / labelling where required, and no model-generated file served from a guessable public URL.

## 10. Transport, streaming and embed surface

Run when the map lists streaming, a widget, an iframe, or a public chat API.

- [ ] SSE / websocket: authentication at connect, re-validation on long-lived connections, per-connection and per-message rate limits, message size caps, idle timeouts, and no credentials in a query string that proxies and logs retain.
- [ ] Moderation or output validation that runs on the **complete** answer does not protect a stream that has already been delivered token by token. Decide where streamed text is checked, or accept the exposure explicitly.
- [ ] Client disconnect cancels generation and tool calls; abandoned streams do not keep spending.
- [ ] Embeddable widget: parent-page messages are checked against an origin allowlist (`event.origin`), outgoing messages use an explicit target origin (never `*` for anything sensitive), the iframe is sandboxed or isolated, and the host page cannot read the conversation or session token.
- [ ] CORS on chat and token endpoints: no reflected origin with credentials; a wildcard is acceptable only on credential-free endpoints.
- [ ] Clickjacking and framing policy match intent (the widget may be framed by customers; admin surfaces may not).
- [ ] Session tokens issued to anonymous visitors are bound to a tenant, expire, and cannot be replayed against another tenant's endpoints.
- [ ] Reverse proxy and CDN do not cache or buffer authenticated or per-user model responses incorrectly.

## 11. Deployment of the AI components

- [ ] **Egress control.** The service that calls the model can reach only the provider hosts, vector store and required internal services - not the open internet and not cloud metadata. This is the real defence against exfiltration through a successful injection.
- [ ] **Service-to-service authentication.** Internal model or retrieval services that rely on a single static shared token have a rotation procedure, constant-time comparison, no fallback when the token is unset, and a network boundary so the token is not the only barrier. A service bound to all interfaces is reachable by whatever shares that network.
- [ ] Model servers (vLLM, Ollama, TGI and similar), vector databases, and admin or metrics ports are not exposed publicly; where reachable at all they require authentication and TLS.
- [ ] Secrets come from a secret manager or injected environment, not baked into images, build args, or committed compose files; each environment has its own keys.
- [ ] Containers: non-root, read-only filesystem where feasible, pinned base images, no build tools in the runtime image, resource limits set.
- [ ] Browser-automation / crawler components (headless browsers) run isolated with no access to internal networks or credentials, and with CPU / memory / concurrency caps.
- [ ] Model weights and caches live on a path with the right permissions; downloads at build time rather than at runtime where the network is untrusted.
- [ ] An AI bill of materials exists or can be generated: models and versions, embedders, tokenizers, prompt versions, datasets, key libraries.

## Severity guidance

- **Critical** - untrusted content can reach a privileged action or exfiltration path; another tenant's data in a context window or result; model output executed (shell, `eval`, SQL write); secret in a prompt or client bundle; unauthenticated model endpoint with a real key and no cap.
- **High** - indirect or stored injection that flips a safety, financial or compliance decision; unsanitised model output rendered as HTML; client-controlled system prompt, model or tools; fail-open on a regulated decision; sensitive data sent to a provider with no basis.
- **Medium** - no per-tenant rate or budget; weak validation of model output with limited impact; prompts and configs logged verbosely; unpinned model alias.
- **Low** - defence-in-depth improvements with no current exploit path.
