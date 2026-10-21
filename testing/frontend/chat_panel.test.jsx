/**
 * @jest-environment jsdom
 *
 * Room chat panel tests
 *
 * Validates history loading, live message delivery, de-duplication,
 * sending through the socket, server error display and loading older pages.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import { ChatPanel } from '../../frontend/src/components/chat/ChatPanel';
import * as roomService from '../../frontend/src/services/roomService';

jest.mock('../../frontend/src/services/roomService');

function createFakeSocket() {
  const handlers = {};
  return {
    on: jest.fn((event, fn) => { handlers[event] = fn; }),
    off: jest.fn((event) => { delete handlers[event]; }),
    emit: jest.fn(),
    receive: (event, payload) => handlers[event]?.(payload),
  };
}

const ROOM = 'pair-room-a1b2c3';
const ME = '67056a1b2c3d4e5f6a7b8c01';

function message(n, overrides = {}) {
  return {
    id: `67056a1b2c3d4e5f6a7b9${String(n).padStart(3, '0')}`,
    roomId: ROOM,
    content: `message ${n}`,
    sender: { id: '67056a1b2c3d4e5f6a7b8c02', username: 'bob' },
    timestamp: '2026-10-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('ChatPanel', () => {
  beforeAll(() => {
    // jsdom does not implement layout; scrolling is a no-op
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 0 });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('loads history (newest page) in chronological order once joined', async () => {
    roomService.getRoomMessages.mockResolvedValue({ ok: true, messages: [message(2), message(1)], nextCursor: null });
    const socket = createFakeSocket();

    render(<ChatPanel socket={socket} roomId={ROOM} token="t" currentUserId={ME} isJoined />);

    await waitFor(() => expect(screen.getByText('message 1')).toBeInTheDocument());
    expect(roomService.getRoomMessages).toHaveBeenCalledWith(ROOM, 't');
    const texts = screen.getAllByText(/^message \d$/).map((el) => el.textContent);
    expect(texts).toEqual(['message 1', 'message 2']);
  });

  it('does not load history before the room is joined', () => {
    roomService.getRoomMessages.mockResolvedValue({ ok: true, messages: [] });
    render(<ChatPanel socket={null} roomId={ROOM} token="t" isJoined={false} />);

    expect(roomService.getRoomMessages).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Chat message')).toBeDisabled();
  });

  it('shows live messages for this room once, and ignores other rooms', async () => {
    roomService.getRoomMessages.mockResolvedValue({ ok: true, messages: [message(1)], nextCursor: null });
    const socket = createFakeSocket();
    render(<ChatPanel socket={socket} roomId={ROOM} token="t" currentUserId={ME} isJoined />);
    await waitFor(() => expect(screen.getByText('message 1')).toBeInTheDocument());

    act(() => {
      socket.receive('chat:message_received', { ...message(2), text: 'message 2', socketId: 'abc' });
      socket.receive('chat:message_received', message(2));
      socket.receive('chat:message_received', message(3, { roomId: 'other-room' }));
    });

    expect(screen.getAllByText('message 2')).toHaveLength(1);
    expect(screen.queryByText('message 3')).not.toBeInTheDocument();
  });

  it('labels the current user\'s messages as "You"', async () => {
    roomService.getRoomMessages.mockResolvedValue({
      ok: true,
      messages: [message(1, { sender: { id: ME, username: 'alice' } })],
      nextCursor: null,
    });
    render(<ChatPanel socket={createFakeSocket()} roomId={ROOM} token="t" currentUserId={ME} isJoined />);

    await waitFor(() => expect(screen.getByText('You')).toBeInTheDocument());
    expect(screen.queryByText('alice')).not.toBeInTheDocument();
  });

  it('sends through the socket and clears the input on success', async () => {
    roomService.getRoomMessages.mockResolvedValue({ ok: true, messages: [], nextCursor: null });
    const socket = createFakeSocket();
    socket.emit.mockImplementation((event, payload, ack) => ack({ ok: true }));
    render(<ChatPanel socket={socket} roomId={ROOM} token="t" isJoined />);
    await screen.findByText(/no messages yet/i);

    const input = screen.getByLabelText('Chat message');
    fireEvent.change(input, { target: { value: '  hello team  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(socket.emit).toHaveBeenCalledWith('chat:message_send', { roomId: ROOM, message: 'hello team' }, expect.any(Function));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('keeps the draft and shows the server error when sending fails', async () => {
    roomService.getRoomMessages.mockResolvedValue({ ok: true, messages: [], nextCursor: null });
    const socket = createFakeSocket();
    socket.emit.mockImplementation((event, payload, ack) =>
      ack({ ok: false, error: 'You are sending messages too quickly. Please slow down.' })
    );
    render(<ChatPanel socket={socket} roomId={ROOM} token="t" isJoined />);
    await screen.findByText(/no messages yet/i);

    const input = screen.getByLabelText('Chat message');
    fireEvent.change(input, { target: { value: 'spam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too quickly/i);
    expect(input).toHaveValue('spam');
  });

  it('does not send empty messages', async () => {
    roomService.getRoomMessages.mockResolvedValue({ ok: true, messages: [], nextCursor: null });
    const socket = createFakeSocket();
    render(<ChatPanel socket={socket} roomId={ROOM} token="t" isJoined />);
    await screen.findByText(/no messages yet/i);

    fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('loads older messages with the cursor', async () => {
    roomService.getRoomMessages
      .mockResolvedValueOnce({ ok: true, messages: [message(3), message(2)], nextCursor: message(2).id })
      .mockResolvedValueOnce({ ok: true, messages: [message(1)], nextCursor: null });
    render(<ChatPanel socket={createFakeSocket()} roomId={ROOM} token="t" isJoined />);

    fireEvent.click(await screen.findByRole('button', { name: /load older messages/i }));

    await waitFor(() => expect(screen.getByText('message 1')).toBeInTheDocument());
    expect(roomService.getRoomMessages).toHaveBeenLastCalledWith(ROOM, 't', message(2).id);
    expect(screen.queryByRole('button', { name: /load older messages/i })).not.toBeInTheDocument();
  });

  it('shows an error when history cannot be loaded', async () => {
    roomService.getRoomMessages.mockResolvedValue({ ok: false, error: 'Access denied: You are not a member of this room' });
    render(<ChatPanel socket={createFakeSocket()} roomId={ROOM} token="t" isJoined />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a member/i);
  });
});
