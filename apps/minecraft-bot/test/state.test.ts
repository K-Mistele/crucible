import { describe, expect, test } from 'vite-plus/test';
import { clockTime, describeState, diffState, timePhase, type BotState } from '../src/state.ts';

const base: BotState = {
  position: { x: -47.5, y: 107, z: -41.5 },
  dimension: 'overworld',
  health: 20,
  food: 18,
  xpLevel: 0,
  heldItem: 'stone_axe',
  armor: { head: 'none', chest: 'none', legs: 'none', feet: 'none' },
  inventory: { oak_log: 12, stone_axe: 1 },
  time: 'day',
  clock: '09:00',
  weather: 'clear',
  hostiles: {},
};

describe('diffState', () => {
  test('reports nothing when nothing changed', () => {
    expect(diffState(base, structuredClone(base))).toEqual([]);
  });

  test('ignores tiny position changes', () => {
    expect(diffState(base, { ...base, position: { x: -47.3, y: 107, z: -41.5 } })).toEqual([]);
  });

  test('reports only the changed fields', () => {
    const next: BotState = {
      ...base,
      position: { x: -43.2, y: 104, z: -38.1 },
      food: 17,
      heldItem: 'oak_log',
      armor: { ...base.armor, head: 'iron_helmet' },
      inventory: { oak_log: 14, dirt: 3 },
    };
    expect(diffState(base, next)).toEqual([
      'Position: (-47.5, 107.0, -41.5) → (-43.2, 104.0, -38.1)',
      'Hunger: 18 → 17',
      'Held item: stone_axe → oak_log',
      'Armor head: none → iron_helmet',
      'Inventory: dirt 0 → 3',
      'Inventory: oak_log 12 → 14',
      'Inventory: stone_axe 1 → 0',
    ]);
  });

  test('reports dimension changes with position', () => {
    const next = { ...base, dimension: 'the_nether', position: { x: -47.5, y: 107, z: -41.5 } };
    expect(diffState(base, next)).toEqual([
      'Dimension: overworld → the_nether',
      'Position: (-47.5, 107.0, -41.5) → (-47.5, 107.0, -41.5)',
    ]);
  });
});

describe('describeState', () => {
  test('describes the full state', () => {
    expect(describeState(base)).toEqual([
      'Position: (-47.5, 107.0, -41.5) in overworld',
      'Health: 20/20',
      'Hunger: 18/20',
      'XP level: 0',
      'Held item: stone_axe',
      'Armor: none',
      'Inventory: oak_log x12, stone_axe x1',
      'Time: day (09:00)',
      'Weather: clear',
      'Hostile mobs within 16 blocks: none',
    ]);
  });
});

describe('time, weather and hostile mobs', () => {
  test('reports a new day phase, weather and nearby hostile mobs', () => {
    const next: BotState = {
      ...base,
      time: 'sunset',
      clock: '18:00',
      weather: 'rain',
      hostiles: { zombie: 2, skeleton: 1 },
    };
    expect(diffState(base, next)).toEqual([
      'Time: day → sunset (18:00)',
      'Weather: clear → rain',
      'Hostile mobs within 16 blocks: none → skeleton x1, zombie x2',
    ]);
  });

  test('ignores the clock moving within the same phase', () => {
    expect(diffState(base, { ...base, clock: '11:30' })).toEqual([]);
  });

  test('maps ticks to phases and clock times', () => {
    expect([0, 11_999, 12_000, 13_000, 18_000, 23_000].map((tick) => [timePhase(tick), clockTime(tick)])).toEqual([
      ['day', '06:00'],
      ['day', '17:59'],
      ['sunset', '18:00'],
      ['night', '19:00'],
      ['night', '00:00'],
      ['sunrise', '05:00'],
    ]);
  });
});
