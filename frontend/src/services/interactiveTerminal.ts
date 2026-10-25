import { ExecutionResult, ExecutionStatus } from '../types/execution';

export type TerminalEvent = {
  sessionId: string; roomId: string; seq: number; type: 'status' | 'output' | 'finished';
  status?: ExecutionStatus; channel?: 'stdout' | 'stderr'; text?: string;
  language?: string; error?: string; exitCode?: number; executionTimeMs?: number; canControl?: boolean;
};
export function applyTerminalEvent(previous: ExecutionResult | null, event: TerminalEvent, roomId: string): ExecutionResult | null {
  if (event.roomId !== roomId || !Number.isSafeInteger(event.seq)) return previous;
  if (event.type === 'status' && event.status === 'queued' && event.seq === 0 && event.sessionId !== previous?.sessionId) {
    return { sessionId: event.sessionId, runId: event.sessionId, roomId, language: event.language,
      seq: 0, status: 'queued', stdout: '', stderr: '', segments: [], inputClosed: false };
  }
  if (!previous || event.sessionId !== previous.sessionId || event.seq <= (previous.seq ?? -1)) return previous;
  if (['completed', 'failed', 'timeout', 'cancelled'].includes(previous.status)) return previous;
  const next = { ...previous, seq: event.seq };
  if (event.type === 'output' && (event.channel === 'stdout' || event.channel === 'stderr') && typeof event.text === 'string') {
    if (event.text.length > 4200 || previous.stdout.length + previous.stderr.length + event.text.length > 132000) return previous;
    next[event.channel] += event.text;
    next.segments = [...(previous.segments || []), { channel: event.channel, text: event.text }].slice(-2048);
  } else if (event.type === 'status' && (event.status === 'starting' || event.status === 'running')) next.status = event.status;
  else if (event.type === 'finished' && event.status && ['completed', 'failed', 'timeout', 'cancelled'].includes(event.status)) {
    Object.assign(next, { status: event.status, inputClosed: true, exitCode: event.exitCode,
      executionTimeMs: event.executionTimeMs, error: event.error });
  }
  return next;
}

export function terminalRequest(socket: any, action: string, payload: object): Promise<any> {
  if (!socket?.connected) return Promise.resolve({ ok: false, error: 'Realtime connection unavailable' });
  return new Promise(resolve => socket.timeout(4000).emit(`terminal:${action}`, payload, (error: Error | null, result: any) => {
    resolve(error ? { ok: false, uncertain: true, error: 'Terminal acknowledgement timed out. Stop this run before retrying.' } : result);
  }));
}
