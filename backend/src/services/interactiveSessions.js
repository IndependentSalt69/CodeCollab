const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Room = require('../../../database/models/Room');
const ExecutionRun = require('../../../database/models/ExecutionRun');
const queue = require('../../../execution/engine/queue');
const policy = require('../../../execution/engine/sandboxConfig');
const protocol = require('../../../execution/engine/sessionProtocol');
const { validateExecutionRequest, verifyDriverPermission } = require('./executionService');

const userId = socket => {
  const user = socket.data?.verifiedUser;
  if (!socket.data?.authenticated || !user || (user.exp && user.exp * 1000 <= Date.now())) return null;
  return String(user.userId || user.id || user._id || '') || null;
};
const membersOf = room => new Set([room.owner, ...(room.members || [])].map(id => String(id?._id || id)));
// Execution history keeps the same 64 KiB per-stream cap as batch runs.
const capped = (current, text) => current.length >= policy.MAX_OUTPUT_BUFFER_BYTES ? current : (current + text).slice(0, policy.MAX_OUTPUT_BUFFER_BYTES);
const belongs = (socket, roomId, allowed) => userId(socket) && allowed.has(userId(socket)) &&
  socket.rooms.has(roomId) && socket.data?.roomVerifiedUsers?.has(roomId);

class InteractiveSessions {
  constructor(io, options = {}) {
    this.io = io;
    this.queue = options.queue || queue;
    this.connect = options.connect || protocol.connect;
    this.sessions = new Map();
    this.redis = null;
    this.timer = null;
    this.closed = false;
    this.polling = false;
  }
  async transport() {
    if (this.redis && this.redis.status !== 'ready') {
      this.redis.disconnect(); this.redis = null; this.connecting = null;
    }
    if (!this.connecting) this.connecting = this.connect().then(redis => (this.redis = redis)).catch(error => { this.connecting = null; throw error; });
    return this.connecting;
  }
  async room(roomId) {
    if (mongoose.connection.readyState !== 1) throw Error('Database connection unavailable');
    const room = await Room.findOne({ roomId });
    if (!room) throw Error('Room not found');
    return room;
  }
  async authorize(socket, roomId) {
    if (this.io.sockets.sockets.get(socket.id) !== socket || !userId(socket)) throw Error('Authentication required');
    const room = await this.room(roomId);
    if (!belongs(socket, roomId, membersOf(room))) throw Error('Room membership required');
    const permission = await verifyDriverPermission({ roomId, user: socket.data.verifiedUser, socketId: socket.id, io: this.io });
    if (!permission.authorized) throw Error('Only the active room driver can control execution');
    return room;
  }
  async start(socket, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('Invalid execution request');
    const validation = validateExecutionRequest(payload);
    if (!validation.valid) throw Error(validation.error);
    if (payload.roomId.length > 128) throw Error('Invalid room identifier');
    await this.authorize(socket, payload.roomId);
    if (this.closed || this.sessions.size >= 25 || [...this.sessions.values()].some(s => s.roomId === payload.roomId || s.userId === userId(socket))) {
      throw Error('An execution is already active or the terminal is at capacity');
    }
    const redis = await this.transport();
    // Recheck after asynchronous connection setup; starts on a socket are serialized by register().
    await this.authorize(socket, payload.roomId);
    if (this.closed || this.sessions.size >= 25 || [...this.sessions.values()].some(s => s.roomId === payload.roomId || s.userId === userId(socket))) {
      throw Error('An execution is already active or the terminal is at capacity');
    }
    const id = randomUUID(), names = protocol.keys(id);
    const session = { id, names, socket, roomId: payload.roomId, userId: userId(socket), language: validation.normalizedLang,
      status: 'queued', cursor: '0-0', seq: 0, inputSeq: 0, inputBytes: Buffer.byteLength(payload.stdin || ''),
      inputCount: 0, inputClosed: false, deadline: Date.now() + 25000, timeout: payload.timeout || policy.MAX_TIMEOUT_MS,
      renewed: Date.now(), emittedBytes: 0, startedAt: Date.now(), stdin: payload.stdin || '', stdout: '', stderr: '' };
    this.sessions.set(id, session);
    this.recordStart(session, payload.code);
    try {
      await redis.set(names.lease, 'alive', 'PX', protocol.LEASE_MS);
      session.job = await this.queue.add({ language: session.language, code: payload.code, stdin: payload.stdin,
        timeout: session.timeout, memory: payload.memory, roomId: session.roomId, userId: session.userId, sessionId: id },
      { jobId: id, attempts: 1, removeOnComplete: true, removeOnFail: true });
      await this.deliver(session, { type: 'status', status: 'queued', seq: 0 });
      if (!this.timer) { this.timer = setInterval(() => { void this.poll(); }, 40); this.timer.unref(); }
      return { ok: true, sessionId: id, roomId: session.roomId, status: 'queued', language: session.language };
    } catch (error) { await this.finish(session); throw error; }
  }
  async action(socket, action, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('Invalid terminal request');
    const session = this.sessions.get(payload.sessionId);
    if (!session || session.socket !== socket || session.userId !== userId(socket)) throw Error('Execution session unavailable');
    await this.authorize(socket, session.roomId);
    if (!this.sessions.has(session.id) || Date.now() > session.deadline || session.cancelRequested) throw Error('Execution session ended or expired');
    if (action !== 'cancel' && (!Number.isSafeInteger(payload.seq) || payload.seq !== session.inputSeq + 1)) throw Error('Stale or out-of-order input');
    const sequence = session.inputSeq + 1;
    if (action !== 'cancel' && (session.status !== 'running' || session.inputClosed)) throw Error('Program input is not open');
    if (action === 'input') {
      if (typeof payload.data !== 'string' || Buffer.byteLength(payload.data) > 4096) throw Error('Input message exceeds 4 KiB or is not text');
      // Reserve capacity for EOF/cancel; never trim an unconsumed input event.
      if (session.inputBytes + Buffer.byteLength(payload.data) > policy.MAX_STDIN_SIZE_BYTES || session.inputCount >= 1022) throw Error('Session input limit exceeded');
    }
    await protocol.append(this.redis, session.names.input, session.names.lease,
      { action, seq: sequence, ...(action === 'input' ? { data: payload.data } : {}) }, 1024);
    session.inputSeq = sequence;
    if (action === 'input') { session.inputBytes += Buffer.byteLength(payload.data); session.inputCount++; session.stdin += payload.data; }
    if (action === 'eof') session.inputClosed = true;
    if (action === 'cancel') await this.cancel(session);
    return { ok: true, seq: sequence };
  }
  async cancel(session) {
    if (!this.sessions.has(session.id) || session.cancelRequested) return;
    session.cancelRequested = true;
    session.inputClosed = true;
    await this.redis.set(session.names.lease, 'cancelled', 'PX', protocol.LEASE_MS).catch(() => {});
    // Waiting jobs have no sandbox; remove them immediately. Locked jobs finish in the worker.
    try { await session.job?.remove(); await this.finish(session, { status: 'cancelled', exitCode: 130 }); }
    catch { session.deadline = Math.min(session.deadline, Date.now() + session.timeout + 2000); }
  }
  async deliver(session, event, allowed = null) {
    allowed ||= membersOf(await this.room(session.roomId));
    for (const id of this.io.sockets.adapter.rooms.get(session.roomId) || []) {
      const socket = this.io.sockets.sockets.get(id);
      if (socket && belongs(socket, session.roomId, allowed)) {
        if (socket.conn?.writeBuffer?.length > 128) { socket.disconnect(true); continue; }
        socket.emit('terminal:event', { ...event, sessionId: session.id, roomId: session.roomId, language: session.language, canControl: socket === session.socket });
      }
    }
  }
  async poll() {
    if (this.polling || this.closed) return;
    this.polling = true;
    try {
      for (const session of [...this.sessions.values()]) {
        try {
          if (!session.socket.connected || !session.socket.rooms.has(session.roomId)) await this.cancel(session);
          if (!this.sessions.has(session.id)) continue;
          if (Date.now() > session.deadline) {
            await this.finish(session, { status: session.cancelRequested ? 'cancelled' : 'failed', error: 'Execution worker stopped responding or queue deadline expired' });
            continue;
          }
          if (!session.cancelRequested && Date.now() - session.renewed > 750) {
            // XX prevents resurrection after a broken backend lease.
            if (!await this.redis.set(session.names.lease, 'alive', 'PX', protocol.LEASE_MS, 'XX')) throw Error('Lease expired');
            session.renewed = Date.now();
          }
          const rows = await this.redis.xread('COUNT', 64, 'STREAMS', session.names.output, session.cursor);
          const allowed = rows ? membersOf(await this.room(session.roomId)) : null;
          for (const [cursor, fields] of rows?.[0]?.[1] || []) {
            session.cursor = cursor;
            const event = JSON.parse(fields[1]);
            if (!Number.isSafeInteger(event.seq) || event.seq !== session.seq + 1) throw Error('Output sequence gap');
            session.seq = event.seq;
            if (event.type === 'finished') { await this.finish(session, event); break; }
            if (event.type === 'status') {
              if (!['starting', 'running'].includes(event.status)) throw Error('Invalid worker status');
              session.status = event.status;
              if (event.status === 'starting') session.deadline = Date.now() + session.timeout + 4000;
            } else if (event.type === 'output') {
              if (!['stdout', 'stderr'].includes(event.channel) || typeof event.text !== 'string' || Buffer.byteLength(event.text) > 4200) throw Error('Invalid worker output');
              session.emittedBytes += Buffer.byteLength(event.text);
              session[event.channel] = capped(session[event.channel], event.text);
              if (session.emittedBytes > 132000) throw Error('Output limit exceeded');
            } else throw Error('Invalid worker event');
            await this.deliver(session, event, allowed);
          }
        } catch { await this.finish(session, { status: 'failed', error: 'Execution transport or room authorization unavailable' }); }
      }
    } finally { this.polling = false; }
  }
  async finish(session, result) {
    if (!this.sessions.delete(session.id)) return;
    if (result) await this.deliver(session, { ...result, type: 'finished', seq: result.seq || session.seq + 1 }).catch(() => {});
    this.recordFinish(session, result);
    // Removing the lease also cancels a still-running worker. Expiry handles Redis loss.
    if (this.redis) await this.redis.del(...Object.values(session.names)).catch(() => {});
    try { await session.job?.remove(); } catch { /* Locked jobs auto-remove after worker completion/stall. */ }
    if (!this.sessions.size) { clearInterval(this.timer); this.timer = null; }
  }
  // History is best effort and never blocks or fails the live terminal session.
  recordStart(session, code) {
    session.run = ExecutionRun.create({ roomId: session.roomId, triggeredBy: session.userId, language: session.language,
      code, stdin: session.stdin, status: 'queued' })
      .catch(error => { console.error(`[Terminal] Could not save execution run: ${error.message}`); return null; });
  }
  recordFinish(session, result) {
    const status = ['completed', 'failed', 'timeout', 'cancelled'].includes(result?.status) ? result.status : 'failed';
    void session.run?.then(run => run && ExecutionRun.updateOne({ _id: run._id }, { $set: {
      status, exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : (status === 'completed' ? 0 : 1),
      executionTimeMs: result?.executionTimeMs || Date.now() - session.startedAt,
      stdin: session.stdin, stdout: session.stdout,
      stderr: result?.error && !session.stderr ? result.error : session.stderr,
    } })).catch(error => console.error(`[Terminal] Could not update execution run: ${error.message}`));
  }
  register(socket) {
    let busy = false, window = Date.now(), commands = 0, startWindow = Date.now(), starts = 0;
    for (const action of ['start', 'input', 'eof', 'cancel']) socket.on(`terminal:${action}`, async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (Date.now() - window >= 1000) { window = Date.now(); commands = 0; }
      if (busy || ++commands > 20) { reply({ ok: false, error: 'Terminal request rate exceeded; wait before retrying' }); return; }
      if (action === 'start') {
        if (Date.now() - startWindow >= 60000) { startWindow = Date.now(); starts = 0; }
        if (++starts > 20) { reply({ ok: false, error: 'Execution start rate exceeded' }); return; }
      }
      busy = true;
      try { reply(action === 'start' ? await this.start(socket, payload) : await this.action(socket, action, payload)); }
      catch (error) { reply({ ok: false, error: error.message.startsWith('Unsupported language') ? 'Unsupported execution language; use python, cpp or java' :
        /^(Authentication|Room |Only |Invalid |Program |Input |Session |Stale |Execution session|An execution|code |stdin |timeout |memory |language |roomId |Database )/.test(error.message) ? error.message : 'Execution transport unavailable' }); }
      finally { busy = false; }
    });
    socket.on('disconnect', () => { for (const session of this.sessions.values()) if (session.socket === socket) void this.cancel(session); });
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const session of [...this.sessions.values()]) await this.finish(session);
    this.redis?.disconnect();
  }
}
module.exports = { InteractiveSessions, userId, belongs };
