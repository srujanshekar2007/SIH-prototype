import type { ComplaintForMatching } from '../../server/semantic-matching';

type RequestLike = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(value: unknown): void;
};

const MAX_DESCRIPTION = 8000;

export default async function handler(req: RequestLike, res: ResponseLike) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (String(req.method || '').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reply(res, 405, { code: 'method_not_allowed', message: 'Use POST to generate suggestions.' });
  }

  const authorization = header(req, 'authorization');
  const token = /^Bearer\s+(.+)$/i.exec(authorization || '')?.[1];
  if (!token || token.length > 8192) return reply(res, 401, { code: 'unauthenticated', message: 'Sign in again to generate AI-assisted matches.' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return reply(res, 503, { code: 'server_not_configured', message: 'Server-side Supabase URL and publishable key are not configured.' });
  let adminClient: any;

  try {
    // Keep unsupported methods and configuration failures independent of runtime client setup.
    const [{ createClient }, matching] = await Promise.all([
      import('@supabase/supabase-js'),
      import('../../server/semantic-matching'),
    ]);
    const callerClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: auth, error: authError } = await callerClient.auth.getUser(token);
    if (authError || !auth.user) return reply(res, 401, { code: 'unauthenticated', message: 'Your session is invalid or expired. Sign in again.' });

    let { data: profile, error: profileError } = await callerClient.from('profiles')
      .select('id,role,is_admin,active,bureau_id,can_manage_bureau')
      .eq('id', auth.user.id).maybeSingle();
    if (isMissingBureauPermissionColumn(profileError)) {
      const legacyProfile = await callerClient.from('profiles')
        .select('id,role,is_admin,active,bureau_id')
        .eq('id', auth.user.id).maybeSingle();
      profile = legacyProfile.data ? { ...legacyProfile.data, can_manage_bureau: null } : null;
      profileError = legacyProfile.error;
    }
    if (profileError) return reply(res, 503, { code: 'profile_unavailable', message: 'Could not verify the active profile and permissions.' });
    const workflowRole = ['pgrc_officer', 'rb_officer', 'bureau_officer'].includes(profile?.role);
    if (!profile?.active || !(profile.is_admin === true || workflowRole)) {
      return reply(res, 403, { code: 'forbidden', message: 'An active workflow-authorized profile is required. Read-only AICTE oversight accounts cannot generate suggestions.' });
    }

    const caseGraphUrl = process.env.CASEGRAPH_MATCHING_URL;
    const caseGraphKey = process.env.CASEGRAPH_API_KEY;
    const caseGraphConfigured = Boolean(caseGraphUrl && caseGraphKey);
    if (Boolean(caseGraphUrl) !== Boolean(caseGraphKey)) {
      return reply(res, 503, { code: 'casegraph_misconfigured', message: 'The semantic matching service is not fully configured. Existing rule-based suggestions remain available.' });
    }
    if (!caseGraphConfigured && !process.env.OPENAI_API_KEY) return reply(res, 503, { code: 'ai_not_configured', message: 'AI matching is not configured. The existing rule-based Find suggestions action remains available.' });
    if (process.env.AI_EXTERNAL_COMPLAINT_TEXT_APPROVED !== 'true') {
      return reply(res, 503, { code: 'ai_privacy_not_approved', message: 'An administrator must explicitly approve sending complaint subject, category, and description to the configured external matching provider.' });
    }
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return reply(res, 503, { code: 'server_not_configured', message: 'The server-only Supabase service credential is not configured. It is used only after caller authorization and is never sent to the browser.' });
    adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const model = caseGraphConfigured
      ? matching.CASEGRAPH_MODEL_ID
      : process.env.OPENAI_EMBEDDING_MODEL || matching.EMBEDDING_MODEL;

    if (req.body !== undefined && req.body !== null && (typeof req.body !== 'object' || Array.isArray(req.body))) {
      return reply(res, 400, { code: 'invalid_request', message: 'Send the matching options as a JSON object.' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const thresholdResult = matching.resolveSimilarityThreshold(process.env.AI_SIMILARITY_THRESHOLD, body.threshold);
    if ('error' in thresholdResult && thresholdResult.error === 'invalid_request') {
      return reply(res, 400, { code: 'invalid_threshold', message: 'threshold must be a finite number from 0 to 1, or null to use the configured default.' });
    }
    if ('error' in thresholdResult) {
      return reply(res, 503, { code: 'invalid_configuration', message: 'AI_SIMILARITY_THRESHOLD must be a number from 0 to 1.' });
    }
    const threshold = thresholdResult.value;

    const rows: ComplaintForMatching[] = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await callerClient.from('complaints')
        .select('id,case_number,institution_id,category,subject,description,status,bureau_id,assigned_officer_id,received_at,institutions(name,internal_id,aicte_permanent_id),bureaus(name)')
        .order('received_at', { ascending: false }).range(from, from + 499);
      if (error) return reply(res, 503, { code: 'authorized_cases_unavailable', message: 'Could not load complaint records permitted by your Supabase access scope.' });
      rows.push(...((data || []) as unknown as ComplaintForMatching[]));
      if (rows.length > matching.MAX_AUTHORIZED_CASES) return reply(res, 413, { code: 'scope_too_large', message: `AI matching is capped at ${matching.MAX_AUTHORIZED_CASES} authorized cases per run. Ask an administrator to narrow the scope or deploy indexed retrieval.` });
      if ((data || []).length < 500) break;
    }

    const actorRows = rows.filter((row) => matching.canActorCompareCase(row, profile, auth.user.id));
    const { data: existingRows, error: existingError } = await callerClient.from('case_relationships')
      .select('source_case_id,target_case_id,review_status,semantic_similarity,semantic_model,source_text_hash,target_text_hash,explanation');
    if (existingError) {
      return reply(res, 503, {
        code: 'migration_required',
        message: 'Apply migration 202610270001_ai_semantic_overlap.sql to enable the AI review metadata and embedding cache. Existing rule-based suggestions remain available.',
      });
    }
    const existing = new Map((existingRows || []).map((row: any) => [matching.relationshipKey(row.source_case_id, row.target_case_id), row]));
    let pairs;
    try {
      pairs = matching.buildCandidatePairs(actorRows, existing, model, matching.MAX_CANDIDATE_PAIRS, threshold, caseGraphConfigured);
    } catch (error) {
      return reply(res, 413, { code: 'candidate_limit', message: error instanceof Error ? error.message : 'The candidate limit was exceeded.' });
    }
    if (!pairs.length) return reply(res, 200, {
      generated: 0,
      evaluated: 0,
      aboveThreshold: 0,
      cached: 0,
      model,
      algorithmVersion: matching.MATCHING_VERSION,
      threshold,
      message: 'No new cross-bureau candidates with enough complaint text were found for the same institution.',
    });

    const relevant = new Map<string, ComplaintForMatching>();
    for (const pair of pairs) { relevant.set(pair.source.id, pair.source); relevant.set(pair.target.id, pair.target); }
    const candidateRows = [...relevant.values()];
    let suggestions: ReturnType<typeof matching.makeSuggestion>[];
    let cachedCount = 0;

    if (caseGraphConfigured) {
      const caseGraph = await import('../../server/casegraph-client');
      if (candidateRows.length > caseGraph.MAX_CASEGRAPH_CASES_PER_REQUEST) {
        return reply(res, 413, { code: 'casegraph_batch_limit', message: `CaseGraph matching supports at most ${caseGraph.MAX_CASEGRAPH_CASES_PER_REQUEST} distinct candidate complaints per run. Narrow the authorized institution scope; existing rule-based suggestions remain available.` });
      }
      let scores: Map<string, number>;
      try {
        scores = await caseGraph.requestCaseGraphScores(pairs, caseGraphUrl!, caseGraphKey!);
      } catch (error) {
        if (error instanceof caseGraph.CaseGraphServiceError && error.kind === 'timeout') {
          return reply(res, 504, { code: 'casegraph_timeout', message: 'The semantic matching service timed out. No relationship suggestions were changed.' });
        }
        if (error instanceof caseGraph.CaseGraphServiceError && error.kind === 'invalid_response') {
          return reply(res, 502, { code: 'casegraph_invalid_response', message: 'The semantic matching service returned invalid results. No suggestions were changed.' });
        }
        return reply(res, 502, { code: 'casegraph_unavailable', message: 'The semantic matching service is unavailable. No suggestions were changed; the existing rule-based action remains available.' });
      }
      suggestions = pairs.map((pair) => matching.makeSuggestionFromScore(
        pair,
        scores.get(matching.relationshipKey(pair.source.id, pair.target.id))!,
        threshold,
        model,
      ));
    } else {
    const cache = new Map<string, { content_hash: string; model: string; embedding: number[] }>();
    for (let i = 0; i < candidateRows.length; i += 100) {
      const ids = candidateRows.slice(i, i + 100).map((row) => row.id);
      const { data, error } = await adminClient.from('case_text_embeddings')
        .select('complaint_id,content_hash,model,embedding').in('complaint_id', ids);
      if (error) return reply(res, 503, { code: 'migration_required', message: 'The private embedding cache is unavailable. Apply migration 202610270001_ai_semantic_overlap.sql.' });
      for (const entry of data || []) cache.set(entry.complaint_id, entry as any);
    }

    const vectors = new Map<string, number[]>();
    const missing: { row: ComplaintForMatching; text: string; hash: string }[] = [];
    for (const row of candidateRows) {
      const text = matching.complaintEmbeddingText(row);
      if (!text) continue;
      const hash = matching.textHash(text);
      const cached = cache.get(row.id);
      if (cached?.content_hash === hash && cached.model === model && Array.isArray(cached.embedding) && cached.embedding.length === 1536) {
        vectors.set(row.id, cached.embedding);
      } else missing.push({ row, text: text.slice(0, MAX_DESCRIPTION), hash });
    }

    if (missing.length > matching.MAX_UNCACHED_EMBEDDINGS_PER_RUN) {
      return reply(res, 413, {
        code: 'embedding_batch_limit',
        message: `This run needs embeddings for ${missing.length} uncached complaints; the per-run limit is ${matching.MAX_UNCACHED_EMBEDDINGS_PER_RUN}. Narrow the scope or rerun after cached vectors are available.`,
      });
    }

    cachedCount = vectors.size;
    for (let i = 0; i < missing.length; i += matching.EMBEDDING_BATCH_SIZE) {
      const batch = missing.slice(i, i + matching.EMBEDDING_BATCH_SIZE);
      let orderedVectors: number[][];
      try { orderedVectors = await matching.requestEmbeddingBatch(batch.map((entry) => entry.text), process.env.OPENAI_API_KEY!, model); }
      catch (error) {
        if (error instanceof matching.EmbeddingProviderError && error.kind === 'timeout') return reply(res, 504, { code: 'provider_timeout', message: 'The embedding provider timed out. No relationship suggestions were changed.' });
        if (error instanceof matching.EmbeddingProviderError && error.kind === 'rate_limit') return reply(res, 503, { code: 'provider_rate_limited', message: 'The embedding provider is rate-limiting requests. Wait briefly and retry.' });
        if (error instanceof matching.EmbeddingProviderError && error.kind === 'invalid_response') return reply(res, 502, { code: 'invalid_provider_response', message: 'The embedding provider returned an invalid vector. No suggestion records were changed.' });
        return reply(res, 502, { code: 'provider_error', message: 'The embedding provider failed to process this batch. No suggestion records were changed.' });
      }
      const cacheUpserts = batch.map((entry, index) => ({
        complaint_id: entry.row.id,
        content_hash: entry.hash,
        model,
        embedding: orderedVectors[index],
        updated_at: new Date().toISOString(),
      }));
      const { error: cacheError } = await adminClient.from('case_text_embeddings').upsert(cacheUpserts, { onConflict: 'complaint_id' });
      if (cacheError) return reply(res, 503, { code: 'embedding_cache_error', message: 'Could not save the private embedding cache. No relationship suggestions were changed.' });
      for (let index = 0; index < batch.length; index += 1) vectors.set(batch[index].row.id, orderedVectors[index]);
    }

    suggestions = pairs.map((pair) => matching.makeSuggestion(pair, vectors, threshold, model));
    }
    const persisted = suggestions.filter((suggestion) => {
      const existingRow = existing.get(suggestion.key);
      return suggestion.shouldInsert || existingRow?.review_status === 'pending';
    }).map((suggestion) => ({
      source_case_id: suggestion.source.id,
      target_case_id: suggestion.target.id,
      semantic_similarity: suggestion.similarity,
      semantic_model: suggestion.model,
      algorithm_version: matching.MATCHING_VERSION,
      matching_fields: suggestion.matchingFields,
      match_reasons: suggestion.reasons,
      explanation: suggestion.explanation,
      source_text_hash: suggestion.sourceTextHash,
      target_text_hash: suggestion.targetTextHash,
      should_insert: suggestion.shouldInsert,
    }));
    let generated = 0;
    if (persisted.length) {
      const { data, error } = await adminClient.rpc('persist_ai_relationship_suggestions', { actor: auth.user.id, suggestions: persisted });
      if (error) return reply(res, 503, { code: 'persist_failed', message: 'Could not safely persist the AI review suggestions. No complaint record was modified.' });
      generated = Number(data) || 0;
    }
    return reply(res, 200, {
      generated,
      evaluated: suggestions.length,
      aboveThreshold: suggestions.filter((suggestion) => suggestion.shouldInsert).length,
      cached: cachedCount,
      model,
      algorithmVersion: matching.MATCHING_VERSION,
      threshold,
      message: 'AI-generated suggestions require human review. Similarity is not a probability and never confirms a duplicate.',
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    return reply(res, isTimeout ? 504 : 503, {
      code: isTimeout ? 'provider_timeout' : 'matching_unavailable',
      message: isTimeout ? 'The embedding provider timed out. No relationship suggestions were changed.' : 'AI matching is temporarily unavailable. Existing rule-based matching remains available.',
    });
  }
}

function header(req: RequestLike, name: string): string | undefined {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isMissingBureauPermissionColumn(error: any): boolean {
  if (!error) return false;
  const details = [error.message, error.details, error.hint].filter(Boolean).join(' ').toLowerCase();
  return details.includes('can_manage_bureau') && (
    error.code === '42703' || error.code === 'PGRST204'
    || /column.{0,80}(does not exist|not found|schema cache)/.test(details)
    || /could not find.{0,80}column/.test(details)
  );
}

function reply(res: ResponseLike, status: number, body: unknown) {
  return res.status(status).json(body);
}
