import { Context } from '../app';
import { Room } from './room';

export class RoomManager {
  constructor(private ctx: Context) {}

  private rooms = new Map<string, Room>();

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

      const room = await new Room(this.ctx, name)
        .addFinalizor((r) => {
          this.rooms.delete(r.name);
        })
        .init();
      this.rooms.set(name, room);
      return room;
    });
  }
}
