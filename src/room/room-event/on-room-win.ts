import { Room } from '../room';
import { RoomEvent } from './room-event';

export class OnRoomWin extends RoomEvent {
  constructor(
    room: Room,
    public winPos: number,
    public winMatch = false,
  ) {
    super(room);
  }
}
