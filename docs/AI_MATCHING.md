# AI-assisted overlap matching

## Provider and input

The server uses OpenAI Embeddings API with `text-embedding-3-small` (1536 dimensions). This is an embedding model, not a text-generating model; there is no generative summary or Gemini provider in the current implementation. The browser calls `POST /api/overlap/matches`; local Vite proxies to the local Express adapter and Vercel deploys `api/overlap/matches.ts`.

Only subject, category, and description are composed into provider input. Common labeled complainant/student names, identifiers, contact fields, standalone emails, and phone-like strings are heuristically redacted before both hashing and embedding. This can miss information and must not be described as anonymization. External processing is disabled unless `AI_EXTERNAL_COMPLAINT_TEXT_APPROVED=true` and the signed-in user accepts the per-run disclosure.

## Candidate and score semantics

- Hard candidate block: same canonical `institution_id` and distinct non-null `bureau_id`; both records must be visible to the caller and within the caller's action scope.
- Signal: cosine similarity between the two text embeddings. Category and dates/status are context in the stored explanation; they are not score components. Institution equality and bureau difference are eligibility gates, not scored AI features.
- Default threshold: `0.78`, configurable through `AI_SIMILARITY_THRESHOLD`. It is an uncalibrated operating default, not a validated cutoff.
- Stored score: raw cosine similarity in `[-1,1]`, not a probability, confidence, or proof of duplication. Suggestions never merge or modify complaints and require an authorized human decision.
- Existing pending relationships may be updated with current score/evidence; confirmed/rejected relationships are skipped. Pair uniqueness and text/model hashes support idempotency.

## Limits and failure behavior

Maximum 500 caller-visible cases, 25,000 candidate pairs, 128 uncached complaint embeddings per run, 64 texts per provider batch, 8,000 characters per text, 20-second provider request timeout, and 1536 dimensions. Provider errors map to JSON errors; rate limiting is surfaced for retry. The cache is private to `service_role`; changed text/model causes re-embedding. There is no per-user rolling quota or retry scheduler.

No embedding cache or score constitutes model calibration. Before operational use, assemble approved labeled pairs, measure false positives/negatives across categories/languages, adjust the threshold with officials, and record the evaluation.

## Configuration and cost

See `.env.example` and `MANUAL_SETUP.md`. Required server settings for generation: Supabase server URL/publishable key, service-role key for restricted server operations, `OPENAI_API_KEY`, migration applied, and the explicit external-processing approval flag. Cost is incurred for uncached text sent to the provider. Repeated unchanged input reuses vectors; no keys are present in the browser bundle by design.

## Human review concepts

The existing `case_relationships` table persists a pending suggestion; official confirmation/rejection changes review status and is audited. This data model does not automatically label a suggestion as a confirmed duplicate; reviewers must record a decision and should explain it in a note where the UI offers that field. Rule-based suggestions remain separate and available without OpenAI.
