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

function isMissingAssignmentSchema(error: any) {
  const message = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
  return (message.includes('assigned_to') || message.includes('case_actions_assigned_to_fkey')) &&
    (['42703', 'PGRST200', 'PGRST204'].includes(error?.code) || /column|relationship|foreign key|schema cache|not found|does not exist/.test(message));
}

export async function fetchCaseActions(client: SupabaseClient) {
  const query = (columns: string) => fetchAllPages<any>((from, to) => client.from('case_actions')
    .select(columns).order('created_at', { ascending: false }).range(from, to));
  const current = await query('id,complaint_id,action_type,remarks,status_before,status_after,assigned_to,assigned_to_profile:profiles!case_actions_assigned_to_fkey(display_name),actor:profiles!case_actions_actor_id_fkey(display_name),created_at,actor_id');
  if (!isMissingAssignmentSchema(current.error)) return current;

  const withoutJoin = await query('id,complaint_id,action_type,remarks,status_before,status_after,assigned_to,actor:profiles!case_actions_actor_id_fkey(display_name),created_at,actor_id');
  if (!isMissingAssignmentSchema(withoutJoin.error)) return withoutJoin;

  const baseline = await query('id,complaint_id,action_type,remarks,status_before,status_after,actor:profiles!case_actions_actor_id_fkey(display_name),created_at,actor_id');
  return baseline.error ? baseline : {
    ...baseline,
    data: (baseline.data || []).map((action: any) => ({ ...action, assigned_to: null, assigned_to_profile: null })),
  };
}
