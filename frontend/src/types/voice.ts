export interface VoiceTokenResponse {
  ok: boolean;
  token?: string;
  url?: string;
  roomName?: string;
  identity?: string;
  expiresIn?: number;
  error?: string;
}
