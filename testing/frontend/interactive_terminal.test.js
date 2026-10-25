/** @jest-environment jsdom */
const React = require('react');
const { render, fireEvent, screen, waitFor, cleanup } = require('@testing-library/react');
require('@testing-library/jest-dom');
const Terminal = require('../../frontend/src/components/terminal/Terminal').default;
const { applyTerminalEvent } = require('../../frontend/src/services/interactiveTerminal');
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
  fireEvent.submit(screen.getByLabelText('Program input').closest('form'));
  await waitFor(() => expect(input).toHaveBeenCalledWith('Alex Ω\n'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
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
