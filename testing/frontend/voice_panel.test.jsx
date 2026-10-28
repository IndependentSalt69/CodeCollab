/**
 * @jest-environment jsdom
 *
 * Room voice panel tests
 *
 * Validates joining with a backend-issued token, microphone handling,
 * mute/leave controls and error display. The LiveKit SDK is mocked.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import { VoicePanel } from '../../frontend/src/components/voice/VoicePanel';
import * as roomService from '../../frontend/src/services/roomService';

jest.mock('../../frontend/src/services/roomService');

const mockRooms = [];

// The SDK is installed under the frontend workspace
jest.mock('../../frontend/node_modules/livekit-client', () => {
  const RoomEvent = {
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    ActiveSpeakersChanged: 'activeSpeakersChanged',
    TrackMuted: 'trackMuted',
    TrackUnmuted: 'trackUnmuted',
    LocalTrackPublished: 'localTrackPublished',
    Disconnected: 'disconnected',
  };

  class Room {
    constructor() {
      this.handlers = {};
      this.remoteParticipants = new Map();
      this.localParticipant = {
        identity: 'user-alice',
        name: 'alice',
        isSpeaking: false,
        isMicrophoneEnabled: false,
        setMicrophoneEnabled: jest.fn(async (enabled) => {
          this.localParticipant.isMicrophoneEnabled = enabled;
        }),
      };
      this.connect = jest.fn(async () => {});
      this.startAudio = jest.fn(async () => {});
      this.disconnect = jest.fn(() => this.emit(RoomEvent.Disconnected));
      mockRooms.push(this);
    }
    on(event, fn) {
      this.handlers[event] = fn;
      return this;
    }
    emit(event, ...args) {
      this.handlers[event]?.(...args);
    }
  }

  return { Room, RoomEvent, Track: { Kind: { Audio: 'audio', Video: 'video' } } };
});

const ROOM = 'pair-room-a1b2c3';
const voiceToken = { ok: true, token: 'lk-token', url: 'ws://localhost:7880', roomName: `codecollab-${ROOM}`, identity: 'user-alice' };

describe('VoicePanel', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockRooms.length = 0;
  });

  it('joins with the backend-issued token and turns on the microphone', async () => {
    roomService.getVoiceToken.mockResolvedValue(voiceToken);
    render(<VoicePanel roomId={ROOM} token="login-token" />);

    fireEvent.click(screen.getByRole('button', { name: /join voice/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Leave voice' })).toBeInTheDocument());
    expect(roomService.getVoiceToken).toHaveBeenCalledWith(ROOM, 'login-token');
    const room = mockRooms[0];
    expect(room.connect).toHaveBeenCalledWith('ws://localhost:7880', 'lk-token');
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('(You)', { exact: false })).toBeInTheDocument();
  });

  it('shows the server error and stays idle when a token cannot be issued', async () => {
    roomService.getVoiceToken.mockResolvedValue({ ok: false, error: 'Voice chat is not configured on this server' });
    render(<VoicePanel roomId={ROOM} token="login-token" />);

    fireEvent.click(screen.getByRole('button', { name: /join voice/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Voice chat is not configured on this server');
    expect(screen.getByRole('button', { name: /join voice/i })).toBeEnabled();
    expect(mockRooms).toHaveLength(0);
  });

  it('stays connected to listen when microphone access is blocked', async () => {
    roomService.getVoiceToken.mockResolvedValue(voiceToken);
    render(<VoicePanel roomId={ROOM} token="login-token" />);

    // Fail the microphone request on the room the panel creates
    const realPush = mockRooms.push.bind(mockRooms);
    mockRooms.push = (room) => {
      room.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(new Error('NotAllowedError'));
      return realPush(room);
    };
    fireEvent.click(screen.getByRole('button', { name: /join voice/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/microphone access was blocked/i);
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave voice' })).toBeInTheDocument();
    mockRooms.push = realPush;
  });

  it('mutes and unmutes the microphone', async () => {
    roomService.getVoiceToken.mockResolvedValue(voiceToken);
    render(<VoicePanel roomId={ROOM} token="login-token" />);
    fireEvent.click(screen.getByRole('button', { name: /join voice/i }));
    await screen.findByRole('button', { name: 'Mute' });
    const room = mockRooms[0];

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    await screen.findByRole('button', { name: 'Unmute' });
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(screen.getByText(/muted/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    await screen.findByRole('button', { name: 'Mute' });
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
  });

  it('lists other participants as they join and leave', async () => {
    roomService.getVoiceToken.mockResolvedValue(voiceToken);
    render(<VoicePanel roomId={ROOM} token="login-token" />);
    fireEvent.click(screen.getByRole('button', { name: /join voice/i }));
    await screen.findByRole('button', { name: 'Leave voice' });
    const room = mockRooms[0];

    act(() => {
      room.remoteParticipants.set('user-bob', { identity: 'user-bob', name: 'bob', isSpeaking: true, isMicrophoneEnabled: true });
      room.emit('participantConnected');
    });
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText(/speaking/i)).toBeInTheDocument();

    act(() => {
      room.remoteParticipants.delete('user-bob');
      room.emit('participantDisconnected');
    });
    expect(screen.queryByText('bob')).not.toBeInTheDocument();
  });

  it('leaves the call and returns to the join button', async () => {
    roomService.getVoiceToken.mockResolvedValue(voiceToken);
    render(<VoicePanel roomId={ROOM} token="login-token" />);
    fireEvent.click(screen.getByRole('button', { name: /join voice/i }));
    await screen.findByRole('button', { name: 'Leave voice' });

    fireEvent.click(screen.getByRole('button', { name: 'Leave voice' }));

    expect(mockRooms[0].disconnect).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /join voice/i })).toBeInTheDocument();
  });

  it('disconnects when the panel unmounts', async () => {
    roomService.getVoiceToken.mockResolvedValue(voiceToken);
    const { unmount } = render(<VoicePanel roomId={ROOM} token="login-token" />);
    fireEvent.click(screen.getByRole('button', { name: /join voice/i }));
    await screen.findByRole('button', { name: 'Leave voice' });

    unmount();
    expect(mockRooms[0].disconnect).toHaveBeenCalled();
  });
});
