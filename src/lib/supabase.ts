import { createClient, type SupabaseClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isSupabaseConfigured = Boolean(url && key && !url.includes('your-project'));
export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
export type CaseRow = { id:string; case_number:string; institution_id:string; category:string|null; subject:string|null; status:string; bureau_id:string|null; assigned_officer_id:string|null; received_at:string; created_at:string; next_action_at:string|null; priority:string|null; institutions?:{name:string; region:string|null; internal_id:string}|null; bureaus?:{name:string}|null };
export const friendlyError = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Please try again.';

export async function fetchAllPages<T>(queryPage:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:any}>,pageSize=500){
  const rows:T[]=[];
  for(let from=0;;from+=pageSize){const {data,error}=await queryPage(from,from+pageSize-1);if(error)return {data:null as T[]|null,error};const page=(data||[]) as T[];rows.push(...page);if(page.length<pageSize)break;}
  return {data:rows,error:null as any};
}
