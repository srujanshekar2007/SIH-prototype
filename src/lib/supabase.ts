import { createClient, type SupabaseClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isSupabaseConfigured = Boolean(url && key && !url.includes('your-project'));
export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
export type CaseRow = { id:string; case_number:string; institution_id:string; category:string|null; subject:string|null; description:string|null; status:string; bureau_id:string|null; assigned_officer_id:string|null; received_at:string; created_at:string; next_action_at:string|null; expected_disposal_at?:string|null; next_action_required?:string|null; priority:string|null; institutions?:{name:string; region:string|null; internal_id:string; aicte_permanent_id?:string|null; address?:string|null}|null; bureaus?:{name:string}|null };
export const friendlyError = (e: unknown) => {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' && e.message.trim()) return e.message;
  return 'Something went wrong. Please try again.';
};

export async function fetchAllPages<T>(queryPage:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:any}>,pageSize=500){
  const rows:T[]=[];
  for(let from=0;;from+=pageSize){const {data,error}=await queryPage(from,from+pageSize-1);if(error)return {data:null as T[]|null,error};const page=(data||[]) as T[];rows.push(...page);if(page.length<pageSize)break;}
  return {data:rows,error:null as any};
}

export async function fetchComplaintCases(client: SupabaseClient) {
  const select = (withExpectedDate: boolean) => fetchAllPages<any>((from, to) => client.from('complaints')
    .select(`id,case_number,institution_id,category,subject,description,status,bureau_id,assigned_officer_id,received_at,created_at,next_action_at,${withExpectedDate ? 'expected_disposal_at,next_action_required,' : ''}priority,institutions(name,region,internal_id,aicte_permanent_id,address),bureaus(name),assigned_officer:profiles!complaints_assigned_officer_id_fkey(display_name)`)
    .order('received_at', { ascending: false }).range(from, to));
  const current = await select(true);
  const message = [current.error?.message, current.error?.details, current.error?.hint].filter(Boolean).join(' ').toLowerCase();
  if (!current.error || !['expected_disposal_at', 'next_action_required'].some((field)=>message.includes(field)) || !['42703', 'PGRST204'].includes(current.error?.code)) return current;
  const legacy = await select(false);
  return legacy.error ? legacy : {
    ...legacy,
    data: (legacy.data || []).map((row: any) => ({ ...row, expected_disposal_at: null, next_action_required: null })),
  };
}

export async function fetchRelationshipReviews(client: SupabaseClient) {
  const query = (columns: string) => fetchAllPages<any>((from, to) => client.from('case_relationships')
    .select(columns).order('created_at', { ascending: false }).range(from, to));
  const current = await query('id,source_case_id,target_case_id,relationship_type,review_status,match_reasons,semantic_similarity,semantic_model,algorithm_version,matching_fields,explanation,created_at,reviewed_at,review_note');
  const message = [current.error?.message, current.error?.details, current.error?.hint].filter(Boolean).join(' ').toLowerCase();
  const migrationMissing = ['semantic_similarity', 'semantic_model', 'matching_fields', 'explanation', 'reviewed_at', 'review_note'].some((column) => message.includes(column))
    && ['42703', 'PGRST204'].includes(current.error?.code);
  if (!migrationMissing) return current;
  const baseline = await query('id,source_case_id,target_case_id,relationship_type,review_status,match_reasons,created_at,reviewed_at,review_note');
  return baseline.error ? baseline : {
    ...baseline,
    data: (baseline.data || []).map((row: any) => ({ ...row, semantic_similarity: null, semantic_model: null, algorithm_version: null, matching_fields: [], explanation: {} })),
  };
}

export type DashboardRelationshipSummary = {
  pending_count: number;
  case_ids: string[];
  by_bureau: { name: string; value: number }[];
  recent: any[];
};

export async function fetchDashboardRelationshipSummary(client: SupabaseClient) {
  try {
    const { data, error } = await client.rpc('dashboard_relationship_summary');
    if (error) return { data: null as DashboardRelationshipSummary | null, error };
    const value = data as Partial<DashboardRelationshipSummary> | null;
    if (!value || !Number.isSafeInteger(value.pending_count) || Number(value.pending_count) < 0
      || !Array.isArray(value.case_ids) || !value.case_ids.every((id) => typeof id === 'string')
      || !Array.isArray(value.by_bureau) || !Array.isArray(value.recent)) {
      return { data: null as DashboardRelationshipSummary | null, error: new Error('The relationship summary returned an incomplete or invalid response.') };
    }
    return {
      data: {
        pending_count: value.pending_count as number,
        case_ids: value.case_ids,
        by_bureau: value.by_bureau,
        recent: value.recent,
      },
      error: null as any,
    };
  } catch (error) {
    return { data: null as DashboardRelationshipSummary | null, error };
  }
}

export async function fetchCaseActions(client: SupabaseClient) {
  return fetchAllPages<any>((from, to) => client.from('case_actions')
    .select('id,complaint_id,action_type,remarks,status_before,status_after,actor:profiles!case_actions_actor_id_fkey(display_name),created_at,actor_id')
    .order('created_at', { ascending: false }).range(from, to));
}

/** Counts only the current user's RLS-visible transfer records for a Bureau dashboard. */
export async function fetchBureauTransferCounts(client: SupabaseClient, bureauId: string) {
  const [incoming, outgoing] = await Promise.all([
    client.from('transfers').select('id', { count: 'exact', head: true }).eq('to_bureau_id', bureauId),
    client.from('transfers').select('id', { count: 'exact', head: true }).eq('from_bureau_id', bureauId),
  ]);
  if (incoming.error) return { data: null as { inBureau: number; outBureau: number } | null, error: incoming.error };
  if (outgoing.error) return { data: null as { inBureau: number; outBureau: number } | null, error: outgoing.error };
  return { data: { inBureau: incoming.count ?? 0, outBureau: outgoing.count ?? 0 }, error: null as any };
}
