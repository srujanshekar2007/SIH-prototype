# AICTE Assistant: local deterministic help

## Model-free design

The in-portal AICTE Assistant does not use a language model, inference service, AI API, network request, or generated response. “AICTE Assistant” is the product label; the implementation is ordinary deterministic TypeScript. Static guidance continues to work with no database connection once the application bundle has loaded.

This is independent of the portal’s optional semantic case-matching feature. Existing semantic matching is an administrator-controlled workflow, described in [AI_MATCHING.md](AI_MATCHING.md), and is not called by the assistant.

## Architecture

- `src/lib/assistant/knowledge.ts` is the curated knowledge registry. Entries state the verified topic, intent, terms, example questions, answer, relevant UI section, and related topics. Entries are based on this project’s components, README, and migrations. The assistant does not state unverified external AICTE rules.
- `src/lib/assistant/intents.ts` normalizes text, expands a short list of common misspellings, matches phrases/synonyms, recognizes abbreviations, extracts status/bureau/case-number entities, and ranks an explicit intent list. When confidence is low, the assistant asks a focused clarification rather than making up an answer.
- `src/lib/assistant/respond.ts` creates structured answers and applies deterministic filters and date/priority rules to supplied authorized records. It accepts data as arguments and has no database client, network call, SQL generation, or write capability.
- `src/components/AICTEAssistant.tsx` handles chat rendering, suggested prompts, loading indicator, clear conversation, scroll behavior, and per-mounted-user context. Case responses use the complaint/action/relationship data already fetched by the portal with the signed-in Supabase client. Existing RLS remains the server-side boundary. The assistant applies the dashboard’s role scope again before display and filters actions to those cases.

Conversation context contains only the prior intent, bureau/status filter, and previous case numbers for follow-ups. It stays in component memory, is reset by Clear, and is isolated by a component key derived from the authenticated user ID. Chat messages are not stored in local storage or sent to a model. On sign-out the signed-in app tree unmounts.

## Supported questions

The current registry covers portal overview and navigation; dashboard and registry; institutions and stored AICTE Permanent IDs; complaint statuses/categories; PGRC/RB units; assignments, workflow, transfers, escalation, and recorded deadlines; overdue/urgent lists; overlap/relationship review and the portal’s optional semantic-matching documentation; reports; coordination; authentication; roles; and RLS/security.

For live questions, the assistant can summarize currently loaded authorized records: counts and status breakdowns, matching case lists, overdue cases, urgent cases based on recorded overdue dates or explicit high/urgent/critical priority, and workload by bureau. Case summaries show the case number, institution, bureau, status, recorded expected-disposal date, next action/date, and most recent action type/date. It avoids action remarks and complaint descriptions. Data-load errors are reported rather than shown as successful zero counts.

Follow-ups such as “Only PGRC,” “pending ones,” “which one is most urgent?” and “explain why” filter or inspect the previous result. If an item is not in the records loaded for the current user, the assistant says it could not find it; it does not attempt an elevated lookup. It cannot mutate cases or permissions, run arbitrary SQL, or retrieve unloaded records.

## Local/offline behavior and limits

Guidance lookup and response generation are local. Live complaint answers require the portal’s Supabase connection and whatever authorized data the portal has loaded. The assistant does not issue its own fresh live query; refresh the portal to fetch current records. A role can only receive records returned by existing RLS and dashboard scoping. The result is therefore not a real-time database guarantee.

Basic text matching is not general language understanding. Unsupported questions should prompt clarification. The curated intent evaluation file is `src/lib/assistant/evaluation.json`; tests use exact expected intent matches. On the current 30-question sample, classification is **30/30 (100%)**. This is a small project-authored evaluation, not a representative benchmark or proof of correctness for arbitrary phrasing.

## Verification

`src/lib/__tests__/assistant.test.ts` covers the evaluation set, typos/abbreviations, counts and lists from supplied data, deadlines/priority, follow-up scope, missing data, prompt-injection attempts, per-context isolation, and absence of network/model calls in the question engine/UI. These use fixtures; they do not verify a live Supabase project, real RLS policies, or multi-role behavior against production data.
