type SocketLike = { readyState: number; send(data: string): void; trekSocketId?: number };
const rooms = new Map<string, Set<SocketLike>>();
const socketRooms = new Map<SocketLike, Set<string>>();
export function cloudflareJoin(socket: SocketLike, tripId: string): void { let room = rooms.get(tripId); if (!room) rooms.set(tripId, room = new Set()); room.add(socket); let mine = socketRooms.get(socket); if (!mine) socketRooms.set(socket, mine = new Set()); mine.add(tripId); }
export function cloudflareLeave(socket: SocketLike, tripId: string): void { const room = rooms.get(tripId); room?.delete(socket); if (room?.size === 0) rooms.delete(tripId); socketRooms.get(socket)?.delete(tripId); }
export function cloudflareLeaveAll(socket: SocketLike): void { for (const tripId of socketRooms.get(socket) ?? []) cloudflareLeave(socket, tripId); socketRooms.delete(socket); }
export function cloudflareBroadcast(tripId: string | number, payload: Record<string, unknown>, exclude?: string | number): void { const skip = exclude == null ? null : String(exclude); for (const socket of rooms.get(String(tripId)) ?? []) if (socket.readyState === 1 && (skip == null || String(socket.trekSocketId) !== skip)) socket.send(JSON.stringify(payload)); }
