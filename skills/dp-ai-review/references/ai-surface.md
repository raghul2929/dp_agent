# AI surface detection

Never assume a project is, or is not, an AI project. Detect it, classify it, and record the result in `reviews/.ai-map.md`. Every later pass reads the map instead of re-deriving it.

## 1. Detect the AI layer

Any one strong marker means an AI layer is present. Record the file and line for each.

| Signal | Look for |
|---|---|
| Provider SDK in a manifest | `openai`, `anthropic`, `google-generativeai`, `google-genai`, `@google/generative-ai`, `groq`, `mistralai`, `cohere`, `ollama`, `litellm`, `boto3` with bedrock calls, Azure OpenAI |
| Orchestration | `langchain*`, `langgraph`, `llama-index`, `haystack`, `semantic-kernel`, `autogen`, `crewai`, `dspy`, `instructor`, `pydantic-ai`, Vercel `ai`, an MCP client or server |
| Local models | `transformers`, `sentence-transformers`, `torch`, `vllm`, `llama-cpp`, `onnxruntime`, model files in the repo or downloaded at boot |
| Vector / search | `qdrant-client`, `chromadb`, `pinecone`, `weaviate`, `pgvector`, `faiss`, `milvus`, Elasticsearch / OpenSearch kNN, Redis vector |
| Call sites | `chat.completions`, `messages.create`, `generate_content`, `.invoke(`, `.stream(`, `embeddings.create`, `.encode(` on an embedder, raw `fetch` / `requests` to a model host |
| Prompt artefacts | `prompts/`, `system_prompt`, `*.prompt`, `*.jinja` / `*.j2` holding instructions, long string constants addressed to "you", `ai_instruction`-style config fields |
| Agents and tools | `tools/`, `agents/`, function-calling schemas, `.mcp.json`, tool registries, planner / executor loops |
| Evals | `evals/`, `promptfoo*`, golden-set files, `*_baseline.*`, judge prompts |
| Env names | `*_API_KEY` for a model provider, `MODEL`, `TEMPERATURE`, `*_ENDPOINT`, `TOKENIZER_*` |
| Non-text inputs | image / PDF / office parsing (`PIL`, `pdfplumber`, `pypdf`, `pytesseract`, OCR services), speech-to-text / text-to-speech (`whisper`, TTS endpoints), file-upload routes feeding a model, vision-capable model calls with image parts |
| Training | `fit` / `Trainer` / `peft` / `trl`, fine-tune job submission, feedback or thumbs-up tables feeding a dataset, dataset-export scripts |
| Streaming and embeds | SSE / websocket handlers on a chat route, an embeddable widget or iframe loader, `postMessage` handlers |

**No marker found:** say "no AI layer detected" and offer `dp-module-review` instead. Stop. Do not manufacture AI findings in a project with no model in it.

## 2. Classify - four axes

Record each axis in the map. They set the default depth and the severity ceiling.

**Autonomy** - the single most important axis.

| Level | Description | Consequence |
|---|---|---|
| L0 | Text in, text out to the same user | Blast radius is brand and the output sink |
| L1 | Reads private or tenant data (RAG, memory, DB lookups) | Isolation and disclosure dominate |
| L2 | Calls read-only tools | Exfiltration channels matter |
| L3 | Calls tools that write, send, spend or delete, with a human approval step | Approval integrity matters |
| L4 | Acts without approval, loops, or runs multiple agents | Treat as Deep by default |

**Audience** - internal staff / authenticated customers / anonymous public.

**Input trust** - for every source that can reach a prompt, mark it trusted (written by the operator's own staff) or untrusted (everything else). Untrusted includes: end-user messages, crawled pages, uploaded files, third-party API data, literature or product feeds, tickets, emails, filenames, stored chat history, tenant-authored instructions, and other agents' output.

**Stakes** - none / money / health or safety / legal or compliance / children / critical infrastructure. Anything above `none` turns on the Auditor persona and the privacy and governance pass.

**Modalities** - text only / images / audio / documents (PDF, office) / video / structured files. Every non-text modality is an extra injection channel (instructions hidden in pixels, audio, metadata or document layers) and an extra data-protection concern (faces, voices, scanned IDs). Record which ones reach a model.

**Commitments** - can the system's words bind the operator? (prices, discounts, refunds, eligibility, policy exceptions, medical / legal / financial statements, delivery promises.) Record yes / no. A `yes` turns on the commitment checks in `ai-quality.md`.

## 3. Trust-boundary table

The heart of the map. One row per path:

| Untrusted source | Enters prompt at | Model call | Output reaches (sink) | Control in between |
|---|---|---|---|---|
| crawled page text | `file:line` | `file:line` | rendered as HTML in the widget `file:line` | sanitiser? validator? none |

Rules for filling it in:
- Trace by reading code, not by naming. A function called `sanitize` that does not sanitise is a finding.
- A control is **code** that runs outside the model. Prompt text asking the model to behave is recorded as `prompt-only`, and a `prompt-only` control counts as **no control**.
- A row with `none` in the last column and a privileged sink is the review's first lead.

## 4. Which references apply

| Component present | Run |
|---|---|
| Any model call | `ai-security.md`, `ai-quality.md`, `ai-reliability.md`, `ai-privacy.md` |
| Retrieval, embeddings, a vector store, a crawler or ingestion path | add `ai-rag.md` |
| Tools, function calling, agents, memory, MCP | add `ai-agency.md` |
| Classifier / extractor that gates a human workflow (a "task agent") | weight `ai-quality.md` §decision safety and `ai-security.md` §decision steering heavily |
| Fine-tuning, training, or a feedback loop that feeds a dataset | add `ai-quality.md` Tier 1 training item and Tier 2 §7, and `ai-security.md` Tier 2 §7 provenance |
| Local model serving | add the supply-chain and deployment items in `ai-security.md` (§7, §11) and the resource items in `ai-reliability.md` |
| Images, audio, documents or other non-text input | add `ai-security.md` Tier 2 §9 and probe family G in `red-team-probes.md` |
| Streaming (SSE / websocket) or an embeddable widget | add `ai-security.md` Tier 2 §10 |
| Commitments = yes | add `ai-quality.md` Tier 2 §8 and probe family H in `red-team-probes.md` |
| Any model, weights, dataset, embedder, tokenizer or hosted model API | add `ai-licenses.md` |
| Any project | `ai-reliability.md` §8 incident readiness, and the mapping in `standards-map.md` |

A reference with nothing to read is recorded in the coverage table as `N/A - no <component> in surface`.

## 5. Risk ranking for AI code

**Highest:** tenant-scoped retrieval and every vector-store write or delete; tool executors; anything that renders, executes or stores model output; any place that builds a prompt from untrusted text; provider-key handling; public endpoints that spend money; ingestion and crawl pipelines; regulated decision paths and their failure branches.

**Medium:** prompt templates with no untrusted inputs, parsers and schemas, caches, usage accounting, fallback chains, eval harnesses.

**Lowest:** UI copy, styling, static assets, config with no model or secret content.

## 6. Existing automation

Note what already guards the AI layer so it is not re-reported: an eval gate in CI, a moderation call, a guardrails library, an output sanitiser the project already uses, provider-side spend caps. Verify each actually runs on the path under review - a library that is installed but not called is not a control.
