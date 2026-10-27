import { describe, expect, it, vi } from 'vitest';
import { readAiMatchesResponse } from '../ai-matches-response';

function response(status: number, body: string, contentType = 'application/json; charset=utf-8') {
  return { status, headers: new Headers({ 'content-type': contentType }), text: async () => body } as Response;
}

const success = {
  generated: 2,
  evaluated: 5,
  aboveThreshold: 2,
  cached: 3,
  model: 'text-embedding-3-small',
  algorithmVersion: 'institution-blocked-cosine-v1',
  threshold: 0.78,
  message: 'Suggestions need human review.',
};

describe('AI matching endpoint response contract', () => {
  it('accepts valid success JSON', async () => {
    await expect(readAiMatchesResponse(response(200, JSON.stringify(success)))).resolves.toEqual(success);
  });

  it('accepts a legitimate empty candidate result', async () => {
    const empty = { ...success, generated: 0, evaluated: 0, aboveThreshold: 0, cached: 0 };
    await expect(readAiMatchesResponse(response(200, JSON.stringify(empty)))).resolves.toEqual(empty);
  });

  it('surfaces structured non-success JSON messages', async () => {
    await expect(readAiMatchesResponse(response(503, JSON.stringify({ code: 'ai_not_configured', message: 'Configure the provider.' }))))
      .rejects.toThrow('Configure the provider.');
  });

  it('explains a missing deployed endpoint for a non-JSON 404', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(readAiMatchesResponse(response(404, 'NOT_FOUND', 'text/plain; charset=utf-8')))
      .rejects.toThrow(/not deployed.*HTTP 404/i);
    warn.mockRestore();
  });

  it('handles non-JSON server errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(readAiMatchesResponse(response(502, '<html>bad gateway</html>', 'text/html')))
      .rejects.toThrow(/non-JSON.*HTTP 502/i);
    warn.mockRestore();
  });

  it('handles malformed and empty JSON bodies', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(readAiMatchesResponse(response(200, '{'))).rejects.toThrow(/malformed JSON/i);
    await expect(readAiMatchesResponse(response(200, ''))).rejects.toThrow(/malformed JSON/i);
    warn.mockRestore();
  });

  it('rejects unexpected success JSON rather than treating it as a match run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(readAiMatchesResponse(response(200, JSON.stringify({ generated: 'many' }))))
      .rejects.toThrow(/unexpected success response/i);
    warn.mockRestore();
  });

  it('uses a safe fallback for non-success responses without a message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(readAiMatchesResponse(response(500, JSON.stringify({ code: 'internal_error' }))))
      .rejects.toThrow(/HTTP 500/i);
    warn.mockRestore();
  });

  it('reports a response body read failure', async () => {
    const invalid = { status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => { throw new Error('read failed'); } } as unknown as Response;
    await expect(readAiMatchesResponse(invalid)).rejects.toThrow(/Could not read/i);
  });
});
