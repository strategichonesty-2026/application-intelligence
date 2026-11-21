# Personal Intelligence Hub (PIH): Phase 0 assessment and plan

Status: **proposal only. Nothing in this document is built.** No code, tables, deployments or data were changed to write it.
Date: 21 November 2026. Source of truth: the actual code of `application-intelligence` (main) and, for storage and AI, `strategic-honesty-media-studio` (read-only look).
Goal: never have to remember which chatbot, which month, or where a decision was left. Help the owner remember, connect, evaluate and act.

## 0. What exists today (so nothing is re-built)
| Item | State |
|---|---|
| Command Center (repositories, portfolio, open-source library) | Built, live, accepted (PR #1, acceptance PR #2). |
| Personal Intelligence Hub | **Not started.** No tables, routes, screens or importers exist. |
| Importing ChatGPT/Claude exports | Not built. |
| AI extraction, weekly report | Not built. |

## 1. Existing capabilities that can be reused (verified in code)
| Need | What exists | Where |
|---|---|---|
| Screens and navigation | React 18 + Vite, hash routing, a `NAV` list, shared UI kit (dialogs, badges, toasts, data gate, skeletons), mobile bottom bar | `src/intelligence/` |
| API and authentication | Express 5; one owner sign-in (scrypt hash, signed 8-hour token); every `/api/app-intelligence/*` route sits behind it; sign-in is rate limited (6th wrong attempt gets 429) | `server/routes/appIntelligence.cjs`, `ownerAuth.cjs`, `middleware/` |
| Database conventions | PostgreSQL via `pg`; additive `CREATE TABLE IF NOT EXISTS` in `store.initSchema` under an advisory lock; text IDs with prefixes; `TIMESTAMPTZ` columns | `store.cjs` |
| Full-text search pattern | Generated `tsvector` column + GIN index, `websearch_to_tsquery('english')`, LIKE-escaped partial fallback; tested | `portfolio.cjs` |
| Secret screening | `looksLikeSecret` / `findSecretFields` used on every free-text field | `inventory.cjs` |
| Honest-evidence rule | "Verified" needs evidence + date; unknown stays unknown | `portfolio.cjs`, `oss.cjs` |
| Daily job | One timer, `SCHEDULE=daily`, advisory lock, 12-hour minimum gap, catch-up after downtime, heartbeat after a completed pass; a hook already exists for the GitHub sync | `monitor.cjs` |
| Email | Resend (alerts only; the only channel found in `alerts.cjs`) | `alerts.cjs` |
| Tests | 26 offline Node test files run by `npm test`; DB tests use a scratch database; a test guards that monitoring code imports nothing outside an allow-list | `test_*.cjs`, `scripts-test.cjs` |
| Deploy | Railway, `railway.json`, health check `/healthz`, env-var configuration | `railway.json`, `docs/DEPLOYMENT.md` |

## 2. Missing capabilities (verified absent)
- **File upload path.** The console's JSON body limit is 32 KB (`bodyLimits.cjs`); no upload library or ZIP reader is in `package.json` (dependencies: express, pg, dotenv, react, react-dom).
- **Object storage.** No R2/S3 code in this repo. Media Studio has `r2Service.cjs`, but it uploads to a bucket and **returns public URLs** (`R2_PUBLIC_URL_BASE`). That is the wrong shape for private conversations (requirement: no public URLs). R2 is therefore **not** reused for the first version.
- **Any LLM integration.** None in this repo, and the repo rule is "monitoring must never call an AI or paid service". Media Studio's `/api/claude/messages` is a raw pass-through of any request body to Anthropic on the owner's key: no redaction, no provider log, no size or topic limits. It must **not** be reused for conversations. Its narrower `translateProvider.cjs` shows the key variable name only.
- **Weekly job.** The scheduler is daily; a weekly run needs a simple "has it run this week" check.
- **Redaction, sensitivity classification, provider-use log, deletion/export of personal data.** None exist.
- **Backups.** Not managed by this repo; not verified (see section 11).

## 3. Proposed architecture
```
Owner's exports (ZIP/JSON, stay on the owner's computer, never modified)
        |  PR 1: local import command (reads files, writes rows)
        v
PostgreSQL (the console's own database)
   original layer:    pih_imports -> pih_conversations -> pih_messages   (raw JSON kept per conversation)
   derived layer:     pih_findings, pih_summaries, pih_ai_runs            (always labelled "AI-generated", always linked to a source)
        |
Express routes (existing owner gate)  ->  React "Hub" pages  ->  weekly report (existing daily pass)
```
Principles: no new service, database, queue, vector store or app; **original records and extracted intelligence are separate tables**; extraction is optional, off by default and never required to search.

### Data model (proposal; no table has been created)
| Table | Key columns |
|---|---|
| `pih_imports` | id, platform (`chatgpt`/`claude`), file_name, file_sha256 (unique), status (`running`/`done`/`failed`/`partial`), counts (found/added/skipped/failed), errors (bounded list), started_at, finished_at |
| `pih_conversations` | id, platform, external_id, title, created_at_src, updated_at_src, import_id, message_count, `raw` JSONB (the original conversation object, unchanged), sensitivity (`normal`/`held_back`/`excluded`), project_label, `search` tsvector; unique (platform, external_id) |
| `pih_messages` | id, conversation_id, position, role (`user`/`assistant`/`system`/`tool`), text, created_at_src, branch flag (ChatGPT branches), has_attachment |
| `pih_findings` | id, conversation_id, message_id (source), kind (idea, opportunity, project, decision, requirement, action, problem, research_question, preference), text, quote (short, from source), certainty (`stated_decision`/`brainstorm`/`ai_suggestion`), status (`suggested`/`accepted`/`rejected`), run_id |
| `pih_ai_runs` | id, provider, model, purpose, conversation ids, redaction counts, input/output token counts, started/finished, outcome (no prompt text stored; a hash only) |
| `pih_reports` | id, week, body, confidence, sources, created_at |

## 4. Conversation import design
**Formats (from public documentation and third-party parser projects; not yet checked against the owner's real files):**
- **ChatGPT export ZIP.** Contains `conversations.json` (older exports) or sharded `conversations-NNN.json` (current exports; one analysis tool also lists `personal/conversations/conversations.json`), plus other files (user data, `chat.html`, a manifest, images). Each conversation has `title`, `create_time`, `update_time` (Unix seconds) and a **`mapping`**: a graph of message nodes with parent/children links, because edited prompts and regenerated answers create branches. Messages carry `author.role`; hidden system messages and tool calls (recipient other than "all") must be separated from what the person actually read.
- **Claude export.** The "Export data" button (Settings > Privacy; individual plans) emails a ZIP whose `conversations.json` is one array of conversations: `uuid`, `name`, `created_at`/`updated_at` (ISO 8601), `chat_messages[]` with `sender` (`human`/`assistant`), `text`, newer messages with `content[]` blocks, attachments, and possibly `projects.json`. `text` can be empty for tool, artifact or thinking turns, so the importer must read `content[]` too.
- Neither company offers a supported way to read private history by API; exports are the only route.

**Importer rules**
1. Original file is opened read-only; nothing is written back. The owner keeps the ZIP as the master copy.
2. Each conversation is stored with its **raw JSON unchanged**, plus normalized messages for reading and search.
3. ChatGPT: keep all nodes in `raw`; normalize the **active branch** (from `current_node` up through parents) as the main transcript; mark other branches rather than dropping them.
4. Duplicates: skip a file whose SHA-256 was imported; skip a conversation whose (platform, external_id) exists; a conversation that grew since the last export is **updated** (messages appended), and the earlier version is not silently overwritten without a recorded count.
5. Malformed input: one bad conversation is recorded in the import's error list and skipped; the import finishes as `partial`; it never stops the rest. Unknown shapes are preserved in `raw` and shown as "unreadable messages", not guessed.
6. Large files: process one shard/conversation at a time; if a single JSON file is too big for memory, a streaming parser is an explicit, approved dependency decision (not assumed).
7. Status and errors are stored and shown on an Imports screen; totals (conversation count, message count, characters) are printed at the end so the real size is known before any AI spend.

## 5. Security and privacy design
| Requirement | Design |
|---|---|
| Authenticated access only | All Hub routes mount behind the existing owner gate; a test lists every Hub endpoint and expects 401 without a token (same pattern as the Command Center). |
| No public URLs | Conversations live only in PostgreSQL; nothing is written to a public bucket; no sharing feature. |
| No credentials exposed | Existing screening on all inputs; provider key only as a server variable; never logged or returned. |
| Redact before AI | A redaction step replaces secret-like strings (key prefixes, bearer tokens, private-key blocks, long random strings, connection strings) with placeholders and counts them. It runs on every message sent to a provider, with tests; the stored original is untouched. |
| Sensitive topics excluded by default | Conversations matching family, health or financial patterns are marked `held_back` at import and **never sent to AI** unless the owner releases that conversation. Pattern matching is imperfect, so the owner also gets a one-click "exclude" and a review list; the default for unsure is held back. |
| Provider record | Every AI call writes a `pih_ai_runs` row (provider, model, purpose, which conversations, redaction counts, token counts). A screen lists them. |
| No outside calls without configuration | AI is off unless `PIH_AI_ENABLED=true` and a dedicated key variable is set; the monitoring and Command Center code paths never import the Hub's AI module (the existing import allow-list test is extended to enforce it). This is a deliberate, owner-approved exception to the repo rule "monitoring never calls an AI". |
| Deletion and export | Delete one conversation, one import, or everything (cascades to findings). Export everything as JSON and Markdown. Deleting rows does not delete database backups; this is stated on the screen. |
| Imported text is data, never instructions | Conversation text is only ever placed inside a clearly delimited data block of a user message; the system prompt is fixed in code; the model has no tools; output must be JSON that passes a schema check; anything else is discarded. Findings are suggestions the owner accepts or rejects; nothing triggers an action. |
| Provider data terms | The provider's current retention and training terms must be read and recorded before enabling AI. **Not verified here.** |

## 6. AI extraction and cross-reference strategy
1. **Search first, AI second.** PR 1 and 2 need no AI. Everything useful for "find that conversation" works with PostgreSQL full-text search.
2. **Extraction** runs per conversation (long ones in chunks), on redacted text, with a fixed prompt that asks only for the listed record kinds, each with a short quote and message reference. A finding without a source quote is rejected. The prompt forbids inventing missing details; unknown fields stay empty.
3. **Certainty label** per finding: stated decision, brainstorm, or AI suggestion (an assistant's idea the owner never adopted is not the owner's idea). Decisions need the owner's own words as evidence.
4. **Dry run first**: the system estimates tokens and cost before any call; the owner approves a batch size; a daily cap stops the run.
5. **Review queue**: findings start as `suggested`; accepted findings can be copied into the existing **Portfolio** (decisions, risks, opportunities, ideas) so there is one register, not two.
6. **Cross-conversation links** start rule-based and free: related conversations by full-text rank on titles and key terms; repeated ideas by matching normalized finding text; "discussed but never implemented" by projects with no later conversation and no repository match; "commitments without follow-up" by action findings with no later mention. A vector index is **not** proposed; add it only if full-text search is shown to miss real cases.
7. **Business opportunities**: AI output is stored as "hypothesis". Each of the eight criteria (demand, revenue, time to revenue, startup cost, competition, effort, legal/operational risk, fit) has an evidence field with a source and date, using the same honesty rule as the Library: no score counts as verified without a source. Comparison with SHIOS findings is manual or via a documented read-only export; SHIOS access is not verified.

## 7. Weekly report workflow
Runs inside the existing daily pass, but only once per ISO week and only when the Hub is enabled; uses already-extracted findings, not a re-read of everything; failure never blocks the health pass. Sections: new ideas worth remembering; forgotten or unfinished commitments; project progress and unresolved issues; new opportunities; opportunities to stop or deprioritize; **three recommended actions**. Every line carries source links (conversation and date) and a confidence label (stated by you / inferred / AI suggestion). Shown in the console; optional email through the existing Resend setup. With AI off, the report is rule-based (counts and lists) and says so.

## 8. Estimated complexity and cost
| PR | Scope | Size | New cost |
|---|---|---|---|
| 1 | Schema, local import command (ChatGPT + Claude), search API, Library page, tests | Medium (about 1 week of focused work) | None (database storage only) |
| 2 | Imports screen, sensitivity flags, delete/export, redaction module | Small to medium | None |
| 3 | AI extraction, run log, cost estimate/cap, review queue | Medium to large | Provider usage |
| 4 | Cross-conversation links, unresolved-decision and follow-up views | Medium | None |
| 5 | Opportunity worksheet and Portfolio link | Small | None |
| 6 | Weekly report | Small to medium | Small provider usage |

**External costs.** PRs 1, 2, 4 and 5 add no paid service. The only variable cost is the AI provider in PRs 3 and 6: roughly **characters of imported text ÷ 4 = input tokens**, multiplied by the provider's current price, plus output. The import in PR 1 prints the real total, so the cost can be calculated from real numbers before any spend. Current prices, database size limits and storage growth were **not verified**.

## 9. Testing and acceptance criteria
- **Importers:** fixture files built from a small, redacted sample of the owner's real exports (to be provided); tests for branches, empty text, tool messages, missing fields, duplicates, a truncated file, an oversized file, and a re-import that must change nothing.
- **Originals:** a test proves the raw JSON stored equals the source object and that the source file's hash is unchanged after import.
- **Search:** keyword, platform, date range and project filters; partial words; hostile text is only data.
- **Security:** every endpoint 401 without a token; no key or token in any response or log; secret-like text is redacted before any provider call (tests use a fake provider and assert what it received); a held-back conversation is never sent; a prompt-injection sample ("ignore previous instructions…") inside a conversation produces no action and no change to the prompt.
- **AI:** with AI off, nothing is called; a fake provider returns malformed JSON and the run fails safely; a finding without a source quote is rejected; every finding links to its conversation.
- **Reports:** runs once per week; a failure does not stop the health pass; every line has a source and confidence.
- **Acceptance by the owner:** import your real history; find a known old conversation in under 10 seconds from a keyword; open the original; delete one conversation and see it gone; export everything.

## 10. Phased implementation (separate PRs, each approved before the next)
PR 1 (smallest useful) > PR 2 (control and safety) > PR 3 (AI, only after owner approval of provider, key and budget) > PR 4 > PR 5 > PR 6. Each PR: tests green, build clean, no change to existing monitoring behaviour, no deploy without approval. The Command Center is not modified except for one added navigation entry.

## 11. Could not verify
1. The actual files in the owner's exports (field names change over time); fixtures must come from a real redacted sample.
2. The AI provider's data-retention and training terms, and current prices.
3. Railway Postgres backup settings, size limits and whether a request of the needed size would be accepted (affects whether a browser upload is practical).
4. Whether PostgreSQL extensions such as trigram matching are available on the host (not needed for the proposal).
5. How SHIOS data can be read from this console.
6. The size of the owner's history (the PR 1 import will report it).

## Final recommendation: the smallest useful first implementation
**PR 1 only, with no AI:** a local command run on your computer, `import-conversations <export file>`, that reads a ChatGPT or Claude export and stores the conversations and messages in the console's own database; plus a **Library** page to search by keyword, platform and date and to open the original conversation.

Why this first: it solves "which chatbot, which month" immediately; it avoids every risky part (no upload endpoint, no public storage, no AI, no new service or cost); and it tells us the real size and shape of your history so every later decision (AI cost, whether you need more than full-text search) is made on facts.

**Decisions needed from you before PR 1:** (a) approve a local import command rather than browser upload; (b) how you want to point it at the database from your computer (a connection string you keep out of chat and out of git); (c) a small redacted sample of each export so the importer is tested on real shapes.

### Sources consulted (public documentation and third-party parsers; none replaces a check against real files)
- Claude Help Center: "Export your Claude data" (support.claude.com)
- OpenAI Help Center: "Export your ChatGPT history and data" (help.openai.com)
- Community schema write-ups of ChatGPT `conversations.json` and the `mapping` tree (OpenAI developer forum; chatgpt-to-markdown format notes)
- Third-party readers of `claude.ai` exports (`conversations.json` with `chat_messages`)
