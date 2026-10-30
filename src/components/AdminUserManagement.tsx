import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save, ShieldCheck, Users } from 'lucide-react';
import { fetchAllPages, friendlyError, supabase } from '../lib/supabase';
import { isMissingBureauPermissionColumn } from '../lib/profile';

type Role = 'public_user'|'aicte_official'|'pgrc_officer'|'rb_officer'|'bureau_officer'|'administrator';
type ProfileRow = { id:string; display_name:string; role:Role; bureau_id:string|null; is_admin:boolean; active:boolean; can_manage_bureau?:boolean|null; bureaus?:{name?:string|null}|{name?:string|null}[]|null };
type Draft = { role:Role; bureau_id:string; active:boolean; can_manage_bureau:boolean };
const roles:Role[]=['public_user','aicte_official','pgrc_officer','rb_officer','bureau_officer','administrator'];
const bureauRoles=new Set<Role>(['pgrc_officer','rb_officer','bureau_officer']);

export default function AdminUserManagement({ currentUserId }: { currentUserId:string }) {
 const [users,setUsers]=useState<ProfileRow[]>([]),[bureaus,setBureaus]=useState<{id:string;name:string}[]>([]),[drafts,setDrafts]=useState<Record<string,Draft>>({}),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[busyId,setBusyId]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
 const load=async()=>{
  if(!supabase){setError('Supabase is not configured.');setLoading(false);return}
  setLoading(true);setError('');
  try{
   let includeScope=true;
   let result=await fetchAllPages<ProfileRow>((from,to)=>supabase!.from('profiles').select('id,display_name,role,bureau_id,is_admin,active,can_manage_bureau,bureaus(name)').order('display_name').range(from,to));
   if(isMissingBureauPermissionColumn(result.error)){
    includeScope=false;
    result=await fetchAllPages<ProfileRow>((from,to)=>supabase!.from('profiles').select('id,display_name,role,bureau_id,is_admin,active,bureaus(name)').order('display_name').range(from,to));
   }
   if(result.error)throw result.error;
   const bureauResult=await fetchAllPages<{id:string;name:string}>((from,to)=>supabase!.from('bureaus').select('id,name').eq('active',true).order('name').range(from,to));
   if(bureauResult.error)throw bureauResult.error;
   const normalized=(result.data||[]).map(row=>({...row,can_manage_bureau:includeScope?row.can_manage_bureau:null}));
   setUsers(normalized);setBureaus(bureauResult.data||[]);
   setDrafts(Object.fromEntries(normalized.map(row=>[row.id,{role:row.role,bureau_id:row.bureau_id||'',active:row.active,can_manage_bureau:row.can_manage_bureau==null?true:row.can_manage_bureau}])));
  }catch(reason){setError(`Could not load user profiles: ${friendlyError(reason)}`)}finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[]);
 const visible=useMemo(()=>users.filter(user=>`${user.display_name} ${user.role}`.toLowerCase().includes(search.trim().toLowerCase())),[users,search]);
 const change=(id:string,key:keyof Draft,value:string|boolean)=>setDrafts(current=>({...current,[id]:{...current[id],[key]:value}}));
 const save=async(user:ProfileRow)=>{
  const draft=drafts[user.id];if(!draft||!supabase)return;
  if(bureauRoles.has(draft.role)&&!draft.bureau_id){setError('Choose a Bureau/Cell for officer roles.');return}
  setBusyId(user.id);setError('');setMessage('');
  try{
   const update={role:draft.role,bureau_id:bureauRoles.has(draft.role)?draft.bureau_id:null,is_admin:draft.role==='administrator',active:draft.active};
   let result=await supabase.from('profiles').update({...update,can_manage_bureau:bureauRoles.has(draft.role)?draft.can_manage_bureau:false}).eq('id',user.id).select('id').maybeSingle();
   if(isMissingBureauPermissionColumn(result.error))result=await supabase.from('profiles').update(update).eq('id',user.id).select('id').maybeSingle();
   if(result.error)throw result.error;
   if(!result.data)throw new Error('The profile was not updated. Confirm your administrator permissions.');
   setMessage(`Updated access for ${user.display_name||user.id}.`);await load();
  }catch(reason){setError(`Could not update this profile: ${friendlyError(reason)}`)}finally{setBusyId('')}
 };
 return <div className="panel"><div className="panel-head"><div><h2><Users size={16}/> Registered user profiles</h2><p>Public sign-ups start as restricted Public Users. Only an active administrator can change profile roles or access.</p></div><button className="button secondary" disabled={loading} onClick={()=>void load()}><RefreshCw size={14}/>Refresh</button></div>
  <div className="notice info"><ShieldCheck size={17}/><div><b>Protected by Supabase RLS</b><span>Updates use the signed-in administrator's session and the existing profile-admin policy. No service-role key is used in the browser. Deactivating a profile removes its application authorization; it does not delete the Auth account.</span></div></div>
  {error&&<div className="form-error" role="alert">{error}</div>}{message&&<div className="notice success" role="status">{message}</div>}
  <div className="toolbar"><div className="searchbox"><Users size={15}/><input aria-label="Search user profiles" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search name or role"/></div><span className="results-line">{users.length} profiles</span></div>
  {loading?<div className="loading-strip"><div className="spinner small"/>Loading authorized profiles…</div>:visible.length?<div className="table-wrap"><table className="user-management-table"><thead><tr><th>ACCOUNT</th><th>ROLE</th><th>BUREAU / CELL</th><th>ACCESS</th><th>MANAGEMENT SCOPE</th><th>ACTION</th></tr></thead><tbody>{visible.map(user=>{const draft=drafts[user.id]||{role:user.role,bureau_id:user.bureau_id||'',active:user.active,can_manage_bureau:user.can_manage_bureau??true};const self=user.id===currentUserId;const currentBureau=Array.isArray(user.bureaus)?user.bureaus[0]:user.bureaus;const bureauName=draft.bureau_id===user.bureau_id?currentBureau?.name:bureaus.find(bureau=>bureau.id===draft.bureau_id)?.name;return <tr key={user.id}><td><b>{user.display_name?.trim()||'Name not recorded'}</b>{self&&<small className="sub-cell">You</small>}</td><td><select aria-label={`Role for ${user.display_name||'user'}`} value={draft.role} disabled={self} onChange={event=>change(user.id,'role',event.target.value as Role)}>{roles.map(role=><option key={role} value={role}>{role.replaceAll('_',' ')}</option>)}</select></td><td><select aria-label={`Bureau for ${user.display_name||'user'}`} value={draft.bureau_id} disabled={!bureauRoles.has(draft.role)||self} onChange={event=>change(user.id,'bureau_id',event.target.value)}><option value="">No Bureau/Cell</option>{bureaus.map(bureau=><option key={bureau.id} value={bureau.id}>{bureau.name}</option>)}</select></td><td><label className="admin-access-toggle active-switch"><input type="checkbox" role="switch" aria-label={`Active status for ${user.display_name||'user'}`} checked={draft.active} disabled={self} onChange={event=>{if(!event.target.checked&&!window.confirm(`Deactivate ${user.display_name||'this account'}? They will lose application access.`))return;change(user.id,'active',event.target.checked)}}/><span className="switch-track" aria-hidden="true"/><span>{draft.active?'Active':'Inactive'}</span></label></td><td><span className="scope-readonly">{bureauRoles.has(draft.role)&&draft.can_manage_bureau?(bureauName?`This bureau: ${bureauName}`:'This bureau'): 'No management access'}</span></td><td><button className="button secondary" disabled={self||busyId===user.id||!supabase} onClick={()=>void save(user)}><Save size={14}/>{busyId===user.id?'Saving…':'Save access'}</button></td></tr>})}</tbody></table><p className="scope-migration-note">Management scope changes are not available yet: current database access supports only a single assigned bureau. PGRC, RB, and All Bureaus require a reviewed database migration before these options can be safely saved.</p></div>:<div className="empty"><div className="empty-icon"><Users size={19}/></div><b>No profiles found</b><span>Try another search.</span></div>}
 </div>;
}
