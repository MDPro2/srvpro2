import { Context } from '../app';
import { Room, RoomFinalizor } from './room';

export class RoomManager {
  constructor(private ctx: Context) {}

  private rooms = new Map<string, Room>();

  private finalizors: RoomFinalizor[] = [];

  addFinalizor(finalizor: RoomFinalizor, atEnd = false) {
    if (atEnd) {
      this.finalizors.push(finalizor);
    } else {
      this.finalizors.unshift(finalizor);
    }
  }

  findByName(name: string) {
    return this.rooms.get(name);
  }

  allRooms() {
    return Array.from(this.rooms.values());
  }

  async findOrCreateByName(name: string) {
    const existing = this.findByName(name);
    if (existing) return existing;

    return this.ctx.aragami.lock(`room_create:${name}`, async () => {
      const existing = this.findByName(name);
      if (existing) return existing;

      const room = new Room(this.ctx, name).addFinalizor((r) => {
        this.rooms.delete(r.name);
      });
      for (const finalizor of this.finalizors) {
        room.addFinalizor(finalizor);
      }
      await room.init();
      this.rooms.set(name, room);
      return room;
    });
  }
}
