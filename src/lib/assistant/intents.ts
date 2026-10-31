import { KNOWLEDGE } from './knowledge';
import type { AssistantIntent } from './types';

export const normalizeQuestion=(input:string)=>input.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s/-]/g,' ').replace(/\bpls\b/g,'please').replace(/\bcomplnts?\b/g,'complaints').replace(/\bcompliants?\b/g,'complaints').replace(/\boverdue\b/g,'overdue').replace(/\boverdude\b/g,'overdue').replace(/\boverdu\b/g,'overdue').replace(/\btransfre\b/g,'transfer').replace(/\bregulaton\b/g,'regulation').replace(/\s+/g,' ').trim();
const tokens=(value:string)=>normalizeQuestion(value).split(/\s+/).filter(Boolean);
function editDistanceAtMostOne(left:string,right:string){if(Math.abs(left.length-right.length)>1)return false;let i=0,j=0,diff=0;while(i<left.length&&j<right.length){if(left[i]===right[j]){i++;j++;continue}if(++diff>1)return false;if(left.length>right.length)i++;else if(right.length>left.length)j++;else{i++;j++}}return diff+(i<left.length||j<right.length?1:0)<=1}
function hasTerm(input:string,phrase:string){const normalized=normalizeQuestion(phrase);if(!normalized)return false;if(normalized.includes(' '))return input.includes(normalized);const words=tokens(input);return words.includes(normalized)||normalized.length>=5&&words.some(word=>word.length>=5&&editDistanceAtMostOne(word,normalized))}
const INTENT_PRIORITY:AssistantIntent[]=['overdue','urgent','case_detail','case_count','case_list','bureau_workload','matching','relationships','overlap','bureau_info','transfer','escalation','assignment','deadlines','statuses','registry','institutions','aicte_id','reports','coordination','authentication','security','roles','workflow','dashboard','overview','help','greeting'];
const EXPLICIT:Partial<Record<AssistantIntent,string[]>>={
 greeting:['hi','hello','hey','bro','good morning','good evening','good afternoon'],
 overview:['what is this system','what is this portal','what does this portal do'],
 case_count:['how many','count','number of','total complaints','total cases'],
 case_list:['show cases','list cases','which cases','which complaints','find cases','get cases'],
 case_detail:['explain why','why is this','next action for','details for','what about case','case details','case history'],
 bureau_workload:['bureau workload','workload by bureau','which bureau has','bureau with highest'],
 overdue:['overdue','past due','late complaint','deadline passed'],
 urgent:['urgent','critical','immediate attention','needs attention','immediate action'],
 matching:['semantic matching','similarity score','text similarity','match score','casegraph'],
 overlap:['overlap detection','overlap monitoring','potential overlap','what does overlap mean','explain overlap','overlap'],
 relationships:['relationship status','pending relationship','match decision'],
 transfer:['transfer case','transfer complaint','move case','move a complaint','send to another bureau'],
 bureau_info:['pgrc','regulation bureau','what about rb','what about pgrc','rb'],
 assignment:['assign','assignment','assign a complaint','assign this complaint','responsible officer'],
 escalation:['escalate','escalation','raise to a higher level','raise this matter'],
 deadlines:['expected disposal','next action','deadline','due date'],
 statuses:['status','complaint status','pending','disposed','under process','transferred','escalating'],
 reports:['report','analytics','csv','export','csv download'],
 coordination:['coordination workspace','coordinate'],
 authentication:['password','sign in','login','registration','create account','sign out','log out','logout'],
 security:['security','row level security','rls','confidential','confidential cases'],
 roles:['role','permission','access level','administrator','officer'],
 dashboard:['dashboard','dashboard counts'],
 registry:['registry','complaint registry','search','filter','search for a case','case register','complaint'],
 institutions:['institution','college','university','institution profile'],
 aicte_id:['aicte permanent id','permanent id','apid'],
 workflow:['workflow','history','timeline','action history'],
 help:['where do i find','navigate','menu','website help'],
};
export function classifyIntent(input:string):{intent:AssistantIntent;confidence:number;alternatives:AssistantIntent[]}{
 const text=normalizeQuestion(input);if(!text)return{intent:'unknown',confidence:0,alternatives:[]};
 const scored=new Map<AssistantIntent,number>();
 for(const intent of INTENT_PRIORITY){for(const phrase of EXPLICIT[intent]||[]){if(hasTerm(text,phrase))scored.set(intent,Math.max(scored.get(intent)||0,phrase.includes(' ')?4:3))}}
 for(const entry of KNOWLEDGE){let score=scored.get(entry.intent)||0;for(const word of entry.keywords)if(hasTerm(text,word))score=Math.max(score,Math.min(3,score+1));for(const phrase of entry.synonyms)if(hasTerm(text,phrase))score=Math.max(score,phrase.includes(' ')?4:3);for(const example of entry.examples)if(normalizeQuestion(example)===text)score=Math.max(score,5);scored.set(entry.intent,score)}
 // Live-data phrasing wins over static guidance when the user asks for actual case records/counts.
 if(/\b(show|list|count|how many|which|find)\b/.test(text)&&/\b(case|cases|complaint|complaints|overdue|pending|urgent|workload|bureau)\b/.test(text)){const intent=/\bhow many\b|\bcount\b|\bnumber of\b/.test(text)?'case_count':/\bworkload\b|\bbureau with (the )?highest\b/.test(text)?'bureau_workload':/\boverdue\b|\bpast due\b/.test(text)?'overdue':/\burgent\b|\bcritical\b|\battention\b|\bimmediate action\b/.test(text)?'urgent':'case_list';scored.set(intent,6)}
 if(text.includes('high priority')&&/\b(show|list|which|find)\b/.test(text))scored.set('urgent',6);
 const ranked=[...scored].filter(([,score])=>score>0).sort((a,b)=>b[1]-a[1]||INTENT_PRIORITY.indexOf(a[0])-INTENT_PRIORITY.indexOf(b[0]));
 if(!ranked.length)return{intent:'unknown',confidence:0,alternatives:[]};
 const [intent,score]=ranked[0];const second=ranked[1]?.[1]||0;const confidence=Math.min(1,score/6);if(score<2||score-second<1)return{intent:'unknown',confidence,alternatives:ranked.slice(0,3).map(([candidate])=>candidate)};
 return{intent,confidence,alternatives:ranked.slice(1,4).map(([candidate])=>candidate)};
}
export function extractStatus(text:string){const value=normalizeQuestion(text);if(/\bunresolved\b|\bawaiting action\b/.test(value))return 'Pending';if(/\bin progress\b|\bbeing handled\b/.test(value))return 'Under Process';if(/\bclosed\b|\bcomplete\b/.test(value))return 'Disposed';return ['Pending','Under Process','Disposed','Transferred','Escalated'].find(status=>hasTerm(value,status.toLowerCase()))}
export function extractBureau(text:string,knownBureaus:string[]=[]){const value=normalizeQuestion(text);const known=knownBureaus.find(name=>hasTerm(value,name));if(known)return known;if(/\bpgrc\b|public grievance redressal/.test(value))return 'PGRC';if(/\bregulation bureau\b|\brb\b/.test(value))return 'RB';return undefined}
export function extractCaseNumber(text:string,knownCaseNumbers:string[]=[]){const value=normalizeQuestion(text);return knownCaseNumbers.find(number=>hasTerm(value,number))}
export { editDistanceAtMostOne };
