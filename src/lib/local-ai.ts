import { supabase } from './supabase';

export async function summarizeAuthorizedCase(caseId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Sign in again to use local case summaries.');

  const response = await fetch(`/api/ai/cases/${encodeURIComponent(caseId)}/summary`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const result = await response.json().catch(() => null) as { summary?: string; error?: string } | null;
  if (!response.ok) throw new Error(result?.error || 'Local AI could not summarize this case.');
  if (!result?.summary) throw new Error('Local AI returned no summary.');
  return result.summary;
}
