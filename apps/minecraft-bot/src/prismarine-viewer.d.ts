declare module 'prismarine-viewer/viewer/lib/worldView.js' {
  import type { EventEmitter } from 'node:events';
  import type { Bot } from 'mineflayer';
  import type { Vec3 } from 'vec3';

  export class WorldView extends EventEmitter {
    constructor(world: Bot['world'], viewDistance: number, position: Vec3, emitter: EventEmitter);
    init(position: Vec3): Promise<void>;
    updatePosition(position: Vec3): Promise<void>;
    listenToBot(bot: Bot): void;
    removeListenersFromBot(bot: Bot): void;
  }
}
