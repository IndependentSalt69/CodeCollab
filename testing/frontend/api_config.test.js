/** @jest-environment jsdom */
jest.mock('axios');
const axios = require('axios');
const { register } = require('../../frontend/src/services/authService');
const { listRooms } = require('../../frontend/src/services/roomService');
const { submitCodeExecution } = require('../../frontend/src/services/executionService');
const { API_BASE_URL, REALTIME_URL } = require('../../frontend/src/services/apiConfig');
test('actual service modules use the same browser origin for auth, rooms and execution', async () => {
  axios.post.mockResolvedValue({ data: { ok: true } });
  axios.get.mockResolvedValue({ data: { ok: true, rooms: [] } });
  expect(API_BASE_URL).toBe('');
  expect(REALTIME_URL).toBeUndefined();
  await register({ username: 'fixture', email: 'fixture@example.test', password: 'fixture-only' });
  await listRooms('token');
  await submitCodeExecution({ roomId: 'fixture', language: 'python', code: 'print(1)' }, 'token');
  expect(axios.post.mock.calls.map(call => call[0])).toEqual(['/api/auth/register', '/api/execute']);
  expect(axios.get.mock.calls[0][0]).toBe('/api/rooms');
});
test('build-time API and realtime overrides are respected', () => {
  process.env.VITE_API_URL = 'https://api.example.test/';
  process.env.VITE_REALTIME_URL = 'https://realtime.example.test';
  try {
    jest.isolateModules(() => {
      const config = require('../../frontend/src/services/apiConfig');
      expect(config.API_BASE_URL).toBe('https://api.example.test');
      expect(config.REALTIME_URL).toBe('https://realtime.example.test');
    });
  } finally { delete process.env.VITE_API_URL; delete process.env.VITE_REALTIME_URL; }
});
