import { isApproaching, isPastNextAction } from '../dashboard';
import type { CaseRow } from '../supabase';
import { classifyIntent, extractBureau, extractCaseNumber, extractStatus, normalizeQuestion } from './intents';
import { KNOWLEDGE } from './knowledge';
import type { AssistantIntent, ConversationContext } from './types';

export type AssistantData = {
  cases: CaseRow[];
  actions: any[];
  relationships: any[];
  relationshipCount?: number;
  dataError?: string;
  relationshipError?: string;
  kind: string;
  bureauName?: string;
};

const dateText=(value?:string|null)=>value?new Date(value).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'not recorded';
const latestAction=(row:CaseRow,actions:any[])=>actions.filter(action=>action.complaint_id===row.id).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
const matchesBureau=(name:string|undefined,filter:string)=>{const value=normalizeQuestion(name||''),requested=normalizeQuestion(filter);if(requested==='pgrc')return value.includes('pgrc')||value.includes('public grievance')||value.includes('grievance');if(requested==='rb')return value.includes('regulation')||value==='rb'||value.startsWith('rb ');return value.includes(requested)||requested.includes(value)};
const caseLabel=(row:CaseRow,actions:any[])=>{
 const action=latestAction(row,actions);
 const expected=row.expected_disposal_at||row.next_action_at;
 return `• ${row.case_number} — ${row.institutions?.name||'Institution not recorded'} | ${row.bureaus?.name||'Bureau not recorded'} | ${row.status} | Expected disposal: ${dateText(row.expected_disposal_at)} | Next action: ${row.next_action_required||'not recorded'}${expected?` (date ${dateText(expected)})`:''} | Last action: ${action?`${action.action_type} on ${dateText(action.created_at)}`:'not recorded'}`;
};
function applyScope(rows:CaseRow[],text:string,context:ConversationContext){
 const status=extractStatus(text)||context.statusFilter;
 const bureau=extractBureau(text,rows.map(row=>row.bureaus?.name||'').filter(Boolean))||context.bureauFilter;
 let filtered=rows;
 if(status)filtered=filtered.filter(row=>normalizeQuestion(row.status)===normalizeQuestion(status));
 if(bureau)filtered=filtered.filter(row=>{
   return matchesBureau(row.bureaus?.name,bureau);
 });
 const followup=/^(only|just|what about|and|those|them|pending ones|transferred ones|disposed ones|under process ones|which one|most urgent|explain|why|show more)\b/.test(normalizeQuestion(text));
 if(context.previousCaseNumbers.length&&followup)filtered=filtered.filter(row=>context.previousCaseNumbers.includes(row.case_number));
 return {rows:filtered,status,bureau};
}
const summaryLine=(rows:CaseRow[])=>`There ${rows.length===1?'is':'are'} ${rows.length} authorized ${rows.length===1?'complaint':'complaints'} in the current result${rows.length===1?'':'s'}.`;

function dynamicResponse(intent:AssistantIntent,text:string,data:AssistantData,context:ConversationContext){
 const scoped=applyScope(data.cases,text,context);let rows=scoped.rows;
 const caseNumber=extractCaseNumber(text,data.cases.map(row=>row.case_number));
 if(intent==='case_detail'){
  if(data.dataError)return {text:`I couldn’t retrieve current complaint data: ${data.dataError}. Refresh the portal and try again before looking up a case.`,caseNumbers:[] as string[]};
  const target=caseNumber?data.cases.find(row=>row.case_number===caseNumber):rows.find(row=>context.previousCaseNumbers.includes(row.case_number));
  if(!target)return {text:'I could not find that case number among the records currently available to your signed-in role. Check the case number or search Complaint Registry.',caseNumbers:[] as string[]};
  const reasons:string[]=[];
  if(isPastNextAction(target))reasons.push(`its recorded next-action or expected-disposal date (${dateText(target.next_action_at||target.expected_disposal_at)}) has passed`);
  if(target.priority)reasons.push(`its stored priority is “${target.priority}”`);
  if(!reasons.length)reasons.push(`its current status is ${target.status}; no overdue date or elevated priority is recorded`);
  return {text:`${caseLabel(target,data.actions)}\nWhy it may need attention: ${reasons.join('; ')}.`,caseNumbers:[target.case_number]};
 }
 if(intent==='overdue')rows=rows.filter(row=>isPastNextAction(row));
 else if(intent==='urgent')rows=rows.filter(row=>isPastNextAction(row)||/urgent|high|critical/i.test(row.priority||'')).sort((a,b)=>Number(isPastNextAction(b))-Number(isPastNextAction(a))||String(a.next_action_at||a.expected_disposal_at||'9999').localeCompare(String(b.next_action_at||b.expected_disposal_at||'9999')));
 else if(intent==='deadlines'){
  const horizon=/\b(this week|next seven|next 7 days)\b/.test(normalizeQuestion(text))?7:/\b(next two weeks|next 14 days)\b/.test(normalizeQuestion(text))?14:null;
  rows=rows.filter(row=>row.status!=='Disposed'&&(isPastNextAction(row)||(horizon!==null&&isApproaching(row,new Date(),horizon))));
 }
 else if(intent==='case_count'){
  if(data.dataError)return {text:`I couldn’t retrieve current complaint data: ${data.dataError}. I can still answer portal-guidance questions. Refresh the portal and try again.`,caseNumbers:[] as string[]};
  if(/\boverdue\b|\bpast due\b/.test(normalizeQuestion(text)))rows=rows.filter(row=>isPastNextAction(row));
  else if(/\burgent\b|\bcritical\b|\battention\b|\bimmediate action\b/.test(normalizeQuestion(text)))rows=rows.filter(row=>isPastNextAction(row)||/urgent|high|critical/i.test(row.priority||''));
  const countByStatus=new Map<string,number>();for(const row of rows)countByStatus.set(row.status,(countByStatus.get(row.status)||0)+1);
  return {text:`${summaryLine(rows)}${scoped.bureau?` Bureau filter: ${scoped.bureau}.`:''}${scoped.status?` Status filter: ${scoped.status}.`:''}\n${[...countByStatus].sort((a,b)=>a[0].localeCompare(b[0])).map(([status,count])=>`• ${status}: ${count}`).join('\n')||'No matching status records.'}`,caseNumbers:rows.slice(0,100).map(row=>row.case_number)};
 }
 else if(intent==='bureau_workload'){
  if(data.dataError)return {text:`I couldn’t retrieve complaint data: ${data.dataError}. Please retry after refreshing the portal.`,caseNumbers:[] as string[]};
  const counts=new Map<string,{total:number;pending:number}>();for(const row of rows){const name=row.bureaus?.name||'Bureau not recorded';const item=counts.get(name)||{total:0,pending:0};item.total++;if(row.status==='Pending')item.pending++;counts.set(name,item)}
  const ordered=[...counts].sort((a,b)=>b[1].pending-a[1].pending||b[1].total-a[1].total);
  return {text:ordered.length?`Bureau workload from ${rows.length} authorized loaded records:\n${ordered.map(([name,value])=>`• ${name}: ${value.total} total, ${value.pending} pending`).join('\n')}`:'No authorized complaints are currently available for this workload view.',caseNumbers:rows.map(row=>row.case_number)};
 }
 if(['case_list','overdue','urgent','deadlines'].includes(intent)){
  if(data.dataError)return {text:`I couldn’t retrieve complaint data: ${data.dataError}. Please retry after refreshing the portal.`,caseNumbers:[] as string[]};
  const question=normalizeQuestion(text);
  if(scoped.bureau&&!rows.length&&context.previousCaseNumbers.length&&/\b(only|just)\b/.test(question))return {text:`None of the previous results match ${scoped.bureau}.`,caseNumbers:[]};
  const title=intent==='overdue'?'Overdue cases':intent==='urgent'?'Cases needing attention':intent==='deadlines'?'Cases with recorded deadline activity':'Authorized complaint records';
  if(!rows.length)return {text:`${title}: no matching records are present in the data currently loaded for your role.${scoped.bureau?` Bureau: ${scoped.bureau}.`:''}${scoped.status?` Status: ${scoped.status}.`:''}`,caseNumbers:[]};
  const shown=rows.slice(0,6);return {text:`${title} — ${rows.length} matching ${rows.length===1?'case':'cases'}${scoped.bureau?` in ${scoped.bureau}`:''}${scoped.status?` with status ${scoped.status}`:''}:\n${shown.map(row=>caseLabel(row,data.actions)).join('\n')}${rows.length>shown.length?`\nShowing the first 6 of ${rows.length}. Narrow by Bureau/Cell or status to focus the list.`:''}`,caseNumbers:rows.map(row=>row.case_number)};
 }
 if(intent==='relationships'||intent==='overlap'){
  if(!/\b(how many|count|show|list|which cases|which complaints)\b/.test(normalizeQuestion(text))){const entry=KNOWLEDGE.find(item=>item.intent===intent);if(entry)return {text:`${entry.answer}\nSection: ${entry.section}.`,caseNumbers:[] as string[]}}
  if(data.relationshipCount===undefined)return {text:data.relationshipError?`The relationship summary is unavailable: ${data.relationshipError}. Retry the dashboard summary or open Overlap Monitoring.`:'Open Overlap Monitoring to load the authorized relationship queue. Suggestions require human review and do not merge cases automatically.',caseNumbers:[] as string[]};
  if(data.relationshipError)return {text:`The relationship summary is unavailable: ${data.relationshipError}. Open the dashboard and use Retry, or open Overlap Monitoring.`,caseNumbers:[] as string[]};
  const matches=data.relationships.filter(item=>{const left=data.cases.find(row=>row.id===item.source_case_id),right=data.cases.find(row=>row.id===item.target_case_id);return !scoped.bureau||[left?.bureaus?.name,right?.bureaus?.name].some(name=>matchesBureau(name,scoped.bureau!))});
  return {text:`There ${data.relationshipCount===1?'is':'are'} ${data.relationshipCount} pending relationship suggestion${data.relationshipCount===1?'':'s'} in the authorized dashboard summary.${matches.length?`\nRecent loaded suggestions:\n${matches.slice(0,5).map(item=>{const left=data.cases.find(row=>row.id===item.source_case_id),right=data.cases.find(row=>row.id===item.target_case_id);return `• ${left?.case_number||'Authorized case'} ↔ ${right?.case_number||'authorized case'} (${item.review_status||'pending'})`}).join('\n')}`:''}\nThese are review suggestions, not confirmed duplicates.`,caseNumbers:[]};
 }
  const bureau=extractBureau(text);
  const entry=intent==='bureau_info'?KNOWLEDGE.find(item=>item.intent===intent&&(bureau==='PGRC'?item.topic==='Public Grievance Redressal Cell':item.topic==='Regulation Bureau')):KNOWLEDGE.find(item=>item.intent===intent);
 if(entry)return {text:`${entry.answer}\nSection: ${entry.section}.`,caseNumbers:[] as string[]};
 if(intent==='greeting')return {text:['Hello! Ask me about portal navigation, workflow, deadlines, or your authorized complaint data.','Hi! I can explain the portal or summarize the complaint records available to your role.','Hello. Try asking for pending, overdue, urgent, or bureau workload details.'][Math.abs(text.length)%3],caseNumbers:[] as string[]};
 return {text:'Which part should I explain: portal navigation, complaint workflow, deadlines, overlap review, reports, or authorized case data?',caseNumbers:[] as string[]};
}

export function answerQuestion(input:string,data:AssistantData,context:ConversationContext){
 const text=normalizeQuestion(input);
 if(/\b(clear|reset)\b.*\b(chat|conversation|history)\b/.test(text))return {text:'__CLEAR_CONVERSATION__',context:{previousCaseNumbers:[]} as ConversationContext};
 if(/password|secret|token|credential|api key|personal information|complainant|prompt injection|ignore previous|arbitrary sql|select \*|drop table/.test(text))return {text:'I can explain portal features and summarize complaint data available through your signed-in account. I cannot disclose credentials or private account information, run arbitrary SQL, change permissions, or bypass access controls.',context};
 let intent:AssistantIntent;
 const bureau=extractBureau(text,data.cases.map(row=>row.bureaus?.name||'').filter(Boolean));
 const status=extractStatus(text);
 if(context.previousCaseNumbers.length&&/^(only|just|what about|and|those|them|pending ones|which one|explain why)\b/.test(text)&&bureau)intent='case_list';
 else if(context.previousCaseNumbers.length&&/^(which one is most urgent|most urgent|which is most urgent|explain why|why is this|what about this case)\b/.test(text))intent=/\bwhy\b|\bexplain\b/.test(text)?'case_detail':'urgent';
 else if(context.previousCaseNumbers.length&&/^(pending ones|transferred ones|disposed ones|under process ones)$/.test(text))intent='case_list';
 else if(/\b(?:case|complaint)\b.{0,28}\b[A-Z0-9]+[-/][A-Z0-9-]+\b/i.test(input)&&/\b(why|explain|details|history|next action|what happened)\b/.test(text))intent='case_detail';
 else intent=classifyIntent(text).intent;
 const result=dynamicResponse(intent,input,data,context);
 const next:ConversationContext={previousIntent:intent,previousCaseNumbers:result.caseNumbers||[],bureauFilter:bureau||context.bureauFilter,statusFilter:status||context.statusFilter};
 return {text:result.text,context:next};
}
