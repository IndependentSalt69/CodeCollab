import { useEffect, useRef, useState } from 'react';
import { SOCKET_EVENTS } from '../../../../realtime/client/events';
import { getRoomMessages } from '../../services/roomService';

const MAX_MESSAGE_LENGTH = 2000;

// Live broadcasts carry a few extra fields; keep only what the panel renders.
function toChatMessage(payload) {
  return {
    id: String(payload.id),
    roomId: payload.roomId,
    content: payload.content ?? payload.text ?? '',
    sender: {
      id: String(payload.sender?.id ?? ''),
      username: payload.sender?.username || 'Unknown',
    },
    timestamp: payload.timestamp,
  };
}

function mergeMessages(existing, incoming) {
  const byId = new Map(existing.map((m) => [m.id, m]));
  incoming.forEach((m) => byId.set(m.id, m));
  return Array.from(byId.values()).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Room chat: loads saved history once the socket has joined the room and shows live messages.
 * Props: socket (connected socket or null), roomId, token, currentUserId, isJoined.
 */
export const ChatPanel = ({ socket, roomId, token, currentUserId, isJoined }) => {
  const [messages, setMessages] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef(null);
  const stickToBottomRef = useRef(true);

  // Load the latest page of history once the socket has joined the room (and again after reconnects)
  useEffect(() => {
    if (!roomId || !isJoined) return;
    let cancelled = false;

    setIsLoading(true);
    getRoomMessages(roomId, token).then((res) => {
      if (cancelled) return;
      setIsLoading(false);
      if (res.ok && res.messages) {
        stickToBottomRef.current = true;
        setMessages((prev) => mergeMessages(prev, res.messages));
        setNextCursor(res.nextCursor ?? null);
        setError(null);
      } else {
        setError(res.error || 'Failed to load chat history');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [roomId, token, isJoined]);

  // Reset when switching rooms
  useEffect(() => {
    setMessages([]);
    setNextCursor(null);
    setDraft('');
    setError(null);
  }, [roomId]);

  // Live messages
  useEffect(() => {
    if (!socket) return;

    const handleReceived = (payload) => {
      if (!payload?.id || payload.roomId !== roomId) return;
      const list = listRef.current;
      stickToBottomRef.current = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      setMessages((prev) => mergeMessages(prev, [toChatMessage(payload)]));
    };

    socket.on(SOCKET_EVENTS.CHAT.RECEIVED, handleReceived);
    return () => {
      socket.off(SOCKET_EVENTS.CHAT.RECEIVED, handleReceived);
    };
  }, [socket, roomId]);

  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottomRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  const loadOlder = async () => {
    if (!nextCursor || isLoading) return;
    setIsLoading(true);
    const res = await getRoomMessages(roomId, token, nextCursor);
    setIsLoading(false);
    if (res.ok && res.messages) {
      stickToBottomRef.current = false;
      setMessages((prev) => mergeMessages(prev, res.messages));
      setNextCursor(res.nextCursor ?? null);
    } else {
      setError(res.error || 'Failed to load older messages');
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !socket || !isJoined || isSending) return;

    setIsSending(true);
    stickToBottomRef.current = true;
    socket.emit(SOCKET_EVENTS.CHAT.SEND, { roomId, message: text }, (ack) => {
      setIsSending(false);
      if (ack?.ok) {
        setDraft('');
        setError(null);
      } else {
        setError(ack?.error || 'Failed to send message');
      }
    });
  };

  const canSend = Boolean(socket && isJoined && draft.trim() && !isSending);

  return (
    <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
      <h3 style={{ marginTop: 0, marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.5rem', fontSize: '1.05rem' }}>
        Room Chat
      </h3>

      <div
        ref={listRef}
        data-testid="chat-messages"
        style={{ height: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}
      >
        {nextCursor && (
          <button
            type="button"
            onClick={loadOlder}
            disabled={isLoading}
            style={{ alignSelf: 'center', padding: '3px 10px', fontSize: '0.75rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer' }}
          >
            {isLoading ? 'Loading...' : 'Load older messages'}
          </button>
        )}

        {!isLoading && messages.length === 0 && (
          <p style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>No messages yet. Say hello!</p>
        )}

        {messages.map((m) => {
          const isMine = Boolean(currentUserId && m.sender.id === currentUserId);
          return (
            <div
              key={m.id}
              style={{
                alignSelf: isMine ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: '0.4rem 0.7rem',
                borderRadius: '8px',
                background: isMine ? '#e0e7ff' : '#f1f5f9',
                fontSize: '0.875rem',
              }}
            >
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '2px' }}>
                <strong>{isMine ? 'You' : m.sender.username}</strong>{' '}
                {m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ''}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
            </div>
          );
        })}
      </div>

      {error && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>{error}</p>}

      <form onSubmit={sendMessage} style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          aria-label="Chat message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder={isJoined ? 'Type a message...' : 'Connecting to room...'}
          disabled={!isJoined}
          style={{ flex: 1, padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
        />
        <button
          type="submit"
          disabled={!canSend}
          style={{
            padding: '6px 14px',
            fontSize: '0.875rem',
            fontWeight: 600,
            color: '#ffffff',
            background: canSend ? '#4f46e5' : '#94a3b8',
            border: 'none',
            borderRadius: '6px',
            cursor: canSend ? 'pointer' : 'not-allowed',
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
};

export default ChatPanel;
