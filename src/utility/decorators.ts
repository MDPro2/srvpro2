import { Metadata } from './metadata';

export const RoomMethod = (): MethodDecorator =>
  Metadata.set('roomMethod', true, 'roomMethodKeys');
