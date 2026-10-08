import { EventBuffer, type Bot, type Camera } from '@minecraft-cloud/minecraft-bot';
import { Observer } from '../src/observer.ts';

/** A bot with just the fields `snapshot()` reads. */
export function fakeBot(overrides: { x?: number; food?: number; items?: { name: string; count: number }[] } = {}) {
  return {
    entity: { position: { x: overrides.x ?? 0, y: 64, z: 0 } },
    game: { dimension: 'overworld' },
    health: 20,
    food: overrides.food ?? 20,
    experience: { level: 0 },
    heldItem: null,
    inventory: { items: () => overrides.items ?? [], slots: [] },
  } as unknown as Bot;
}

export function fakeRuntime() {
  const runtime = { bot: fakeBot() as Bot | undefined, connected: true, events: new EventBuffer() };
  return runtime;
}

export function fakeCamera(): Camera {
  return {
    capture: async () => 'cG5n',
    reload: async () => {},
    close: async () => {},
  };
}

export function observerFor(runtime: ReturnType<typeof fakeRuntime>) {
  return new Observer(runtime, () => fakeCamera());
}

/** A context message as Pi stores a delivered observation. */
export function delivered(seq: number) {
  return { role: 'custom', customType: 'minecraft-observation', details: { seq } };
}
