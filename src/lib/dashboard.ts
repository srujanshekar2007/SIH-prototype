import type { CaseRow } from './supabase';

export type DashboardKind = 'administrator'|'bureau'|'officer'|'oversight'|'denied';
export function dashboardKind(profile:any):DashboardKind {
  if(!profile||!profile.active)return 'denied';
  if(profile.is_admin)return 'administrator';
  if(profile.role==='aicte_official')return 'oversight';
  if(profile.role==='pgrc_officer'||profile.role==='rb_officer'||profile.role==='bureau_officer'){const legacyScope=profile.can_manage_bureau==null;return profile.can_manage_bureau===true||legacyScope?'bureau':'officer';}
  return 'denied';
}
export function casesForDashboard(rows:CaseRow[],kind:DashboardKind,userId:string,profile:any){
  if(kind==='officer')return rows.filter(c=>c.assigned_officer_id===userId);
  if(kind==='bureau')return rows.filter(c=>c.bureau_id===profile.bureau_id||c.assigned_officer_id===userId);
  if(kind==='administrator'||kind==='oversight')return rows;
  return [];
}
function isDateOnly(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)}
function localDateKey(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function dateOnlyWithinWindow(value:string,now:Date,windowDays:number){
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const due=new Date(`${value}T00:00:00`);
  const end=new Date(today);end.setDate(end.getDate()+windowDays);
  return !Number.isNaN(due.valueOf())&&due>=today&&due<=end;
}
export const isPastNextAction=(c:CaseRow,now=new Date())=>Boolean(c.status!=='Disposed'&&[c.next_action_at,c.expected_disposal_at].some(value=>{
  if(!value)return false;
  if(isDateOnly(value))return value<localDateKey(now);
  const timestamp=new Date(value).valueOf();return Number.isFinite(timestamp)&&timestamp<now.valueOf();
}));
export const isApproaching=(c:CaseRow,now=new Date(),windowDays?:number)=>windowDays!==undefined&&windowDays>=0&&Boolean(c.status!=='Disposed'&&[c.next_action_at,c.expected_disposal_at].some(value=>{
  if(!value)return false;
  if(isDateOnly(value))return dateOnlyWithinWindow(value,now,windowDays);
  const timestamp=new Date(value).valueOf();return Number.isFinite(timestamp)&&timestamp>=now.valueOf()&&timestamp<=now.valueOf()+windowDays*86400000;
}));
export function filterReportCases(rows:CaseRow[],filters:{bureauId?:string;fromDate?:string;toDate?:string}){
  return rows.filter(c=>(!filters.bureauId||filters.bureauId==='all'||c.bureau_id===filters.bureauId)&&(!filters.fromDate||c.received_at.slice(0,10)>=filters.fromDate)&&(!filters.toDate||c.received_at.slice(0,10)<=filters.toDate));
}
export function summarizeReportCases(rows:CaseRow[],now=new Date()){
  const disposed=rows.filter(c=>c.status==='Disposed').length;
  return {total:rows.length,pending:rows.filter(c=>c.status==='Pending').length,underProcess:rows.filter(c=>c.status==='Under Process').length,disposed,overdue:rows.filter(c=>isPastNextAction(c,now)).length,disposalRate:rows.length?Math.round(disposed*100/rows.length):null};
}
export function makeChartData(rows:CaseRow[],actions:any[]=[],now=new Date()){
  const statuses:Record<string,number>={},bureau:Record<string,number>={},intake:Record<string,number>={},disposed:Record<string,number>={},ageing:Record<string,number>={'0–7 days':0,'8–30 days':0,'31–90 days':0,'90+ days':0};
  const monthKey=(s:string)=>{const d=new Date(s);return Number.isNaN(d.valueOf())?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`};
  for(const c of rows){statuses[c.status]=(statuses[c.status]||0)+1;const unit=c.bureaus?.name||'Unassigned';bureau[unit]=(bureau[unit]||0)+1;const key=monthKey(c.received_at);if(key)intake[key]=(intake[key]||0)+1;if(c.status!=='Disposed'){const days=Math.max(0,Math.floor((now.getTime()-new Date(c.received_at).getTime())/86400000));ageing[days<=7?'0–7 days':days<=30?'8–30 days':days<=90?'31–90 days':'90+ days']++;}}
  for(const action of actions){if(action.status_after==='Disposed'){const key=monthKey(action.created_at);if(key)disposed[key]=(disposed[key]||0)+1;}}
  const months=[...new Set([...Object.keys(intake),...Object.keys(disposed)])].sort();
  const trend=months.map(key=>({month:key,name:new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN',{month:'short',year:'2-digit'}),received:intake[key]||0,disposed:disposed[key]||0}));
  return {statuses:Object.entries(statuses).map(([name,value])=>({name,value})),bureau:Object.entries(bureau).map(([name,value])=>({name,value})),intake:months.map(key=>({name:new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN',{month:'short',year:'2-digit'}),value:intake[key]||0})),trend,ageing:Object.entries(ageing).map(([name,value])=>({name,value}))};
}

export function buildDashboardCards(kind:DashboardKind,rows:CaseRow[],overlaps:any,coordination:any[],transfers:any,actions:any[],profile:any,now=new Date()):[string,number|string,string,string][]{
  const summaryLoading=overlaps==='loading';
  const summaryRefreshing=overlaps==='refreshing';
  const relationshipSummaryAvailable=Number.isSafeInteger(overlaps?.pending_count)&&overlaps.pending_count>=0
    &&Array.isArray(overlaps?.case_ids)&&Array.isArray(overlaps?.by_bureau)&&Array.isArray(overlaps?.recent);
  const relationshipCount=summaryLoading?'Loading…':summaryRefreshing?'Refreshing…':relationshipSummaryAvailable?overlaps.pending_count:'Unavailable';
  const relationshipDescription=summaryLoading?'Loading the authorized relationship summary':summaryRefreshing?'Refreshing the authorized relationship summary':relationshipSummaryAvailable?'Awaiting human review':'Relationship summary unavailable; retry data';
  const relationshipCaseIds=Array.isArray(overlaps)
    ?overlaps.flatMap((r:any)=>[r.source_case_id,r.target_case_id])
    :(overlaps?.case_ids||[]);
  const count=(s:string)=>rows.filter(c=>c.status===s).length;
  const overdue=rows.filter(c=>isPastNextAction(c,now)).length;
  const openCoord=coordination.filter(r=>r.status==='open').length;
  const unassigned=rows.filter(c=>!c.assigned_officer_id).length;
  const inBureau=Array.isArray(transfers)?transfers.filter(t=>t.to_bureau_id===profile?.bureau_id).length:transfers?.inBureau;
  const outBureau=Array.isArray(transfers)?transfers.filter(t=>t.from_bureau_id===profile?.bureau_id).length:transfers?.outBureau;
  const recent=actions.filter(a=>a.actor_id===profile?.id&&new Date(a.created_at)>=new Date(now.getTime()-7*86400000)).length;
  const recentAssignmentIds=new Set(actions.filter(a=>a.action_type==='assignment'&&new Date(a.created_at)>=new Date(now.getTime()-7*86400000)).map(a=>a.complaint_id));
  const newlyAssigned=rows.filter(c=>c.assigned_officer_id===profile?.id&&recentAssignmentIds.has(c.id)).length;
  const attentionIds=new Set<string>([...rows.filter(c=>isPastNextAction(c,now)||!c.assigned_officer_id).map(c=>c.id),...coordination.filter(r=>r.status==='open').map(r=>r.complaint_id),...relationshipCaseIds].filter(Boolean));
  const attentionCount=summaryLoading?'Loading…':summaryRefreshing?'Refreshing…':relationshipSummaryAvailable?attentionIds.size:'Unavailable';
  const disposedByOfficer=actions.filter(a=>a.actor_id===profile?.id&&a.status_after==='Disposed').length;
  const common:any={
    administrator:[['Total complaints',rows.length,'All records authorized for your role','all'],['Unassigned',unassigned,'Awaiting case assignment','Unassigned'],['Pending',count('Pending'),'Awaiting action','Pending'],['Under process',count('Under Process'),'Currently being handled','Under Process'],['Coordination awaiting response',openCoord,'Open inter-unit requests','awaiting'],['Disposed',count('Disposed'),'Recorded as disposed','Disposed'],['Transferred',count('Transferred'),'Current status: transferred','Transferred'],['Escalated',count('Escalated'),'Current status: escalated','Escalated'],['Past recorded deadline',overdue,'Next-action or expected-disposal date has passed','Overdue'],['Potential relationships',relationshipCount,relationshipDescription,'overlap'],['Approaching deadlines','Not configured','No approaching-deadline window is configured','deadline_config'],['Institutions represented',new Set(rows.map(c=>c.institution_id)).size,'In authorized complaint records','institutions'],['Cases requiring attention',attentionCount,relationshipSummaryAvailable?'Overdue, unassigned, overlap, or open coordination':'Overlap summary unavailable; retry data','attention']],
    oversight:[['Total complaints',rows.length,'Authorized organization-wide view','all'],['Pending',count('Pending'),'Awaiting action','Pending'],['Under process',count('Under Process'),'Currently being handled','Under Process'],['Coordination awaiting response',openCoord,'Open inter-unit requests','awaiting'],['Disposed',count('Disposed'),'Recorded as disposed','Disposed'],['Transferred',count('Transferred'),'Current status: transferred','Transferred'],['Escalated',count('Escalated'),'Current status: escalated','Escalated'],['Past recorded deadline',overdue,'Next-action or expected-disposal date has passed','Overdue'],['Potential relationships',relationshipCount,relationshipDescription,'overlap'],['Approaching deadlines','Not configured','No approaching-deadline window is configured','deadline_config'],['Institutions represented',new Set(rows.map(c=>c.institution_id)).size,'In authorized complaint records','institutions']],
    bureau:[['Bureau cases',rows.length,'Cases in your authorized Bureau/Cell scope','all'],['Unassigned',unassigned,'Awaiting case assignment','Unassigned'],['Pending',count('Pending'),'Awaiting action','Pending'],['Under process',count('Under Process'),'Currently being handled','Under Process'],['Coordination awaiting response',openCoord,'Open inter-unit requests','awaiting'],['Disposed',count('Disposed'),'Recorded as disposed','Disposed'],['Transferred in',inBureau??'Unavailable',inBureau===undefined?'Transfer summary unavailable; retry data':'Recorded transfers to this Bureau/Cell','transferred_in'],['Transferred out',outBureau??'Unavailable',outBureau===undefined?'Transfer summary unavailable; retry data':'Recorded transfers from this Bureau/Cell','transferred_out'],['Escalated',count('Escalated'),'Current status: escalated','Escalated'],['Past recorded deadline',overdue,'Next-action or expected-disposal date has passed','Overdue'],['Potential relationships',relationshipCount,relationshipDescription,'overlap'],['Approaching deadlines','Not configured','No approaching-deadline window is configured','deadline_config']],
    officer:[['Assigned cases',rows.length,'Only cases assigned to you','all'],['Newly assigned',newlyAssigned,'Cases with an assignment action in the last 7 days that are currently assigned to you','recent'],['Requiring action',count('Pending'),'Pending assigned cases','Pending'],['Under process',count('Under Process'),'Currently being handled','Under Process'],['Coordination awaiting response',openCoord,'Open requests on your assigned cases','awaiting'],['Approaching deadline','Not configured','No approaching-deadline window is configured','deadline_config'],['Past recorded deadline',overdue,'Next-action or expected-disposal date has passed','Overdue'],['Escalated',count('Escalated'),'Assigned cases currently escalated','Escalated'],['Recent updates',recent,'Your recorded actions in the last 7 days','recent'],['Disposed by you',disposedByOfficer,'Disposals in your recorded action history','disposed_by_you']]
  };
  return common[kind]||[];
}
