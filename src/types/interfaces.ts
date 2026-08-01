export interface MessageRecord {
  id: string;
  content?: string;
  sender: "user" | "clippy";
  createdAt: number;
}

export interface ChatRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  preview: string;
}

export interface ChatWithMessages {
  chat: ChatRecord;
  messages: MessageRecord[];
}

export interface LlamaServerChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlamaServerChatRequest {
  requestUUID: string;
  messages: LlamaServerChatMessage[];
  systemPrompt: string;
  topK?: number;
  temperature?: number;
}

export type ChatRecordsState = Record<string, ChatRecord>;

export interface Versions extends NodeJS.ProcessVersions {
  clippy: string;
  electron: string;
  nodeLlamaCpp: string;
  chromium: string;
}

export type NestedRecord<T> = {
  [key: string]: T | NestedRecord<T>;
};

export interface ClippyDebugInfo {
  platform: string;
  arch: string;
  versions: Record<string, string>;
  llamaBinaries: Array<string>;
  llamaBinaryFiles: NestedRecord<number>;
  checks: Record<string, boolean | string>;
  gpu: unknown;
}
