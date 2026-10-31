import { answerQuestion } from './assistant/respond';

/** Compatibility entry point for older callers; the UI uses AICTEAssistant directly. */
export function faq(question:string){
  const text=answerQuestion(question,{cases:[],actions:[],relationships:[],kind:'guidance'}, {previousCaseNumbers:[]}).text;
  return text==='__CLEAR_CONVERSATION__'?'Conversation cleared. Ask about portal guidance or authorized complaint data.':text;
}
