export interface ChatSender {
  id: string;
  username: string;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  content: string;
  sender: ChatSender;
  timestamp: string;
}

export interface ChatHistoryResponse {
  ok: boolean;
  messages?: ChatMessage[];
  nextCursor?: string | null;
  error?: string;
}

export interface ChatSendAck {
  ok: boolean;
  error?: string;
}
