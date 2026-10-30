# AI-assisted overlap matching

## Provider and input

The server supports the existing OpenAI Embeddings API (`text-embedding-3-small`) and an optional separately hosted CaseGraph inference service using pretrained `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`. If both `CASEGRAPH_MATCHING_URL` and `CASEGRAPH_API_KEY` are configured, CaseGraph is selected; otherwise the existing OpenAI path is retained. The browser calls `POST /api/overlap/matches`; local Vite proxies to the local Express adapter and Vercel deploys `api/overlap/matches.ts`. CaseGraph has no fine-tuned weights or completed training run in the supplied archive. See [matching-service/casegraph](../matching-service/casegraph/README.md).

Only subject, category, and description are composed into provider input. Common labeled complainant/student names, identifiers, contact fields, standalone emails, and phone-like strings are heuristically redacted before both hashing and inference. This can miss information and must not be described as anonymization. External processing is disabled unless `AI_EXTERNAL_COMPLAINT_TEXT_APPROVED=true` and the signed-in user accepts the per-run disclosure. The Vercel endpoint authenticates the user and loads RLS-visible cases before transmitting candidate text. The inference service has no Supabase credentials and requires its own bearer key.

## Candidate and score semantics

- Hard candidate block for CaseGraph: same canonical `institution_id`, both records must have non-null bureau IDs, and both records must be visible to the caller and within the caller's action scope. Same-bureau and cross-bureau candidates are considered. The prior OpenAI path keeps its cross-bureau-only candidate behavior.
- Signal: cosine similarity between the two text embeddings. Category and dates/status are context in the stored explanation; they are not score components. Institution equality and bureau difference are eligibility gates, not scored AI features.
- Default threshold: `0.78`, configurable through server-side `AI_SIMILARITY_THRESHOLD`. The Overlap Monitoring selector offers `0.50`, `0.65`, `0.78`, `0.85`, and `0.90`; the selected number is sent with each Generate AI Matches request and controls persistence for that run. `Any / rule-based` removes the queue's score filter; for an AI run with that selection, the server's configured default is used. The selector also filters the visible queue: rule-based rows without a score appear only under `Any / rule-based`.
- These values are uncalibrated operating thresholds, not validated cutoffs. Changing the selected value and rerunning reuses unchanged cached embeddings but reevaluates pending-pair metadata at the requested threshold. Confirmed/rejected decisions are not recomputed.
- Stored score: raw cosine similarity in `[-1,1]`, not a probability, confidence, or proof of duplication. Suggestions never merge or modify complaints and require an authorized human decision.
- Existing pending relationships may be updated with current score/evidence; confirmed/rejected relationships are skipped. Pair uniqueness and text/model hashes support idempotency.

## Limits and failure behavior

Maximum 500 caller-visible cases, 25,000 candidate pairs, 128 uncached complaint embeddings per run, 64 texts per provider batch, 8,000 characters per text, 20-second provider request timeout, and 1536 dimensions. Provider errors map to JSON errors; rate limiting is surfaced for retry. The cache is private to `service_role`; changed text/model causes re-embedding. There is no per-user rolling quota or retry scheduler.

No embedding cache or score constitutes model calibration. Before operational use, assemble approved labeled pairs, measure false positives/negatives across categories/languages, adjust the threshold with officials, and record the evaluation.

## Configuration and cost

See `.env.example`, `MANUAL_SETUP.md`, and the [CaseGraph service guide](../matching-service/casegraph/README.md). Required AICTE server settings include Supabase URL/publishable key, service-role key for restricted persistence, migration applied, and the explicit external-processing approval flag. OpenAI additionally needs `OPENAI_API_KEY`. CaseGraph additionally needs the HTTPS URL and matching bearer key on both servers. CaseGraph uses no complaint database/cache and does not incur per-token provider API cost, but its separate host has CPU, memory, uptime, and potentially hosting costs. No production host is configured by this source integration.

## Human review concepts

The existing `case_relationships` table persists a pending suggestion; official confirmation/rejection changes review status and is audited. This data model does not automatically label a suggestion as a confirmed duplicate; reviewers must record a decision and should explain it in a note where the UI offers that field. Rule-based suggestions remain separate and available without OpenAI.
