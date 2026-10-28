import React, { useEffect, useRef, useState } from 'react';
import type { Room, Participant, RemoteTrack } from 'livekit-client';
import { getVoiceToken } from '../../services/roomService';

type VoiceStatus = 'idle' | 'connecting' | 'connected';

interface VoicePanelProps {
  roomId: string;
  token: string | null;
}

interface VoiceMember {
  identity: string;
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
}

function listMembers(room: Room): VoiceMember[] {
  const toMember = (p: Participant, isLocal: boolean): VoiceMember => ({
    identity: p.identity,
    name: p.name || p.identity,
    isLocal,
    isSpeaking: p.isSpeaking,
    isMuted: !p.isMicrophoneEnabled,
  });
  return [
    toMember(room.localParticipant, true),
    ...Array.from(room.remoteParticipants.values()).map((p) => toMember(p, false)),
  ];
}

export const VoicePanel: React.FC<VoicePanelProps> = ({ roomId, token }) => {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [members, setMembers] = useState<VoiceMember[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);

  // Leave the call when switching rooms or leaving the page
  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [roomId]);

  const join = async () => {
    if (status !== 'idle') return;
    setError(null);
    setStatus('connecting');

    const res = await getVoiceToken(roomId, token);
    if (!res.ok || !res.token || !res.url) {
      setStatus('idle');
      setError(res.error || 'Failed to join voice');
      return;
    }

    // Loaded on demand so the voice SDK is not part of the main bundle
    const { Room, RoomEvent, Track } = await import('livekit-client');
    const room = new Room();
    roomRef.current = room;
    const refresh = () => setMembers(listMembers(room));

    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.style.display = 'none';
          document.body.appendChild(el);
        }
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
      })
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.Disconnected, () => {
        if (roomRef.current === room) {
          roomRef.current = null;
          setStatus('idle');
          setMembers([]);
        }
      });

    try {
      await room.connect(res.url, res.token);
      await room.startAudio();
    } catch (err) {
      room.disconnect();
      roomRef.current = null;
      setStatus('idle');
      setError('Could not connect to the voice server');
      return;
    }

    setStatus('connected');
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      setIsMuted(false);
    } catch (err) {
      setIsMuted(true);
      setError('Microphone access was blocked. You can still listen.');
    }
    refresh();
  };

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(isMuted);
      setIsMuted(!isMuted);
      setError(null);
    } catch (err) {
      setError('Microphone access was blocked. You can still listen.');
    }
    setMembers(listMembers(room));
  };

  const leave = () => {
    roomRef.current?.disconnect();
  };

  const buttonStyle = (background: string): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: '0.875rem',
    fontWeight: 600,
    color: '#ffffff',
    background,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  });

  return (
    <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
      <h3 style={{ marginTop: 0, marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.5rem', fontSize: '1.05rem' }}>
        Voice
      </h3>

      {status === 'connected' ? (
        <>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem' }}>
            {members.map((m) => (
              <li
                key={m.identity}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.45rem 0.7rem',
                  marginBottom: '0.4rem',
                  borderRadius: '6px',
                  border: `1px solid ${m.isSpeaking ? '#22c55e' : '#e2e8f0'}`,
                  background: m.isSpeaking ? '#f0fdf4' : '#ffffff',
                  fontSize: '0.875rem',
                }}
              >
                <span>
                  <strong>{m.name}</strong>
                  {m.isLocal ? ' (You)' : ''}
                </span>
                <span style={{ fontSize: '0.75rem', color: m.isMuted ? '#b91c1c' : '#64748b' }}>
                  {m.isMuted ? '🔇 Muted' : m.isSpeaking ? '🔊 Speaking' : '🎙️'}
                </span>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" onClick={toggleMute} style={buttonStyle(isMuted ? '#16a34a' : '#475569')}>
              {isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" onClick={leave} style={buttonStyle('#dc2626')}>
              Leave voice
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: 0 }}>
            Talk with everyone in this room. Your browser will ask for microphone access.
          </p>
          <button
            type="button"
            onClick={join}
            disabled={status === 'connecting'}
            style={{ ...buttonStyle(status === 'connecting' ? '#94a3b8' : '#4f46e5'), cursor: status === 'connecting' ? 'not-allowed' : 'pointer' }}
          >
            {status === 'connecting' ? 'Joining...' : '🎙️ Join voice'}
          </button>
        </>
      )}

      {error && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.8rem', margin: '0.75rem 0 0' }}>{error}</p>}
    </div>
  );
};

export default VoicePanel;
