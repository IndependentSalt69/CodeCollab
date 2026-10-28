/** @jest-environment jsdom */
const React = require('react');
const { render, fireEvent, screen, waitFor, cleanup, act } = require('@testing-library/react');
global.TextEncoder = require('node:util').TextEncoder;
require('@testing-library/jest-dom');
const Terminal = require('../../frontend/src/components/terminal/Terminal').default;
const { applyTerminalEvent, TerminalRequestError, terminalRequest, terminalTranscript } = require('../../frontend/src/services/interactiveTerminal');
afterEach(cleanup);
const queued = { sessionId: 'a', roomId: 'room', type: 'status', status: 'queued', seq: 0 };
const state = () => applyTerminalEvent(null, queued, 'room');
test('incremental stdout/stderr, ordering, room isolation and stale runs', () => {
  let result = state();
  result = applyTerminalEvent(result, { ...queued, type: 'status', status: 'running', seq: 1 }, 'room');
  result = applyTerminalEvent(result, { ...queued, type: 'output', channel: 'stdout', text: 'Name: ', seq: 2 }, 'room');
  expect(result.stdout).toBe('Name: ');
  expect(applyTerminalEvent(result, { ...queued, type: 'output', text: 'bad', channel: 'stdout', seq: 1 }, 'room')).toBe(result);
  expect(applyTerminalEvent(result, { ...queued, roomId: 'other', seq: 3 }, 'room')).toBe(result);
  result = applyTerminalEvent(result, { ...queued, sessionId: 'b' }, 'room');
  expect(result.stdout).toBe('');
  expect(applyTerminalEvent(result, { ...queued, type: 'output', channel: 'stdout', text: 'late', seq: 3 }, 'room')).toBe(result);
});
test('live input, EOF, Stop and Clear are separate actions', async () => {
  const input = jest.fn().mockResolvedValue(), eof = jest.fn().mockResolvedValue(), stop = jest.fn().mockResolvedValue(), clear = jest.fn();
  const result = { ...state(), status: 'running', stdout: 'Name: ', segments: [{ channel: 'stdout', text: 'Name: ' }] };
  const view = render(React.createElement(Terminal, { result, isRunning: true, canControl: true, onInput: input, onEOF: eof, onStop: stop, onClear: clear }));
  expect(screen.getByRole('log')).toHaveTextContent('Name:');
  fireEvent.change(screen.getByLabelText('Program input'), { target: { value: 'Alex Ω' } });
  expect(screen.queryByRole('button', { name: 'Send', exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('log')).toContainElement(screen.getByLabelText('Program input'));
  fireEvent.keyDown(screen.getByLabelText('Program input'), { key: 'Enter' });
  await waitFor(() => expect(input).toHaveBeenCalledWith('Alex Ω\n'));
  await waitFor(() => expect(screen.getByLabelText('Program input')).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Clear' })); expect(clear).toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send EOF / Close Input' })); await waitFor(() => expect(eof).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Stop' })); await waitFor(() => expect(stop).toHaveBeenCalled());
  view.rerender(React.createElement(Terminal, { result: { ...result, status: 'cancelled', inputClosed: true }, canControl: true }));
  expect(screen.getByLabelText('Program input')).toBeDisabled();
});
test('queued and viewer input are disabled, stderr remains distinguishable', () => {
  render(React.createElement(Terminal, { result: { ...state(), stderr: 'error', segments: [{ channel: 'stderr', text: 'error' }] }, isRunning: true, canControl: false }));
  expect(screen.getByLabelText('Program input')).toBeDisabled(); expect(screen.getByText('error')).toHaveAttribute('data-stream', 'stderr');
});
test('finished events cannot repopulate cleared output or accept later chunks', () => {
  const finished = applyTerminalEvent({ ...state(), stdout: '', segments: [] }, { ...queued, type: 'finished', status: 'completed', seq: 2 }, 'room');
  expect(finished.stdout).toBe(''); expect(finished.inputClosed).toBe(true);
  expect(applyTerminalEvent(finished, { ...queued, type: 'output', text: 'late', channel: 'stdout', seq: 3 }, 'room')).toBe(finished);
});

const running = () => ({ ...state(), seq: 2, status: 'running', stdout: 'Number: ',
  segments: [{ channel: 'stdout', text: 'Number: ', seq: 2 }] });
const enter = value => {
  fireEvent.change(screen.getByLabelText('Program input'), { target: { value } });
  fireEvent.keyDown(screen.getByLabelText('Program input'), { key: 'Enter' });
};
const transcriptText = () => screen.getByTestId('terminal-transcript').textContent;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('two inline responses echo exactly once before output that arrives ahead of the acknowledgement', async () => {
  const first = deferred(), second = deferred();
  const input = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  let result = running();
  const props = { isRunning: true, canControl: true, onInput: input };
  const view = render(React.createElement(Terminal, { ...props, result }));
  const cursor = screen.getByLabelText('Program input');
  expect(cursor.previousSibling.textContent).toBe('Number: ');
  expect(cursor.closest('form')).toBeNull(); expect(cursor).toHaveFocus();
  // Native Backspace editing produces this change before Enter; actual browser also tests Backspace.
  fireEvent.change(cursor, { target: { value: '200' } });
  fireEvent.change(cursor, { target: { value: '20' } });
  fireEvent.keyDown(cursor, { key: 'Enter' }); fireEvent.keyDown(cursor, { key: 'Enter' });
  expect(input).toHaveBeenCalledTimes(1); expect(input).toHaveBeenCalledWith('20\n');
  expect(transcriptText()).toBe('Number: 20\n'); expect(cursor).toHaveValue(''); expect(cursor).toBeDisabled();
  result = applyTerminalEvent(result, { ...queued, type: 'output', channel: 'stdout', text: 'Another: ', seq: 3 }, 'room');
  view.rerender(React.createElement(Terminal, { ...props, result }));
  expect(transcriptText()).toBe('Number: 20\nAnother: ');
  await act(async () => first.resolve());
  expect(cursor).toHaveValue(''); expect(cursor).toHaveFocus(); expect(cursor).toBeEnabled();
  enter('15');
  result = applyTerminalEvent(result, { ...queued, type: 'output', channel: 'stdout', text: 'Sum: 35\n', seq: 4 }, 'room');
  view.rerender(React.createElement(Terminal, { ...props, result }));
  await act(async () => second.resolve());
  expect(transcriptText()).toBe('Number: 20\nAnother: 15\nSum: 35\n');
  expect(input.mock.calls).toEqual([['20\n'], ['15\n']]);
});

test('definite rejection restores the draft and does not silently resend or keep an accepted echo', async () => {
  const request = deferred(), input = jest.fn().mockReturnValueOnce(request.promise).mockResolvedValueOnce();
  render(React.createElement(Terminal, { result: running(), isRunning: true, canControl: true, onInput: input }));
  enter('not lost');
  await act(async () => request.reject(new TerminalRequestError('Input rate exceeded')));
  expect(screen.getByRole('alert')).toHaveTextContent('Input rate exceeded');
  expect(screen.getByLabelText('Program input')).toHaveValue('not lost');
  expect(transcriptText()).toBe('Number: '); expect(input).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByLabelText('Program input'), { key: 'Enter' });
  await waitFor(() => expect(screen.getByLabelText('Program input')).toHaveValue(''));
  expect(input).toHaveBeenCalledTimes(2); expect(transcriptText()).toBe('Number: not lost\n');
});

test('uncertain acknowledgement retains its ordered echo, prohibits replay, and leaves Stop available', async () => {
  const input = jest.fn().mockRejectedValue(new TerminalRequestError('Terminal acknowledgement timed out. Stop this run before retrying.', true));
  const stop = jest.fn().mockResolvedValue();
  render(React.createElement(Terminal, { result: running(), isRunning: true, canControl: true, onInput: input, onStop: stop, onClear: jest.fn() }));
  enter('maybe accepted');
  await screen.findByRole('alert');
  expect(transcriptText()).toBe('Number: maybe accepted\n');
  expect(screen.getByLabelText('Program input')).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText('Program input'), { key: 'Enter' }); expect(input).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.getByRole('alert')).toHaveTextContent('acknowledgement timed out');
  expect(screen.getByLabelText('Program input')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Stop', exact: true }));
  await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
});

test.each(['resolve', 'reject'])('late %s from a previous session cannot affect a new draft or transcript', async outcome => {
  const oldRequest = deferred(), input = jest.fn().mockReturnValue(oldRequest.promise);
  const props = { isRunning: true, canControl: true, onInput: input };
  const view = render(React.createElement(Terminal, { ...props, result: running() }));
  enter('old input');
  view.rerender(React.createElement(Terminal, { ...props, result: { ...running(), sessionId: 'b', roomId: 'other-room' } }));
  fireEvent.change(screen.getByLabelText('Program input'), { target: { value: 'new draft' } });
  await act(async () => oldRequest[outcome](new Error('old failure')));
  expect(screen.getByLabelText('Program input')).toHaveValue('new draft');
  expect(screen.getByLabelText('Program input')).toBeEnabled();
  expect(transcriptText()).toBe('Number: '); expect(screen.queryByRole('alert')).toBeNull();
});

test('Clear removes echoes and output while retaining the process, in-flight input and subsequent output', async () => {
  const request = deferred(), input = jest.fn().mockReturnValue(request.promise), stop = jest.fn();
  function Harness() {
    const [result, setResult] = React.useState(running());
    return React.createElement(React.Fragment, null,
      React.createElement(Terminal, { result, isRunning: true, canControl: true, onInput: input, onStop: stop,
        onClear: () => setResult(previous => ({ ...previous, stdout: '', stderr: '', segments: [] })) }),
      React.createElement('button', { onClick: () => setResult(previous => applyTerminalEvent(previous,
        { ...queued, type: 'output', channel: 'stderr', text: 'Next: ', seq: 3 }, 'room')) }, 'Worker output'));
  }
  render(React.createElement(Harness)); enter('20');
  fireEvent.click(screen.getByRole('button', { name: 'Clear' })); expect(transcriptText()).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Worker output' }));
  await act(async () => request.resolve());
  expect(transcriptText()).toBe('Next: '); expect(stop).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Program input')).toBeEnabled();
  expect(screen.getByText('Next:')).toHaveAttribute('data-stream', 'stderr');
});

test('output received while editing preserves the buffer and keeps the cursor at the tail', () => {
  const props = { isRunning: true, canControl: true, onInput: jest.fn() };
  const view = render(React.createElement(Terminal, { ...props, result: running() }));
  fireEvent.change(screen.getByLabelText('Program input'), { target: { value: 'Ω draft' } });
  const result = applyTerminalEvent(running(), { ...queued, type: 'output', channel: 'stderr', text: 'notice\n', seq: 3 }, 'room');
  view.rerender(React.createElement(Terminal, { ...props, result }));
  expect(screen.getByLabelText('Program input')).toHaveValue('Ω draft');
  expect(screen.getByLabelText('Program input').previousSibling.textContent).toBe('notice\n');
});

test('one newline, UTF-8 byte limit and IME confirmation are handled before submission', async () => {
  const input = jest.fn().mockResolvedValue();
  render(React.createElement(Terminal, { result: running(), isRunning: true, canControl: true, onInput: input }));
  fireEvent.change(screen.getByLabelText('Program input'), { target: { value: 'Manav' } });
  fireEvent.keyDown(screen.getByLabelText('Program input'), { key: 'Enter', isComposing: true });
  expect(input).not.toHaveBeenCalled();
  enter('Ω'.repeat(2048));
  expect(input).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('4 KiB');
  expect(screen.getByLabelText('Program input')).toHaveValue('Ω'.repeat(2048));
  enter(''); await waitFor(() => expect(input).toHaveBeenCalledWith('\n'));
});

test.each(['completed', 'failed', 'timeout', 'cancelled'])('%s cannot accept input or mix a retained draft with a future run', status => {
  const input = jest.fn();
  render(React.createElement(Terminal, { result: { ...running(), status }, canControl: true, onInput: input }));
  expect(screen.getByLabelText('Program input')).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText('Program input'), { key: 'Enter' }); expect(input).not.toHaveBeenCalled();
});

test('same-text output chunks and echo anchors remain distinct by event sequence', () => {
  const parts = [{ channel: 'stdout', text: 'Value: ', seq: 2 }, { channel: 'stdout', text: 'Value: ', seq: 5 }];
  expect(terminalTranscript(parts, [{ id: 1, afterSeq: 2, text: 'one\n' }, { id: 2, afterSeq: 5, text: 'two\n' }])
    .map(part => part.text).join('')).toBe('Value: one\nValue: two\n');
});

test('existing socket timeout contract reports uncertainty without issuing a second command', async () => {
  const emit = jest.fn((event, payload, callback) => callback(new Error('timeout')));
  const socket = { connected: true, timeout: jest.fn(() => ({ emit })) };
  await expect(terminalRequest(socket, 'input', { sessionId: 'a', seq: 1, data: '20\n' })).resolves.toMatchObject({ ok: false, uncertain: true });
  expect(emit).toHaveBeenCalledTimes(1); expect(emit.mock.calls[0][0]).toBe('terminal:input');
});
