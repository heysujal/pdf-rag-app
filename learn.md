# PDF Chat — Complete Learning Guide

> A deep-dive into this repository: what it is, how it's built, how a request flows end-to-end, why each decision was made, where it breaks under load, and how to talk about all of it in an interview.

---

## Table of Contents

1. [What This App Does](#1-what-this-app-does)
2. [Tech Stack](#2-tech-stack)
3. [Repository Layout](#3-repository-layout)
4. [High-Level Architecture](#4-high-level-architecture)
5. [The Two Pipelines (Ingestion & Query)](#5-the-two-pipelines)
6. [End-to-End Flow: Upload a PDF](#6-end-to-end-flow-upload-a-pdf)
7. [End-to-End Flow: Ask a Question](#7-end-to-end-flow-ask-a-question)
8. [RAG Concepts Used Here](#8-rag-concepts-used-here)
9. [Multi-Tenancy: How Users Are Isolated](#9-multi-tenancy-how-users-are-isolated)
10. [Frontend Deep Dive](#10-frontend-deep-dive)
11. [Backend Deep Dive](#11-backend-deep-dive)
12. [Worker Deep Dive](#12-worker-deep-dive)
13. [Infrastructure & Deployment](#13-infrastructure--deployment)
14. [Error Handling, Reliability & Failure Modes](#14-error-handling-reliability--failure-modes)
15. [Security Model (and Its Current Hole)](#15-security-model-and-its-current-hole)
16. [How This Project Scales](#16-how-this-project-scales)
17. [Known Gaps & Improvement Roadmap](#17-known-gaps--improvement-roadmap)
18. [Interview Q&A — System Design & Scaling](#18-interview-qa--system-design--scaling)
19. [Interview Q&A — RAG & AI](#19-interview-qa--rag--ai)
20. [Interview Q&A — Backend / Node / Queues](#20-interview-qa--backend--node--queues)
21. [Interview Q&A — Frontend / React / Next.js](#21-interview-qa--frontend--nextjs)
22. [Interview Q&A — DevOps & Docker](#22-interview-qa--devops--docker)
23. [The 2-Minute Project Pitch](#23-the-2-minute-project-pitch)
24. [Glossary](#24-glossary)

---

## 1. What This App Does

**PDF Chat** is a RAG (Retrieval-Augmented Generation) application. A signed-in user uploads a PDF; the system reads it, splits it into chunks, converts each chunk into a vector embedding, and stores those vectors in a vector database. Later, the user asks a natural-language question. The system embeds the question, finds the most semantically similar chunks *belonging to that user*, stuffs them into an LLM prompt as context, and returns a grounded answer.

The core promise: **the model answers only from your documents**. If the answer isn't in the retrieved context, the system prompt forces it to say `"Not found in document."` — this is the anti-hallucination guardrail.

Two things make this more than a toy:

1. **Asynchronous ingestion.** PDF parsing + embedding is slow (seconds to minutes). It is pushed onto a queue and processed by a separate worker, so the HTTP upload request returns in milliseconds with `202 Accepted`.
2. **Per-user data isolation.** All users share one vector collection, but every vector is tagged with the owner's email and every retrieval is filtered by it, backed by a database-level payload index so the filter is fast.

---

## 2. Tech Stack

### Frontend
| Layer | Choice | Version | Why |
|---|---|---|---|
| Framework | Next.js (App Router) | 16.1.1 | RSC by default, file-based routing, easy Vercel deploy |
| UI library | React | 19.2.3 | Latest concurrent React |
| Auth | Clerk (`@clerk/nextjs`) | 6.36 | Drop-in hosted auth; no user table to build |
| Styling | Tailwind CSS v4 + `tw-animate-css` | v4 | Utility CSS, no separate config file in v4 |
| Components | shadcn/ui (Radix Slot + CVA) | — | Copy-in components you own, not an opaque dependency |
| Icons | `lucide-react` | 0.562 | Tree-shakeable SVG icons |
| Class merging | `clsx` + `tailwind-merge` via `cn()` | — | Conflict-free conditional Tailwind classes |
| Hosting | Vercel (`pdfask.vercel.app`) | — | Zero-config Next.js hosting + CDN |

### Backend
| Layer | Choice | Version | Why |
|---|---|---|---|
| Runtime | Node.js (ESM, `"type": "module"`) | 22-alpine | Modern JS, `node --watch` for hot reload |
| HTTP framework | Express | 5.2 | Minimal, well-understood |
| File upload | Multer (disk storage) | 2.0 | Streams multipart to disk instead of RAM |
| Job queue | BullMQ | 5.66 | Redis-backed, retries, backoff, concurrency |
| Broker / store | Redis | 8-alpine | Queue backing store |
| Orchestration | LangChain JS (`@langchain/*`) | 1.x | Loaders, splitters, vector-store + retriever abstractions |
| PDF parsing | `pdf-parse` via LangChain `PDFLoader` | 1.1 | Text extraction per page |
| Embeddings | Google `gemini-embedding-001` | — | Free tier, strong quality |
| LLM | Google `gemini-2.5-flash-lite` | — | Cheapest/fastest Gemini tier; enough for extractive QA |
| Vector DB | Qdrant (`@langchain/qdrant`) | 1.0 | Rust-based, payload filtering + payload indexes, HNSW |
| CORS | `cors` | 2.8 | Origin allowlist |
| Config | `dotenv` | 16.6 | `.env` loading |

### Infrastructure
| Piece | Choice |
|---|---|
| Containerization | Docker + Docker Compose |
| Images | `Dockerfile.server`, `Dockerfile.worker`, `Dockerfile.mono` |
| Local services | `redis:8-alpine`, `qdrant/qdrant` |
| Volumes | `redis-data`, `qdrant-data`, `uploads-data` (shared between server & worker) |
| Prod topology | Frontend on Vercel; backend either as two services (server + worker) or one mono-container running both via `concurrently` |

---

## 3. Repository Layout

```
pdf-chat/
├── client/                          # Next.js frontend
│   ├── app/
│   │   ├── layout.tsx               # ClerkProvider, header, signed-in/out gate
│   │   ├── page.tsx                 # Two-pane shell: sidebar (upload) + chat
│   │   ├── globals.css              # Tailwind v4 + design tokens
│   │   └── components/
│   │       ├── file-upload.tsx      # 'use client' — multipart POST /upload/pdf
│   │       └── query-input.tsx      # 'use client' — chat UI, GET /ask
│   ├── components/ui/               # shadcn primitives (button, input)
│   ├── lib/utils.ts                 # cn() helper
│   ├── proxy.ts                     # Next 16's middleware file → clerkMiddleware()
│   ├── docs/UI-CHANGES-JOURNEY.md   # Rationale behind UI decisions
│   └── .env                         # NEXT_PUBLIC_API_URL, Clerk keys
│
├── server/                          # Node backend (API + worker share one package)
│   ├── index.js                     # Express API: /, /ask, /upload/pdf
│   ├── worker.js                    # BullMQ worker: parse → split → embed → store
│   ├── create-index.js              # One-off script: create Qdrant payload index
│   └── .env                         # GEMINI_API_KEY, QDRANT_*, REDIS_*
│
├── docker-compose.yml               # redis + qdrant + server + worker
├── Dockerfile.server                # API-only image
├── Dockerfile.worker                # Worker-only image
├── Dockerfile.mono                  # Both processes in one container (concurrently)
└── Readme.md                        # Local dev setup
```

**Note on `server/`:** the API and the worker live in the same npm package and share one `node_modules`. Two different entrypoints (`index.js`, `worker.js`), one dependency tree. This is a deliberate simplification — it keeps LangChain/Qdrant/Gemini config identical on both sides, at the cost of the worker image carrying Express and the API image carrying `pdf-parse`.

---

## 4. High-Level Architecture

```
                        ┌────────────────────────────────────┐
                        │            BROWSER                  │
                        │  Next.js (Vercel) + Clerk session   │
                        └───────┬─────────────────────┬───────┘
                                │                     │
              POST /upload/pdf  │                     │  GET /ask?email&query
              (multipart)       │                     │
                                ▼                     ▼
                        ┌────────────────────────────────────┐
                        │   EXPRESS API  (stateless, :3001)  │
                        │   • CORS allowlist                 │
                        │   • Multer → disk                  │
                        │   • BullMQ producer                │
                        │   • Retriever + LLM call           │
                        └───┬──────────────┬────────────┬────┘
             enqueue job    │              │ similarity │ prompt
                            ▼              │  search    ▼
                     ┌────────────┐        │      ┌──────────────┐
                     │   REDIS    │        │      │ Gemini LLM   │
                     │  (BullMQ)  │        │      │ 2.5-flash-   │
                     └─────┬──────┘        │      │ lite         │
                           │ dequeue       │      └──────────────┘
                           ▼               │
                     ┌────────────┐        │
                     │  WORKER    │        │
                     │ concurrency│        │
                     │    = 5     │        │
                     └─────┬──────┘        │
        load → split → embed              │
                           │               │
                           ▼               ▼
                     ┌────────────────────────────┐
                     │        QDRANT              │
                     │ collection:                │
                     │  career-timeline-collection│
                     │ payload index:             │
                     │  metadata.email (keyword)  │
                     └────────────────────────────┘
                                 ▲
                                 │ embed()
                          ┌──────────────────┐
                          │ Gemini Embeddings│
                          │ gemini-embedding-│
                          │       001        │
                          └──────────────────┘
```

**Key architectural property: the write path and the read path are fully decoupled.** They share only Qdrant. The API never parses a PDF; the worker never serves HTTP. You can scale, deploy, and fail them independently.

---

## 5. The Two Pipelines

### Pipeline A — Ingestion (write path, async)

```
PDF file
  → Multer writes to ./uploads/<timestamp>-<rand>-<name>.pdf
  → BullMQ job 'chunkify' { name, dest, path, email }
  → Worker: PDFLoader.load()            → 1 Document per page
  → RecursiveCharacterTextSplitter      → chunks of 1000 chars, 200 overlap
  → attach metadata { ...pageMeta, fileName, email }
  → GoogleGenerativeAIEmbeddings.embedDocuments()  → vectors
  → Qdrant upsert into career-timeline-collection
  → ensure payload index on metadata.email
```

### Pipeline B — Query (read path, sync)

```
"What was my last role?"
  → GET /ask?email=...&query=...
  → embed(query)                              → 1 query vector
  → Qdrant search: top-k=5 WHERE metadata.email == email  (HNSW + filter)
  → join the 5 chunks with "\n---\n"          → context string
  → SYSTEM_PROMPT (strict grounding) + context
  → gemini-2.5-flash-lite.invoke([system, human])
  → { message: "..." }
```

**Why these two are separate:** embedding a 50-page PDF can take 30–120s and is CPU/network bound. If that happened inside the HTTP request, you'd hit load-balancer timeouts (typically 30–60s), block a Node event loop slot, and lose the whole job if the client disconnected. Queueing converts a fragile long request into a durable, retryable background task.

---

## 6. End-to-End Flow: Upload a PDF

**Step 1 — User picks a file.** `file-upload.tsx` keeps a hidden `<input type="file" accept="application/pdf">` and a visible styled `<Button>` that calls `fileInputRef.current?.click()`. This is the standard pattern for styling file inputs, which are notoriously hard to style natively.

**Step 2 — Client builds `FormData`.**
```ts
const formData = new FormData();
formData.append('pdfFile', file);
formData.append('email', email);   // from Clerk's useUser()
```
Note there is **no** `Content-Type` header set manually — the browser must set `multipart/form-data; boundary=...` itself, and setting it by hand breaks the boundary.

**Step 3 — `POST ${NEXT_PUBLIC_API_URL}/upload/pdf`.** Direct browser → Express. No Next.js API route in between (see [Q: why no BFF?](#18-interview-qa--system-design--scaling)).

**Step 4 — Multer writes to disk.** `multer.diskStorage` with a filename of `Date.now() + '-' + random(1e9) + '-' + originalname`. Disk (not memory) storage means a 100 MB PDF doesn't become a 100 MB Buffer in the Node heap.

**Step 5 — Enqueue and return immediately.**
```js
await q.add('chunkify', { name, dest, path, email }, {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: true,
  removeOnFail: false,
});
return res.status(202).json({ success: true, message: "PDF is being processed" });
```
- `202 Accepted` is the semantically correct code: "I took your request, it isn't done yet."
- `attempts: 3` + exponential backoff (5s, 10s, 20s) covers transient Gemini/Qdrant errors.
- `removeOnComplete: true` keeps Redis memory bounded; `removeOnFail: false` keeps failures for debugging.

**Step 6 — Worker picks up the job** (see [§12](#12-worker-deep-dive)).

**Step 7 — Client shows optimistic status.** `status: 'success'` with "PDF is being processed." The UI never learns when processing actually completes — this is a real, acknowledged gap (see [§17](#17-known-gaps--improvement-roadmap)).

---

## 7. End-to-End Flow: Ask a Question

**Step 1 — Optimistic UI.** The user message is appended to state before the network call, so the chat feels instant:
```ts
setMessages(prev => [...prev, userMsg]);   // functional update — never reads stale closure
input.value = '';
setIsLoading(true);
scrollToBottom();
```

**Step 2 — `GET /ask?email=…&query=…`** with both params `encodeURIComponent`-ed (emails contain `@` and `+`; queries contain spaces, `&`, `?`).

**Step 3 — Server validates.** Missing email → `"Email not found"`; non-string query → `400`.

**Step 4 — Build the retriever.**
```js
vectorStore.asRetriever({
  k: 5,
  filter: { must: [{ key: "metadata.email", match: { value: email } }] }
});
```
`k: 5` is the retrieval budget. At ~1000 chars per chunk that's ~5000 chars ≈ **1250 tokens of context** — cheap, fast, and enough for focused questions.

**Step 5 — Retrieve + guard.** `docs.length === 0` → `"No data found for your account."` rather than letting the LLM answer from its own parametric memory.

**Step 6 — Stuff the context.**
```js
const context = docs.map(d => d.pageContent).join("\n---\n");
```
The `---` separator matters: it tells the model these are *distinct, unordered* passages, not one continuous document.

**Step 7 — Strict system prompt.** Five rules: answer only from context; say exactly `"Not found in document."` otherwise; handle non-questions politely; add nothing; infer nothing. Combined with `temperature: 0`, this makes the model near-deterministic and extractive.

**Step 8 — Return `{ message }`; any throw becomes `503`** with details, and the client's `getApiMessage()` normalizes every possible response shape (string | `{message}` | `{error, details}` | 429) into a single display string.

---

## 8. RAG Concepts Used Here

**Why RAG at all?** Three reasons you should be able to recite: (1) LLMs have a knowledge cutoff and never saw the user's private PDF; (2) context windows are finite and expensive — you can't paste a 500-page manual into every request; (3) grounding in retrieved text makes answers verifiable and reduces hallucination.

**Chunking — why 1000/200?** `RecursiveCharacterTextSplitter` tries separators in order (`\n\n` → `\n` → ` ` → `""`), so it prefers to break at paragraph boundaries and only falls back to hard character cuts. Chunk size is a trade-off:
- Too small → a chunk lacks enough context to be a self-contained answer.
- Too large → the embedding vector becomes an average of many topics ("semantic dilution") and retrieval precision drops.
- **200-char overlap (20%)** ensures a sentence that straddles a boundary still appears whole in at least one chunk.

**Embeddings.** `gemini-embedding-001` maps text → a high-dimensional float vector where semantic similarity ≈ cosine similarity. This is what lets "What's my last job?" match a chunk that says "Senior Engineer, 2023–present" with zero keyword overlap.

**Vector search.** Qdrant uses **HNSW** (Hierarchical Navigable Small World), an approximate-nearest-neighbour graph index. Exact search is O(N) per query; HNSW is ~O(log N) at ~95–99% recall. You trade a sliver of accuracy for orders-of-magnitude speed.

**Stuffing.** This app uses the simplest chain type — concatenate all retrieved chunks into one prompt. Alternatives (`map_reduce`, `refine`, `map_rerank`) exist for when retrieved content exceeds the context window; with k=5 it never does here.

**Temperature 0.** For extractive document QA, creativity is a bug. Zero temperature makes the same question produce the same answer, which also makes caching viable.

---

## 9. Multi-Tenancy: How Users Are Isolated

There is **one Qdrant collection for all users**: `career-timeline-collection`. Isolation is achieved by *payload filtering*, not by physical separation.

**Write side** (`worker.js`): every chunk carries `metadata.email`.
```js
metadata: { ...doc.metadata, fileName: name, email: email }
```

**Read side** (`index.js`): every search carries a mandatory filter on `metadata.email`.

**The critical detail — the payload index.** Without an index, Qdrant would either scan the whole collection or apply the filter *after* the HNSW walk, which can return fewer than `k` results (or none) because the graph traversal wandered into other tenants' vectors. So the code creates:
```js
client.createPayloadIndex("career-timeline-collection", {
  field_name: "metadata.email",
  field_schema: "keyword"
});
```
This is Qdrant's documented multi-tenancy pattern: one collection + an indexed tenant key. It lets Qdrant do *filterable HNSW* — restricting graph traversal to the tenant's subgraph.

**Why not one collection per user?** Each collection carries fixed memory and index overhead. With thousands of users you'd get thousands of sparse collections, each with a poorly-connected HNSW graph. One collection + index scales far better for many-small-tenants. (Collection-per-tenant *is* the right answer for a handful of very large tenants, e.g. enterprise customers with compliance requirements.)

**The bug this design once had, and how it was fixed** — visible in the code comments: the filter originally used `key: "email"` but LangChain nests custom metadata under a `metadata` payload object, so the correct key is `metadata.email`. The filter silently matched nothing. Two artifacts remain from that debugging session: the "OPTION 1 / OPTION 2" comment block in `getRetriever`, and the standalone `create-index.js` script.

---

## 10. Frontend Deep Dive

### Server Components vs Client Components
`app/page.tsx` and `app/layout.tsx` are **Server Components** — zero JS shipped for the shell. Only the two interactive leaves (`file-upload.tsx`, `query-input.tsx`) carry `'use client'`. This is the "push `use client` to the leaves" rule: the boundary should be as deep in the tree as possible.

### Auth gating at the layout level
```tsx
<SignedIn>{children}</SignedIn>
<SignedOut>…sign-in / sign-up buttons…</SignedOut>
```
The entire app is behind auth in one place rather than per-page. `proxy.ts` (Next 16's replacement for `middleware.ts`) runs `clerkMiddleware()` on every non-static route so the session is available everywhere.

### `useRef` for the input instead of `useState`
`query-input.tsx` reads the query via `inputRef.current.value`, not controlled state. Deliberate: a controlled input re-renders the whole chat list on **every keystroke**. With an uncontrolled input, typing causes zero React renders.

### The `getApiMessage` normalizer
One function converts four possible backend response shapes into one string. Without it, shape-handling logic would be duplicated at every call site and raw internals would leak into the assistant bubble.

### Timing details that matter
- **`requestAnimationFrame` for scroll.** Scrolling right after `setMessages` reads a pre-update `scrollHeight`. rAF fires just before the next paint, after React has committed — so the height is correct.
- **`setTimeout(focus, 0)`.** In `finally`, `setIsLoading(false)` hasn't re-rendered yet, so the input is still `disabled` and `.focus()` is a no-op. Deferring one macrotask lets React re-enable it first.
- **`crypto.randomUUID()` keys.** Stable identity per message so React never reuses the wrong DOM node.
- **Functional `setState`.** `setMessages(prev => [...prev, m])` never reads a stale closure value.

### Design system
Tailwind v4 with CSS custom properties as design tokens (`--background`, `--foreground`, `--muted`, `--primary`, …), shadcn/ui components built on Radix `Slot` + `class-variance-authority` for variants, and `cn()` = `twMerge(clsx(...))` so later conditional classes reliably win over earlier ones.

---

## 11. Backend Deep Dive

### Express 5 + ESM
`"type": "module"` everywhere. Express 5 auto-forwards rejected promises from async handlers to the error middleware (Express 4 did not) — though this code still uses explicit `try/catch` for control over status codes.

### CORS allowlist
```js
app.use(cors({ origin: ['http://localhost:3000', 'https://pdfask.vercel.app'] }))
```
An explicit allowlist rather than `origin: '*'`. Hardcoded today; should be env-driven (see [§17](#17-known-gaps--improvement-roadmap)).

### Health check that doesn't touch dependencies
```js
app.get('/', (req, res) => res.status(200).json({ status: "ok", service: "pdf-rag-server" }));
```
Deliberately does **not** ping Qdrant or Redis. A *liveness* probe answers "is this process alive?" — if it also checked downstream services, a Qdrant hiccup would make the orchestrator kill and restart healthy API pods, turning a partial outage into a total one. (A separate `/ready` endpoint *should* check dependencies — that's the readiness probe.)

### Lazy connection to Qdrant
`getRetriever()` is called per request rather than at boot. The upside: the server starts and serves health checks even if Qdrant is down, so deploys don't crash-loop. The downside: `let retriever = null; let initPromise = null;` are declared at module scope but **never assigned** — the caching that was intended was never wired up, so every `/ask` builds a fresh embeddings client and vector-store connection. Easy, high-value fix (see [§17](#17-known-gaps--improvement-roadmap)).

### Graceful shutdown
```js
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```
Closes the BullMQ queue before `process.exit(0)`. Without this, a container stop mid-`q.add()` could leave a connection dangling or a job half-written.

---

## 12. Worker Deep Dive

```js
new Worker('file-upload-queue', jobProcessor, {
  concurrency: 5,
  connection: { host, port, password }
});
```

**`concurrency: 5`** means up to 5 jobs are processed in parallel *in one Node process*. This works because the work is overwhelmingly I/O-bound — waiting on Gemini's embedding API and Qdrant writes — so the event loop is free while requests are in flight. PDF parsing is the one CPU-bound step; if PDFs get large, that becomes the bottleneck and the right move is more worker *processes*, not higher concurrency.

**Job processing steps** with defensive checks at each one:
1. Validate `email` is present (throws → BullMQ retries).
2. `fs.existsSync(path)` — catches the classic bug where server and worker containers don't share the uploads volume. This is exactly why `docker-compose.yml` mounts `uploads-data` into **both**.
3. `PDFLoader.load()` → one Document per page.
4. `splitDocuments()` → 1000/200 chunks; throws if zero chunks (scanned/image-only PDF with no text layer).
5. Re-map metadata to nest `email` and `fileName` under `metadata`.
6. `fromExistingCollection` → on failure, `fromDocuments` creates the collection.
7. `ensureEmailIndex()` — idempotent; swallows "already exists".
8. `addDocuments()`.

**Observability.** Extensive `console.log` with emoji prefixes, plus `worker.on("failed")` / `worker.on("completed")` hooks. Env vars are logged as `SET`/`NOT SET` rather than by value — a small but correct secret-hygiene habit.

**Two real weaknesses in this file** (great things to raise proactively in an interview):
- **Retries duplicate data.** `addDocuments()` generates new random point IDs each call. If a job fails *after* a partial write and BullMQ retries it, the same chunks are inserted again. Fix: deterministic IDs, e.g. `uuidv5(hash(fileContent) + chunkIndex)`, making upserts idempotent.
- **Create-collection race.** Two concurrent first-ever jobs can both hit the `catch` and both call `fromDocuments`. Fix: create the collection at deploy time (a migration step), not lazily at runtime.
- **Files are never deleted.** `uploads/` grows forever. Fix: `fs.unlink(path)` in a `finally`, or move to S3 with a lifecycle rule.

---

## 13. Infrastructure & Deployment

### Local development (`docker-compose up --build`)
Four services: `redis`, `qdrant`, `server`, `worker`. Two developer-experience details:
- **Bind-mount + anonymous volume:** `- ./server:/app` and `- /app/node_modules`. The second mount is the trick — it shields the container's Linux-built `node_modules` from being shadowed by the host's macOS-built one.
- **`node --watch`** as the dev command, so edits to `index.js` / `worker.js` restart the process without a rebuild.

### Three Dockerfiles, three deployment shapes
| File | Runs | Use when |
|---|---|---|
| `Dockerfile.server` | `node index.js` | You want independent scaling of API and worker |
| `Dockerfile.worker` | `node worker.js` | Same — this is the other half |
| `Dockerfile.mono` | both via `concurrently --kill-others` | Single-container PaaS (Railway/Render/Fly free tier); one service, one bill |

**The mono trade-off:** simple and cheap, but you lose independent scaling (a queue backlog forces you to scale API replicas too), and `--kill-others` means one process crashing takes the other down. Fine for a portfolio deploy; wrong at scale.

### Production topology as deployed
- **Frontend:** Vercel (`pdfask.vercel.app`), CDN-backed, auto-scaled.
- **Backend:** container host with `NEXT_PUBLIC_API_URL` pointing at it.
- **Redis / Qdrant:** managed cloud (the env supports `QDRANT_URL` + `QDRANT_API_KEY` for Qdrant Cloud, and `REDIS_PASSWORD` for managed Redis).

### Environment variables
| Var | Where | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | server, worker | Embeddings + LLM |
| `QDRANT_URL`, `QDRANT_API_KEY` | server, worker | Vector DB (local or cloud) |
| `REDIS_HOST/PORT/PASSWORD` | server, worker | Queue |
| `PORT` | server | Listen port (default 3001) |
| `NEXT_PUBLIC_API_URL` | client | Backend base URL (**public — visible in the browser bundle**) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | client | Clerk frontend (public by design) |
| `CLERK_SECRET_KEY` | client (server-side only) | Clerk backend; must never be `NEXT_PUBLIC_` |

---

## 14. Error Handling, Reliability & Failure Modes

| Failure | Current behaviour | Rating |
|---|---|---|
| No file in upload | `400 { error: "no file received" }` | ✅ |
| Redis down at enqueue | `500` with details | ✅ |
| Missing email on `/ask` | `200 "Email not found"` | ⚠️ should be `400` |
| Invalid query | `400 { error: "Invalid query" }` | ✅ |
| Qdrant/Gemini down on `/ask` | `503` + details | ⚠️ leaks internals to client |
| Zero chunks retrieved | `200 { message: "No data found for your account." }` | ✅ |
| Worker: file missing on disk | Throws → 3 retries → stays in failed set | ✅ |
| Worker: PDF has no text layer | Throws "No text chunks extracted" | ✅ (but user is never told) |
| Worker: transient API error | Exponential backoff 5s → 10s → 20s | ✅ |
| Worker: permanent failure | Job retained (`removeOnFail: false`) | ✅ for debugging; ❌ no alerting |
| Client: network error | Friendly assistant message | ✅ |
| Client: 429 | Friendly "too many requests" | ⚠️ **server has no rate limiter** — this only fires if a proxy/CDN returns it |

**The biggest reliability gap is silent ingestion failure.** If the worker throws on job 3 of 3, the user sees "PDF is being processed" forever and then gets "No data found" when they ask. There is no status channel back to the browser.

---

## 15. Security Model (and Its Current Hole)

### What's solid
- Clerk handles auth, sessions, password storage, and OAuth — no homemade auth.
- `clerkMiddleware()` protects all frontend routes.
- CORS is an explicit allowlist, not `*`.
- Secrets stay server-side; only genuinely public values use `NEXT_PUBLIC_`.
- Multer's random filename prefix prevents path collisions and overwrite attacks.
- Env values are logged as `SET`/`NOT SET`, never as values.

### The hole: the backend trusts a client-supplied email

```js
const email = req.query.email;    // /ask
const email = req.body.email;     // /upload/pdf
```

The Express API performs **no authentication of its own**. Anyone can run:
```bash
curl "https://api.example.com/ask?email=victim@example.com&query=summarize+everything"
```
and read another user's documents. Clerk is protecting the *UI*, not the *API*. This is an **IDOR / broken-object-level-authorization** vulnerability — OWASP API Security #1.

### The fix

```js
import { clerkMiddleware, requireAuth, getAuth } from '@clerk/express';

app.use(clerkMiddleware());

app.get('/ask', requireAuth(), async (req, res) => {
  const { userId, sessionClaims } = getAuth(req);
  const email = sessionClaims.email;      // ← from the verified JWT, never from the client
  …
});
```
The client sends `Authorization: Bearer <clerk token>` (from `useAuth().getToken()`); the server verifies the JWT signature against Clerk's JWKS and derives identity from the verified claims.

**Better still: key vectors by Clerk `userId`, not email.** Emails are mutable — a user changing their email address would silently lose access to all their documents. `userId` is a stable, immutable primary key.

### Other hardening to mention
- No file-size limit on Multer → trivial disk-exhaustion DoS. Add `limits: { fileSize: 10 * 1024 * 1024 }`.
- `accept="application/pdf"` is a client-side hint only; validate magic bytes server-side.
- No rate limiting → API-cost DoS. Add `express-rate-limit`, keyed on `userId`.
- Prompt injection: a malicious PDF can contain "Ignore previous instructions…". Mitigate by clearly delimiting untrusted context and, for higher stakes, output validation.

---

## 16. How This Project Scales

### The scaling design already present

**1. Stateless API → horizontal scaling.** The Express server holds no session and no in-memory user state. Any replica can serve any request, so you scale by adding replicas behind a load balancer. (Uploads-on-local-disk is the one thing breaking pure statelessness — the fix is S3.)

**2. Queue-based load levelling.** The queue absorbs bursts. 1000 simultaneous uploads don't create 1000 concurrent PDF parses; they create a 1000-deep Redis list drained at the workers' pace. The API stays responsive regardless of ingestion load — this is the single most important scaling decision in the codebase.

**3. Independent scaling of read and write.** Traffic is asymmetric: users upload once and query many times. With `Dockerfile.server` / `Dockerfile.worker` split, you might run 10 API replicas and 2 workers, or invert that during a bulk import.

**4. Tunable worker throughput.** Two knobs: `concurrency` (in-process, for I/O-bound work) and replica count (for CPU-bound work). Total throughput = replicas × concurrency.

**5. Retries with exponential backoff.** Transient dependency failures self-heal instead of paging a human. Backoff prevents a retry storm from finishing off an already-struggling downstream service.

**6. Bounded Redis memory.** `removeOnComplete: true` means the completed-jobs set doesn't grow without limit — a classic way BullMQ deployments OOM their Redis.

**7. Vector-DB-level tenant filtering.** The `metadata.email` payload index means filtering happens inside Qdrant's HNSW traversal, not by over-fetching and filtering in Node. Latency stays flat as the *number of users* grows.

**8. Cheap model tier.** `gemini-2.5-flash-lite` and `k=5` keep per-query cost and latency low. Context size is the dominant cost driver in RAG; capping it at ~1250 tokens is a real design decision.

### Where it breaks, in order

| Users | First thing that breaks | Fix |
|---|---|---|
| ~100 | Local disk fills with uploads | Delete after processing; move to S3 |
| ~1K | Gemini free-tier rate limits | Paid tier, request batching, retry/backoff on 429 |
| ~10K | Single Qdrant node RAM (HNSW is memory-resident) | Scalar quantization, on-disk payloads, sharding |
| ~10K | Repeated identical questions burn tokens | Semantic answer cache in Redis |
| ~50K | Single Redis instance | Redis Cluster / managed Redis with replicas |
| ~100K | One collection with billions of vectors | Shard by tenant hash; hot/cold tiering |

### Scaling the *quality*, not just the throughput

Throughput is only half of scaling a RAG system — retrieval quality degrades as the corpus grows:
- **Hybrid search** (BM25 keyword + dense vectors) to catch exact terms like part numbers and names that embeddings blur.
- **Reranking**: retrieve k=20, rerank with a cross-encoder, keep the top 5. Big precision win for modest cost.
- **Query rewriting / HyDE**: expand a terse question before embedding it.
- **Parent-document retrieval**: embed small chunks for precision, return their larger parent for context.
- **Metadata pre-filtering** by document, date, or type when a user has hundreds of PDFs.

---

## 17. Known Gaps & Improvement Roadmap

Ordered by impact-to-effort. Knowing your own project's weaknesses is the strongest signal you can send in an interview.

### P0 — Correctness & security
1. **Authenticate the API with Clerk JWTs.** Derive email/userId from the verified token; never trust the query string. ([§15](#15-security-model-and-its-current-hole))
2. **Key vectors by immutable `userId`** instead of mutable email.
3. **Delete uploaded files after processing** (`fs.unlink` in a `finally`).
4. **Add Multer limits** (`fileSize`, `fileFilter`) and validate the PDF magic bytes.
5. **Add `express-rate-limit`** keyed on user — the client already handles 429, the server just never sends one.

### P1 — Product completeness
6. **Job status endpoint + polling/SSE.** `GET /jobs/:id` reading `job.getState()`, so the UI can show "Processing… 3/12 chunks" and, crucially, *report failures*.
7. **Stream the answer (SSE).** `llm.stream()` + `text/event-stream` cuts perceived latency dramatically — first token in ~300ms instead of a 3s blank wait.
8. **Persist chat history** (Postgres). Currently every reload wipes the conversation and there's no multi-turn memory — follow-ups like "and what about the second one?" fail because the question is embedded without conversational context.
9. **Document management UI:** list, rename, delete. Deleting requires a Qdrant `delete` by filter on `metadata.fileName` + `metadata.email`.
10. **Return citations.** You already have `metadata.fileName` and page numbers in the retrieved docs — surfacing "Source: resume.pdf, p.2" is nearly free and hugely increases user trust.

### P2 — Performance & cost
11. **Cache the vector store / embeddings client.** Wire up the dead `retriever` / `initPromise` module variables that were clearly intended for this.
12. **Semantic answer cache.** Hash the embedded query; if cosine similarity to a cached query > 0.97, return the cached answer. With `temperature: 0` this is safe.
13. **Idempotent upserts** with deterministic point IDs, so retries can't duplicate vectors.
14. **Reranking** for retrieval precision.
15. **Reduce embedding dimensionality** (Matryoshka truncation) to cut Qdrant RAM.

### P3 — Operations
16. **Structured logging** (`pino`) with request IDs instead of `console.log` + emoji.
17. **Metrics**: queue depth, job duration p95, retrieval latency, token spend per user.
18. **Env-driven CORS allowlist** instead of a hardcoded array.
19. **`/ready` probe** that *does* check Qdrant and Redis, alongside the dependency-free `/` liveness probe.
20. **Create the Qdrant collection + index in a deploy step**, removing the runtime race.
21. **Tests**: unit tests for chunking/`getApiMessage`, integration tests against ephemeral Qdrant/Redis containers, and a small eval set of question→expected-answer pairs to catch retrieval regressions.

---

## 18. Interview Q&A — System Design & Scaling

**Q: Walk me through the architecture.**
> Three tiers. A Next.js frontend on Vercel with Clerk auth. A stateless Express API that does two things: accept uploads and answer questions. And a BullMQ worker that does the heavy lifting — PDF parsing, chunking, embedding, and writing to Qdrant. Redis is the queue broker; Qdrant is the vector store; Gemini provides both embeddings and the chat model. The key structural decision is that ingestion is asynchronous — the API returns 202 immediately and the worker processes in the background — so slow document processing never blocks the request path.

**Q: Why a queue instead of processing the PDF in the request?**
> Four reasons. **Timeouts** — embedding a large PDF takes 30–120s and most load balancers cut connections at 30–60s. **Resource isolation** — parsing is CPU-heavy; doing it in the API process would block the event loop and degrade every other request on that instance. **Reliability** — an in-request failure is lost forever; a queued job retries three times with exponential backoff and lands in a failed set if it still doesn't succeed. **Load levelling** — a burst of 1000 uploads becomes a 1000-deep queue drained at a controlled rate, instead of 1000 concurrent parses that OOM the box.

**Q: How do you scale this to a million users?**
> Layer by layer. *Frontend*: already CDN-served, effectively free to scale. *API*: stateless, so N replicas behind a load balancer — the only blocker is uploads landing on local disk, which I'd move to S3 with presigned URLs so the browser uploads directly and the API only enqueues a key. *Workers*: scale replica count for CPU-bound parsing and concurrency for I/O-bound embedding. *Redis*: managed cluster, and I'd shard queues by priority so a bulk import can't starve interactive traffic. *Qdrant*: this is the real challenge — HNSW indexes are memory-resident, so I'd apply scalar quantization to cut vector RAM ~4x, move payloads to disk, and shard by tenant hash. *LLM*: this becomes the dominant cost, so a semantic cache on queries, plus batching embedding requests. And I'd add a read-through cache for hot documents.

**Q: What's the single biggest bottleneck today?**
> The vector database's memory footprint, and behind it the LLM API cost. But honestly, before either of those bites, the practical bottleneck is that uploaded files sit on the container's local disk forever and are shared between the API and worker via a Docker volume. That breaks the moment you run those on separate hosts. S3 is the first thing I'd fix.

**Q: How would you handle a user uploading a 500-page PDF?**
> Today it would work but take minutes, and the user would have no visibility. I'd fan out: one job to split the PDF into page ranges, then N child jobs each handling a range, with BullMQ flows tracking the parent. That parallelizes across workers and gives natural progress reporting. I'd also add a size limit and a per-user quota.

**Q: Why is the health check not checking Qdrant?**
> Because it's a *liveness* probe. If liveness depended on Qdrant, a Qdrant blip would make Kubernetes kill every healthy API pod and restart them in a loop — turning a degraded dependency into a total outage. Liveness answers "is this process wedged?"; readiness answers "should I send it traffic?". Dependency checks belong on `/ready`.

**Q: How do you keep one tenant from affecting another?**
> Right now, not well enough — that's an honest gap. There's no per-user rate limit or quota, so one user bulk-uploading could saturate the workers. I'd add per-user rate limiting on the API, a separate lower-priority queue for bulk work, and a max-concurrent-jobs-per-user cap so a single tenant can't monopolize the worker pool.

**Q: What would you monitor in production?**
> Four golden signals per service, plus domain-specific ones: **queue depth and oldest-job age** (the leading indicator that workers are underprovisioned), **job failure rate by error type**, **retrieval latency p95**, **end-to-end answer latency**, **tokens spent per user per day** (cost runaway is the failure mode people forget), and **retrieval quality** — I'd log when a query returns zero chunks or the model answers "Not found in document," because a spike there means retrieval broke, not that the users got worse.

---

## 19. Interview Q&A — RAG & AI

**Q: Explain RAG in one minute.**
> A language model only knows what was in its training data, and you can't fit a user's whole document library into a prompt. RAG solves both: you pre-process documents into chunks, embed each chunk into a vector, and store them. At query time you embed the question, find the handful of chunks whose vectors are closest, and put only those into the prompt. The model then answers from supplied evidence rather than memory — which is cheaper, current, private, and much less prone to hallucination.

**Q: Why chunk size 1000 with 200 overlap?**
> It's a precision/context trade-off. An embedding is a single vector for the whole chunk, so a large chunk covering five topics produces a blurry average vector that matches everything poorly. Too small and the chunk loses the context needed to be a useful answer. 1000 characters is roughly a paragraph or two — about 250 tokens. The 200-character overlap exists because a hard boundary can cut a sentence or a definition in half; the overlap guarantees that any given sentence appears intact in at least one chunk. I'd tune both against an eval set rather than treat them as universal constants.

**Q: What does `RecursiveCharacterTextSplitter` actually do?**
> It tries a prioritized list of separators — paragraph break, line break, space, then raw characters. It splits on the highest-priority separator that gets chunks under the size limit, recursing down only when necessary. The effect is that it respects natural document structure where it can and only makes brutal mid-word cuts as a last resort.

**Q: Why Qdrant over pgvector / Pinecone / Chroma?**
> Qdrant is Rust-based with strong filtered-search support — specifically *filterable HNSW*, where the payload filter is applied during graph traversal rather than after it. That matters enormously here because every single query is filtered by tenant. It also self-hosts trivially in Docker for local dev and has a managed cloud for production, so the same code path works in both. pgvector would be attractive if I already had Postgres and wanted transactional consistency between metadata and vectors; Pinecone removes ops burden but adds cost and vendor lock-in.

**Q: What's HNSW and what's the trade-off?**
> Hierarchical Navigable Small World — a multi-layer proximity graph. Search starts at a sparse top layer, greedily hops toward the query vector, then descends to denser layers to refine. It's approximate: roughly logarithmic time instead of linear, at maybe 95–99% recall. The tunable knobs are `ef_construct` and `m` at build time and `ef` at search time — higher means better recall and more latency and memory.

**Q: How do you prevent hallucination?**
> Layered defence. The system prompt is explicit: answer only from context, and if the answer isn't there, respond with exactly "Not found in document." `temperature: 0` removes sampling randomness. The retrieval guard returns early when zero chunks come back, so the model is never asked a question with an empty context — that's the case where models fall back on parametric memory. What I'd add next is citations, so the user can verify each claim against the source page, and an LLM-as-judge eval that scores answers for groundedness.

**Q: How would you evaluate whether this system is actually good?**
> Separate retrieval from generation. For **retrieval**, build a labelled set of question → relevant-chunk pairs and measure recall@k and MRR — if the right chunk isn't in the top 5, no prompt can save you. For **generation**, measure faithfulness (is every claim supported by the context?) and answer relevance, which you can automate with an LLM judge. Then track the "Not found in document" rate in production as a health signal. Without an eval set, tuning chunk size or k is just guessing.

**Q: The user asks a follow-up like "what about the second one?" — what happens?**
> It fails, and that's a known gap. The query is embedded standalone with no conversational context, so "the second one" is semantically meaningless and retrieves noise. The standard fix is a condensation step: a cheap LLM call that rewrites the follow-up into a self-contained question using the chat history, and *that* rewritten question is what gets embedded.

**Q: Why `gemini-2.5-flash-lite` and not a bigger model?**
> The task is extractive: the retrieval step has already done the hard work of finding the relevant text, so the model's job is to read five short passages and phrase an answer. That doesn't need frontier reasoning. Flash-lite is roughly an order of magnitude cheaper and noticeably faster, and for grounded QA the quality difference is small. In RAG, spending your budget on better retrieval usually beats spending it on a bigger generator.

**Q: What happens with a scanned PDF?**
> `pdf-parse` extracts zero text, the splitter produces zero chunks, and the worker throws "No text chunks extracted from PDF." The job retries three times and lands in the failed set — but the user is never told, which is the real bug. The fix is a status channel back to the UI, plus an OCR fallback (Tesseract, or a vision model) when the extracted text is suspiciously short relative to the page count.

---

## 20. Interview Q&A — Backend / Node / Queues

**Q: Why BullMQ and not just `setTimeout` or an in-memory array?**
> Durability and distribution. An in-memory queue dies with the process — a deploy or crash silently loses every pending job. BullMQ persists to Redis, so jobs survive restarts, and multiple worker processes on different machines can consume from the same queue with atomic job claiming. It also gives you retries, exponential backoff, delayed jobs, priorities, rate limiting, and a dead-letter equivalent out of the box — all things you'd otherwise reimplement badly.

**Q: What does `concurrency: 5` mean, and why not 100?**
> It's how many jobs one worker *process* handles simultaneously via the event loop. It works here because the job is mostly awaiting network I/O — Gemini and Qdrant. Setting it to 100 wouldn't help: PDF parsing is synchronous CPU work that blocks the event loop, so past a point you'd just have 100 jobs taking turns and all getting slower, with memory pressure from 100 buffered PDFs. For CPU-bound scaling you add processes, not concurrency.

**Q: Explain the retry configuration.**
> `attempts: 3` with `backoff: { type: "exponential", delay: 5000 }` gives retries at roughly 5s, 10s, and 20s. Exponential rather than fixed because the failures worth retrying are transient — a rate limit or a brief outage — and hammering a struggling service at a fixed interval makes it worse. `removeOnComplete: true` bounds Redis memory; `removeOnFail: false` keeps failed jobs so you can inspect the payload and error. In production I'd pair that with alerting on the failed-set size, because retained-but-unwatched failures are the same as lost jobs.

**Q: Is this retry logic actually safe? What about idempotency?**
> It isn't fully safe, and it's the flaw I'd fix first in the worker. `addDocuments` generates fresh random point IDs each call, so if a job fails after partially writing to Qdrant, the retry writes those chunks again — duplicate vectors that then crowd out other results at retrieval time. The fix is deterministic IDs: derive a UUID from a hash of the file content plus chunk index, so re-running the job upserts over the same points instead of appending.

**Q: Why `202 Accepted` instead of `200 OK`?**
> Because the work isn't done. 200 means "here's your completed result"; 202 means "I've accepted this for processing and it will complete later." It's an honest signal to the client that it should expect eventual consistency — and it's what makes the missing job-status endpoint an obvious next step rather than an afterthought.

**Q: Why Multer disk storage rather than memory storage?**
> Memory storage buffers the entire file in the Node heap. Ten concurrent 100 MB uploads would be a gigabyte of heap and likely an OOM. Disk storage streams to a file, so memory stays flat regardless of file size. The trade-off is that the file now lives on a specific machine — which is why the compose file shares an `uploads-data` volume between the API and worker, and why S3 is the correct long-term answer.

**Q: What is graceful shutdown and why does it matter?**
> On SIGTERM — which is what a container orchestrator sends before killing a pod — the process closes its BullMQ connection before exiting instead of dying mid-operation. For the worker specifically, `worker.close()` lets in-flight jobs finish rather than leaving them stalled until BullMQ's lock expires. Without it, every deploy would cause a burst of stalled jobs and duplicated work.

**Q: Express 5 vs Express 4 — anything relevant?**
> The big one is that Express 5 automatically forwards rejected promises from async handlers to the error middleware. In Express 4 an unhandled rejection in an async route would hang the request forever. This code still uses explicit try/catch, which I prefer anyway because it lets each route choose its own status code and error shape.

---

## 21. Interview Q&A — Frontend / Next.js

**Q: Which components are server vs client, and why does that split matter?**
> `layout.tsx` and `page.tsx` are Server Components — they ship no JavaScript, just HTML. Only `file-upload.tsx` and `query-input.tsx` are `'use client'` because they need state, refs, and event handlers. The rule is to push the client boundary as deep into the tree as possible, because `'use client'` is contagious: everything imported below it also ships to the browser. Putting it on the layout would have sent the entire app's JS to every visitor.

**Q: Why is the chat input uncontrolled?**
> A controlled input calls `setState` on every keystroke, and every one of those re-renders the whole message list. With a ref, typing causes zero React renders and the value is read once on submit. It's the right call when you don't need to react to intermediate values — no live validation, no character counter.

**Q: Why wrap the scroll in `requestAnimationFrame`?**
> Because scrolling immediately after `setMessages` reads a `scrollHeight` from before React committed the new message, so you scroll to the old bottom and the newest message stays hidden. rAF runs just before the next paint, after the commit, so the measurement is correct.

**Q: And why `setTimeout(focus, 0)`?**
> In the `finally` block, `setIsLoading(false)` has been called but React hasn't re-rendered yet, so the input still has `disabled` in the DOM and `.focus()` on a disabled element silently does nothing. Deferring by one macrotask lets React flush the update first.

**Q: Why `crypto.randomUUID()` for message keys instead of the array index?**
> Keys are how React matches elements across renders. Index keys work for append-only lists but break the moment you insert, delete, or reorder — React reuses the wrong DOM nodes, and you get mismatched content, lost focus, and broken animations. A stable per-message ID makes identity explicit. `crypto.randomUUID` is native in modern browsers and fine for non-cryptographic identity.

**Q: Why `setMessages(prev => ...)` rather than spreading the current state?**
> Because `messages` in the callback is captured from the render that created the closure. With async work in between, that value can be stale, and you'd drop messages. The functional form always receives React's latest state.

**Q: Why does `getApiMessage` exist?**
> The backend returns four different shapes — a bare string, `{message}`, `{error, details}`, and various error statuses. Normalizing at one boundary means the rendering code deals with a single string, and it gives one place to sanitize: a 429 becomes a friendly sentence rather than dumping raw rate-limit text into the assistant bubble, which would look like the AI itself malfunctioning.

**Q: The frontend calls the backend directly. Why not proxy through a Next.js route handler?**
> Simplicity — one less hop and no serverless function in the path. But a BFF layer would be strictly better here, and it's on my list: it would let me attach the Clerk token server-side, hide the backend URL from the browser, centralize rate limiting, and avoid CORS entirely. Right now `NEXT_PUBLIC_API_URL` is in the client bundle, so the backend is publicly addressable — which is exactly why the API needs its own auth.

**Q: How does Clerk integrate with Next.js here?**
> `ClerkProvider` wraps the app in `layout.tsx`, `<SignedIn>` / `<SignedOut>` gate the UI declaratively, and `useUser()` gives client components the profile. Route protection comes from `clerkMiddleware()` in `proxy.ts` — Next 16 renamed `middleware.ts` to `proxy.ts` — with a matcher that skips static assets. The gap is that this protects the frontend only; the Express API doesn't verify the session at all.

---

## 22. Interview Q&A — DevOps & Docker

**Q: Walk me through the docker-compose setup.**
> Four services. Redis and Qdrant are stock images with named volumes so data survives `docker compose down`. The server and worker are built from the same `server/` directory but with different entrypoints, and both mount the source as a bind volume with `node --watch` so edits hot-reload without a rebuild. Both also mount a shared `uploads-data` volume, because the API writes the PDF to disk and the worker has to read it back — miss that and you get "file not found" errors that look mysterious.

**Q: What's the `- /app/node_modules` line doing?**
> It's an anonymous volume that masks the bind mount at that path. Without it, mounting the host's `./server` over `/app` would replace the container's Linux-built `node_modules` with the host's macOS-built one, and any native module — `pdf-parse` dependencies, for instance — would fail to load. The anonymous volume preserves whatever `npm install` produced during the image build.

**Q: You have three Dockerfiles. Why?**
> Different deployment shapes. `Dockerfile.server` and `Dockerfile.worker` are for a split deployment where you scale the API and workers independently — that's the production-correct topology. `Dockerfile.mono` runs both in one container with `concurrently`, which is for cheap single-service PaaS hosting where you're billed per service. The mono version trades away independent scaling and adds a shared failure domain — `--kill-others` means one process crashing takes the other down — but it halves the hosting cost, which is the right trade for a personal project.

**Q: How would you improve these Dockerfiles?**
> Several things. Multi-stage builds with `npm ci --omit=dev` so production images don't carry dev dependencies. A non-root user. `COPY package*.json` before the source is already there — that's the layer-caching win — but I'd add a `.dockerignore` so `node_modules` and `.env` never enter the build context. Pin the base image by digest rather than the `22-alpine` tag. Add a `HEALTHCHECK`. And separate the dev command from the image: `node --watch` shouldn't be what production runs.

**Q: How do secrets get handled?**
> Via `env_file` in compose pointing at `server/.env`, which is gitignored, with a committed `.env.example` documenting the required keys. In production they'd come from the platform's secret manager. One detail I like in the worker: it logs `SET` / `NOT SET` for each variable rather than the values, so you can debug a missing key from logs without leaking it.

---

## 23. The 2-Minute Project Pitch

> **PDF Chat is a multi-tenant RAG application.** Users sign in, upload PDFs, and ask natural-language questions that get answered strictly from their own documents.
>
> **The architecture has three tiers.** A Next.js frontend on Vercel with Clerk auth. A stateless Express API. And a BullMQ worker pool doing the heavy lifting. Redis backs the queue, Qdrant stores vectors, and Gemini provides both embeddings and the chat model.
>
> **The decision I'd highlight is asynchronous ingestion.** Parsing and embedding a PDF takes tens of seconds — far past load-balancer timeouts, and it blocks the event loop. So the upload endpoint writes to disk, enqueues a job, and returns 202 immediately. A separate worker with concurrency 5 does the parse-chunk-embed-store pipeline, with three retries and exponential backoff. This decouples read and write entirely: I can scale API replicas for query traffic and worker replicas for ingestion traffic independently, and a burst of uploads becomes a deeper queue rather than a degraded API.
>
> **The subtle problem was multi-tenancy.** All users share one Qdrant collection, isolated by a `metadata.email` filter on every search. My first version filtered on `email` rather than `metadata.email` — LangChain nests custom metadata one level down — so the filter matched nothing. Fixing the key was only half of it: I also had to create a Qdrant payload index on that field, because without one the filter is applied after the HNSW graph walk and you can get back fewer results than you asked for. One collection plus an indexed tenant key is Qdrant's recommended pattern for many small tenants — collection-per-user would mean thousands of sparse, poorly-connected indexes.
>
> **What I'd fix next, in order:** the Express API currently trusts a client-supplied email, so it needs real Clerk JWT verification — that's an IDOR bug and it's my P0. Then uploaded files need to move to S3 so the API is genuinely stateless. Then a job-status endpoint, because right now a failed ingestion is completely silent to the user. After that, streaming responses and a semantic answer cache.

---

## 24. Glossary

| Term | Meaning |
|---|---|
| **RAG** | Retrieval-Augmented Generation — retrieve relevant text, then generate an answer from it |
| **Embedding** | A text → dense float vector mapping where semantic similarity ≈ geometric closeness |
| **Chunk** | A slice of a document sized for embedding (1000 chars here) |
| **Overlap** | Repeated text between adjacent chunks so boundary-straddling sentences survive intact |
| **Vector DB** | A database indexed for nearest-neighbour search over embeddings |
| **HNSW** | Hierarchical Navigable Small World — the approximate nearest-neighbour graph index Qdrant uses |
| **ANN** | Approximate Nearest Neighbour — trades exactness for speed |
| **Cosine similarity** | Angle-based similarity metric between two vectors |
| **top-k** | How many nearest chunks to retrieve (`k: 5` here) |
| **Payload** | Qdrant's term for the JSON metadata stored alongside a vector |
| **Payload index** | A secondary index on a payload field that makes filtering fast and filter-aware |
| **Stuffing** | The chain strategy of concatenating all retrieved chunks into one prompt |
| **System prompt** | Instructions that set model behaviour before the user message |
| **Temperature** | Sampling randomness; 0 = deterministic |
| **Multi-tenancy** | Serving many isolated users from shared infrastructure |
| **IDOR** | Insecure Direct Object Reference — accessing another user's data by changing an identifier |
| **BFF** | Backend-for-Frontend — a thin server layer owned by the frontend |
| **202 Accepted** | HTTP status meaning "request accepted, processing will complete later" |
| **Exponential backoff** | Retry delays that grow geometrically (5s, 10s, 20s) |
| **Idempotency** | Property where repeating an operation produces the same result as doing it once |
| **Liveness vs readiness** | "Is the process alive?" vs "should it receive traffic?" |
| **Reranking** | Re-scoring retrieved candidates with a stronger cross-encoder model |
| **Hybrid search** | Combining keyword (BM25) and vector search |
| **Quantization** | Compressing vectors (e.g. float32 → int8) to cut memory at slight recall cost |
| **Prompt injection** | Malicious instructions embedded in untrusted content the model reads |
