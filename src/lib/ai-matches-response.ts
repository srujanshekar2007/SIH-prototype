export type AiMatchesResult = {
  generated: number;
  evaluated: number;
  aboveThreshold: number;
  cached: number;
  model: string;
  algorithmVersion: string;
  threshold: number;
  message: string;
};

type HttpResponseLike = Pick<Response, 'status' | 'headers' | 'text'>;

export async function readAiMatchesResponse(response: HttpResponseLike): Promise<AiMatchesResult> {
  const contentType = response.headers.get('content-type') || '';
  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new Error('Could not read the AI matching response. Check the connection and retry.');
  }

  if (!contentType.toLowerCase().includes('application/json')) {
    console.warn('[AI matching] Non-JSON endpoint response', { status: response.status, contentType: contentType || 'missing' });
    if (response.status === 404) {
      throw new Error('The AI matching endpoint is not deployed in this Vercel version (HTTP 404). Deploy the latest project revision containing api/overlap/matches.ts, then retry.');
    }
    throw new Error(`The AI matching endpoint returned a non-JSON response (HTTP ${response.status}). Check the deployment and retry.`);
  }

  let payload: unknown;
  try {
    if (!body.trim()) throw new Error('empty response');
    payload = JSON.parse(body);
  } catch {
    console.warn('[AI matching] Malformed JSON response', { status: response.status, contentType });
    throw new Error(`The AI matching endpoint returned malformed JSON (HTTP ${response.status}). Check the deployment logs and retry.`);
  }

  if (!responseOk(response.status)) {
    const error = isRecord(payload) && typeof payload.message === 'string'
      ? payload.message
      : `AI matching failed (HTTP ${response.status}). Existing rule-based suggestions remain available.`;
    if (isRecord(payload)) console.warn('[AI matching] Request rejected', { status: response.status, code: typeof payload.code === 'string' ? payload.code : 'unknown' });
    return throwError(error);
  }

  if (!isRecord(payload) || !isNonNegativeInteger(payload.generated) || !isNonNegativeInteger(payload.evaluated)
    || !isNonNegativeInteger(payload.aboveThreshold) || !isNonNegativeInteger(payload.cached)
    || typeof payload.model !== 'string' || !payload.model.trim()
    || typeof payload.algorithmVersion !== 'string' || !payload.algorithmVersion.trim()
    || typeof payload.threshold !== 'number' || !Number.isFinite(payload.threshold) || payload.threshold < 0 || payload.threshold > 1
    || typeof payload.message !== 'string' || !payload.message.trim()) {
    console.warn('[AI matching] Unexpected success response structure', { status: response.status });
    throw new Error('The AI matching endpoint returned an unexpected success response. Confirm the frontend and deployed API versions match.');
  }

  return payload as AiMatchesResult;
}

function responseOk(status: number) { return status >= 200 && status < 300; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function throwError(message: string): never { throw new Error(message); }
