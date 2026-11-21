# PIH: private storage and security controls (design before any cloud storage)

Status: **design only.** No cloud storage is proposed for the first release. This page exists so that, if storage is ever added, it is designed safely first.

## 1. First release: no object storage at all
- Conversations and messages live only in a **local or staging PostgreSQL** database (see PIH_LOCAL_SETUP.md).
- The original export files stay on the owner's computer as the master copy and are never modified.
- Each conversation's original JSON is also kept unchanged inside the database row, so the original content is preserved without any file storage.
- No AI provider receives any conversation content in this release.

## 2. Why the existing R2 approach must not be reused
The Media Studio's R2 service uploads objects and returns a **public URL** built from `R2_PUBLIC_URL_BASE`. Anyone with such a link can open the file, and the link is designed to be shared with social platforms. A private conversation must never sit behind a guessable or shareable public address. The existing bucket, key variables and public base URL are therefore **off limits** for the Hub.

## 3. If cloud storage is ever added (requirements, all must hold)
| Control | Requirement |
|---|---|
| Separate bucket | A new bucket used only by the Hub. Never the media bucket. |
| No public access | Public access and any public/custom domain are disabled. The Hub's configuration has **no** public-base-URL setting at all. |
| Separate credentials | A new API token scoped to that one bucket, with only the permissions needed; stored as a server variable, never in code or GitHub; rotated on a schedule. |
| Access path | Files are read only through the authenticated console: either streamed by the server after the owner-token check, or via short-lived signed links created after that check (minutes, not days). No permanent links. |
| Object names | Random IDs, never titles or dates, no directory listing exposed to the UI. |
| Encryption | Encrypted at rest by the provider (to be confirmed in the provider's current documentation before approval) and encrypted in transit; optional client-side encryption if the owner wants zero trust in the provider. |
| Audit | Every read and delete is logged (who, what, when) in the console database. |
| Deletion | Deleting a conversation or import deletes its objects; the screen explains that provider-side backups or versions may persist for a period. |
| Start-up checks | The Hub refuses to start storage if the bucket name equals the media bucket, if a public base URL variable is set, or if the bucket reports public access. A test enforces this. |
| Cost | Provider storage and request fees; to be estimated from the real size reported by the first import. |

## 4. Threat model (what we protect against)
| Risk | Control |
|---|---|
| Someone finds a conversation URL | There are none: no public URLs, no share feature; every route needs the owner token (a test lists each endpoint and expects 401 without it). |
| Leaked database or backup | Local disk encryption; backups encrypted and kept private; restore test uses a throwaway local database, deleted afterwards. |
| Secrets inside old conversations | They stay in the stored original (it is the owner's own data) but are **redacted before any AI use**, hidden from summaries, and flagged for the owner to rotate. |
| Prompt injection inside imported text | Imported text is never used as instructions: it is displayed as data only; no AI in the first release; later AI use puts it inside a fixed data block with no tools and schema-checked output. |
| Sensitive family, health or financial topics | Marked held back at import by default and never included in analysis unless the owner releases them. |
| Accidental production import | Importer refuses non-local hosts (see PIH_LOCAL_SETUP.md). |
| Over-collection | One owner, one purpose; delete per conversation, per import, or everything; export everything. |
| Provider processing (later) | A run log records provider, model, purpose and which conversations; off by default; requires its own approval. |

## 5. Decisions needed before any cloud storage
Provider and bucket, who holds the token, whether to add client-side encryption, retention period, and budget. None of this is needed for the first release.
