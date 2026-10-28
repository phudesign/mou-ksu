const { authenticateToken } = require('../middleware/auth');
const { pool } = require('../config/db');
const signatureService = require('./signatureService');
const { assertCanAccessMou } = require('../utils/mouAccess');

const MAX_STROKE_POINTS = 5000;

const roomName = (mouId) => `mou_${mouId}`;

let io = null;

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function errorMessage(err) {
  if (err.status && err.status < 500) return err.message;
  console.error('Socket handler failed:', err);
  return 'Internal server error';
}

/** Broadcasts the result of signatureService.submitSignature to everyone in the MOU room. */
function broadcastSignature({ mouId, boxId, userId, signedAt, completed, pngBytes }) {
  if (!io) return;
  const room = roomName(mouId);
  io.to(room).emit('drawing_stroke', { mouId, boxId, userId, strokes: [] });
  io.to(room).emit('signature_confirmed', {
    mouId,
    boxId,
    userId,
    signedAt,
    imageBase64: pngBytes.toString('base64'),
  });
  if (completed) {
    io.to(room).emit('mou_completed', { mouId, finalPdfUrl: `/api/mou/${mouId}/signed-pdf` });
  }
  // Every connected client, not just the room, so MOU lists elsewhere can refresh.
  io.emit('mou_updated', { mouId, boxId, completed: Boolean(completed) });
}

/** Broadcasts the result of signatureService.resetSignature so the box reopens for its signer. */
function broadcastSignatureReset({ mouId, boxId, userId, roleName, reason, status }) {
  if (!io) return;
  io.to(roomName(mouId)).emit('signature_reset', { mouId, boxId, userId, roleName, reason, status });
  io.emit('mou_updated', { mouId, boxId, completed: false });
}

/** Sends the de-duplicated list of users currently in an MOU room to everyone in it. */
async function emitRoomUsers(mouId) {
  if (!io) return;
  const sockets = await io.in(roomName(mouId)).fetchSockets();
  const users = new Map();
  for (const { data } of sockets) {
    const u = data.user;
    if (u && !users.has(u.id)) users.set(u.id, { id: u.id, username: u.username, fullName: u.fullName ?? null });
  }
  io.to(roomName(mouId)).emit('room_users', { mouId, users: [...users.values()] });
}

function emitRoomUsersSafely(mouId) {
  emitRoomUsers(mouId).catch((err) => console.error('Failed to emit room users:', err));
}

function isValidStrokes(strokes) {
  if (!Array.isArray(strokes)) return false;
  let points = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke)) return false;
    points += stroke.length;
    if (points > MAX_STROKE_POINTS) return false;
    for (const p of stroke) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every((c) => typeof c === 'number' && c >= 0 && c <= 1)) {
        return false;
      }
    }
  }
  return true;
}

function init(socketServer) {
  io = socketServer;

  io.use(async (socket, next) => {
    try {
      socket.data.user = await authenticateToken(socket.handshake.auth?.token);
      socket.data.ownedBoxes = new Map(); // mouId -> Set(boxId) owned by this user
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { user, ownedBoxes } = socket.data;

    socket.on('join_room', async ({ mouId } = {}, ack = () => {}) => {
      try {
        const id = toPositiveInt(mouId);
        if (!id) return ack({ success: false, error: 'Invalid mouId' });

        const [rows] = await pool.execute(
          'SELECT id, visibility FROM mou_documents WHERE id = ?',
          [id]
        );
        if (!rows[0]) return ack({ success: false, error: 'MOU not found' });
        await assertCanAccessMou(user, rows[0]);

        const [boxes] = await pool.execute(
          'SELECT id FROM mou_signature_boxes WHERE mou_id = ? AND user_id = ?',
          [id, user.id]
        );
        ownedBoxes.set(id, new Set(boxes.map((b) => b.id)));

        socket.join(roomName(id));
        io.to(roomName(id)).emit('user_joined', { userId: user.id, mouId: id });
        emitRoomUsersSafely(id);
        ack({ success: true });
      } catch (err) {
        ack({ success: false, error: errorMessage(err) });
      }
    });

    socket.on('leave_room', ({ mouId } = {}) => {
      const id = toPositiveInt(mouId);
      if (!id) return;
      ownedBoxes.delete(id);
      socket.leave(roomName(id));
      emitRoomUsersSafely(id);
    });

    // Rooms are already left by now, so the remaining users get a list without this socket.
    socket.on('disconnect', () => {
      for (const id of ownedBoxes.keys()) emitRoomUsersSafely(id);
    });

    // Live preview while drawing: strokes are normalized [x, y] points (0..1) relative to the canvas.
    socket.on('drawing_stroke', ({ mouId, boxId, strokes } = {}) => {
      const id = toPositiveInt(mouId);
      const box = toPositiveInt(boxId);
      if (!id || !box || !ownedBoxes.get(id)?.has(box) || !isValidStrokes(strokes)) return;
      socket.to(roomName(id)).emit('drawing_stroke', { mouId: id, boxId: box, userId: user.id, strokes });
    });

    socket.on('signature_submitted', async (payload = {}, ack = () => {}) => {
      try {
        const mouId = toPositiveInt(payload.mouId);
        const boxId = toPositiveInt(payload.boxId);
        if (!mouId || !boxId) return ack({ success: false, error: 'Invalid mouId or boxId' });

        const result = await signatureService.submitSignature({
          mouId,
          boxId,
          userId: user.id,
          imageBase64: payload.imageBase64,
          userSignatureId: payload.userSignatureId == null ? undefined : toPositiveInt(payload.userSignatureId),
          ipAddress: socket.handshake.address,
        });
        broadcastSignature(result);
        const { pngBytes, ...data } = result;
        ack({ success: true, data });
      } catch (err) {
        ack({ success: false, error: errorMessage(err) });
      }
    });
  });
}

module.exports = { init, broadcastSignature, broadcastSignatureReset };
