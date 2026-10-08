import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vite-plus/test';
import type { Bot } from 'mineflayer';
import { hudState, itemIcons } from '../src/hud.ts';

function publicDir() {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-'));
  const textures = join(dir, 'textures', '26.1');
  mkdirSync(join(textures, 'items'), { recursive: true });
  mkdirSync(join(textures, 'blocks'), { recursive: true });
  for (const file of ['items/potato.png', 'blocks/spruce_planks.png', 'blocks/dark_oak_planks.png']) {
    writeFileSync(join(textures, file), '');
  }
  writeFileSync(
    join(textures, 'items_textures.json'),
    JSON.stringify([
      { name: 'potato', texture: 'minecraft:items/potato' },
      { name: 'spruce_planks', texture: 'minecraft:block/spruce_planks' },
      { name: 'shield', texture: 'block/dark_oak_planks' },
      { name: 'compass', texture: null },
    ]),
  );
  return dir;
}

describe('itemIcons', () => {
  const icon = itemIcons(publicDir());

  test('finds item sprites and block textures', () => {
    expect(icon('potato')).toBe('textures/26.1/items/potato.png');
    expect(icon('spruce_planks')).toBe('textures/26.1/blocks/spruce_planks.png');
  });

  test('skips stand-in textures for items drawn as 3D models, and unknown items', () => {
    expect(icon('shield')).toBeUndefined();
    expect(icon('compass')).toBeUndefined();
    expect(icon('nonexistent')).toBeUndefined();
  });
});

describe('hudState', () => {
  test('reads health, food, armor, XP, the hotbar and the offhand', () => {
    const slots: ({ name: string; count: number } | null)[] = Array(46).fill(null);
    slots[36] = { name: 'potato', count: 37 };
    slots[45] = { name: 'shield', count: 1 };
    const bot = {
      health: 14.6,
      food: 17,
      experience: { level: 12, progress: 0.5 },
      quickBarSlot: 0,
      inventory: { slots },
      entity: {
        attributes: {
          'generic.armor': { value: 0, modifiers: [{ amount: 6, operation: 0 }, { amount: 2, operation: 0 }] },
          'generic.armor_toughness': { value: 0, modifiers: [] },
        },
      },
    } as unknown as Bot;
    const hud = hudState(bot, (name) => (name === 'potato' ? 'potato.png' : undefined));
    expect(hud).toMatchObject({ health: 15, food: 17, armor: 8, xpLevel: 12, xpProgress: 0.5, selected: 0 });
    expect(hud.hotbar[0]).toEqual({ name: 'potato', count: 37, icon: 'potato.png' });
    expect(hud.hotbar.slice(1)).toEqual(Array(8).fill(null));
    expect(hud.offhand).toEqual({ name: 'shield', count: 1, icon: undefined });
  });
});
