import type { UIMessage } from "ai";

export type AgentType = "coach" | "build";
export type MemoryLevel = "none" | "limited" | "complete";

export type AiPermissions = {
  profile: boolean;
  nutrition: boolean;
  sport: boolean;
  sleep: boolean;
  water: boolean;
  habits: boolean;
  calendar: boolean;
  work: boolean;
  finance: boolean;
};

export type AiPreferences = {
  memory_level: MemoryLevel;
  permissions: AiPermissions;
  confirm_actions: boolean;
};

export type AiConversation = {
  id: string;
  agent_type: AgentType;
  title: string;
  is_starred: boolean;
  is_archived: boolean;
  is_ephemeral: boolean;
  updated_at: string;
};

export type AiConversationBundle = {
  conversation: AiConversation;
  messages: UIMessage[];
};

export const DEFAULT_AI_PERMISSIONS: AiPermissions = {
  profile: true,
  nutrition: true,
  sport: true,
  sleep: false,
  water: false,
  habits: false,
  calendar: false,
  work: false,
  finance: false,
};