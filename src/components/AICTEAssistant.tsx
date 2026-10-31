import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, RefreshCw, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import { answerQuestion } from '../lib/assistant/respond';
import type { AssistantMessage, ConversationContext } from '../lib/assistant/types';
import type { CaseRow } from '../lib/supabase';

type Props={open:boolean;onClose:()=>void;userId:string;kind:string;bureauName?:string;cases:CaseRow[];actions:any[];relationships:any[];relationshipCount?:number;dataError?:string;relationshipError?:string};
const welcome='Hello! I can explain portal features and summarize complaint records already available to your signed-in account. What would you like to know?';
function renderText(text:string){return text.split('\n').map((line,index)=>{const bullet=line.startsWith('• ');const content=bullet?line.slice(2):line;const parts=content.split(/(\*\*[^*]+\*\*)/g);const formatted=parts.map((part,i)=>part.startsWith('**')&&part.endsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part);return bullet?<div className="assistant-list-item" key={index}><span aria-hidden="true">•</span><span>{formatted}</span></div>:<p key={index}>{formatted}</p>})}

export default function AICTEAssistant(props:Props){
 const {open,onClose,userId,kind,bureauName,cases,actions,relationships,relationshipCount,dataError,relationshipError}=props;
 const [messages,setMessages]=useState<AssistantMessage[]>([{from:'assistant',text:welcome}]);
 const [input,setInput]=useState('');const [busy,setBusy]=useState(false);
 const contextRef=useRef<ConversationContext>({previousCaseNumbers:[]});const inputRef=useRef<HTMLInputElement|null>(null);const endRef=useRef<HTMLDivElement|null>(null);const timerRef=useRef<number|null>(null);
 const authorizedIds=useMemo(()=>new Set(cases.map(row=>row.id)),[cases]);
 const roleActions=useMemo(()=>actions.filter(action=>authorizedIds.has(action.complaint_id)),[actions,authorizedIds]);
 const suggestions=useMemo(()=>{
  const common=['How many pending complaints?','Show overdue complaints','What cases need urgent attention?','Explain overlap detection','How do I transfer a complaint?'];
  if(kind==='bureau'&&bureauName)return [`Show ${bureauName} workload`,...common];
  if(kind==='administrator')return ['Show bureau workload',...common];
  return common;
 },[kind,bureauName]);
 useEffect(()=>{endRef.current?.scrollIntoView({behavior:'smooth',block:'end'})},[messages,busy]);
 useEffect(()=>{if(open)window.setTimeout(()=>inputRef.current?.focus(),80)},[open]);
 useEffect(()=>()=>{if(timerRef.current!==null)window.clearTimeout(timerRef.current)},[]);
 const clear=()=>{if(timerRef.current!==null)window.clearTimeout(timerRef.current);timerRef.current=null;setBusy(false);contextRef.current={previousCaseNumbers:[]};setInput('');setMessages([{from:'assistant',text:'Conversation cleared. I do not retain chat messages in the browser after sign-out. Ask me about portal guidance or authorized complaint data.'}])};
 const send=(question=input)=>{
  const text=question.trim();if(!text||busy)return;
  setInput('');setMessages(current=>[...current,{from:'user',text}]);setBusy(true);
  timerRef.current=window.setTimeout(()=>{
   const result=answerQuestion(text,{cases,actions:roleActions,relationships,relationshipCount,dataError,relationshipError,kind,bureauName},contextRef.current);
   timerRef.current=null;
   if(result.text==='__CLEAR_CONVERSATION__'){clear();return}
   contextRef.current=result.context;
   setMessages(current=>[...current,{from:'assistant',text:result.text,caseNumbers:result.context.previousCaseNumbers}]);setBusy(false);
  },220);
 };
 return <div className={`chat-panel ${open?'is-open':''}`} role="dialog" aria-label="AICTE Assistant" aria-modal="false" aria-hidden={!open} inert={!open}>
  <header><div className="chat-avatar"><Sparkles size={17}/></div><div><b>AICTE Assistant</b><small>Local, rule-based help · No AI model</small></div><button type="button" className="icon-btn chat-clear" aria-label="Clear conversation" title="Clear conversation" onClick={clear}><RefreshCw size={15}/></button><button type="button" className="icon-btn" aria-label="Close assistant" onClick={onClose}><X size={17}/></button></header>
  <div className="assistant-data-note"><ShieldCheck size={13}/><span>Case answers use records loaded for your signed-in role. Supabase RLS remains in force.</span></div>
  <div className="chat-messages" aria-live="polite" aria-relevant="additions text">
   {messages.map((message,index)=><div className={`bubble ${message.from}`} key={`${userId}-${index}`}>{renderText(message.text)}</div>)}
   {busy&&<div className="bubble assistant typing-indicator" role="status" aria-label="Assistant is preparing a response"><i/><i/><i/></div>}
   {messages.length===1&&<div className="suggestions" aria-label="Suggested questions">{suggestions.map(question=><button type="button" key={question} disabled={busy} onClick={()=>send(question)}>{question}</button>)}</div>}
   <div ref={endRef}/>
  </div>
  <form className="chat-input" onSubmit={event=>{event.preventDefault();send()}}><input ref={inputRef} aria-label="Ask the AICTE Assistant" placeholder="Ask about cases or portal features…" value={input} onChange={event=>setInput(event.target.value)} disabled={busy}/><button type="submit" aria-label="Send message" disabled={busy||!input.trim()}><Send size={16}/></button></form>
  <div className="assistant-status"><MessageSquare size={12}/><span>Answers are deterministic; live data may be as current as the portal’s last refresh.</span></div>
 </div>
}
