export type AssistantIntent =
  | 'greeting' | 'help' | 'overview' | 'dashboard' | 'registry' | 'institutions'
  | 'aicte_id' | 'statuses' | 'workflow' | 'assignment' | 'bureau_info' | 'transfer' | 'escalation'
  | 'deadlines' | 'overdue' | 'urgent' | 'overlap' | 'matching' | 'relationships'
  | 'reports' | 'coordination' | 'authentication' | 'roles' | 'security'
  | 'case_count' | 'case_list' | 'case_detail' | 'bureau_workload' | 'unknown';

export type KnowledgeEntry = {
  topic: string;
  intent: AssistantIntent;
  keywords: string[];
  synonyms: string[];
  examples: string[];
  answer: string;
  section: string;
  related: string[];
};

export type ConversationContext = {
  previousIntent?: AssistantIntent;
  previousCaseNumbers: string[];
  bureauFilter?: string;
  statusFilter?: string;
};

export type AssistantMessage = { from: 'assistant' | 'user'; text: string; caseNumbers?: string[] };
