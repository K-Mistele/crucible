import type { Bot } from 'mineflayer';

export interface BotState {
  position: { x: number; y: number; z: number };
  dimension: string;
  health: number;
  food: number;
  xpLevel: number;
  heldItem: string;
  armor: Record<ArmorSlot, string>;
  inventory: Record<string, number>;
  /** Day phase from the in-game clock. The viewer always draws daylight, so this is the only way to tell. */
  time: TimePhase;
  /** In-game clock, e.g. "18:30". Not reported as a change on its own. */
  clock: string;
  weather: 'clear' | 'rain' | 'thunder';
  /** Hostile mobs within HOSTILE_RANGE blocks, by name. */
  hostiles: Record<string, number>;
  /** Active status effects, e.g. "poison II". */
  effects: string[];
}

export type TimePhase = 'day' | 'sunset' | 'night' | 'sunrise';
type ArmorSlot = 'head' | 'chest' | 'legs' | 'feet';

// Player inventory window slots for armor.
const ARMOR_SLOTS: Record<ArmorSlot, number> = { head: 5, chest: 6, legs: 7, feet: 8 };
const MIN_MOVE = 0.5;
const HOSTILE_RANGE = 16;
// Hostile mobs that minecraft-data files under the generic "mob" type instead of "hostile".
const OTHER_HOSTILES = new Set(['ender_dragon', 'ghast', 'magma_cube', 'phantom', 'shulker', 'slime']);

/** Phase of a Minecraft day from `timeOfDay` (0-23999 ticks; 0 is 6:00, 12000 is 18:00). */
export function timePhase(timeOfDay: number): TimePhase {
  if (timeOfDay < 12_000) return 'day';
  if (timeOfDay < 13_000) return 'sunset';
  if (timeOfDay < 23_000) return 'night';
  return 'sunrise';
}

/** In-game clock time, e.g. "18:30". */
export function clockTime(timeOfDay: number): string {
  const minutes = Math.floor((((timeOfDay + 6_000) % 24_000) / 1_000) * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Game ID of a status effect, e.g. "mining_fatigue", from minecraft-data's name ("MiningFatigue"). */
export function effectName(bot: Bot, id: number): string | undefined {
  const name = (bot.registry.effects as Record<number, { name: string } | undefined>)[id]?.name;
  if (!name) return undefined;
  const snake = name.replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase();
  return snake === 'bad_luck' ? 'unluck' : snake;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
/** Effect level as the game shows it: "II" for amplifier 1. Level I is left out. */
export const effectLevel = (amplifier: number) => (amplifier === 0 ? '' : (ROMAN[amplifier + 1] ?? String(amplifier + 1)));

function activeEffects(bot: Bot): string[] {
  // Typed as an array, but mineflayer keys it by effect ID.
  return Object.values(bot.entity.effects ?? {})
    .map((effect) => [effectName(bot, effect.id) ?? `effect ${effect.id}`, effectLevel(effect.amplifier)].filter(Boolean).join(' '))
    .sort();
}

function nearbyHostiles(bot: Bot): Record<string, number> {
  const hostiles: Record<string, number> = {};
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity || !entity.name) continue;
    if (entity.type !== 'hostile' && !OTHER_HOSTILES.has(entity.name)) continue;
    if (entity.position.distanceTo(bot.entity.position) > HOSTILE_RANGE) continue;
    hostiles[entity.name] = (hostiles[entity.name] ?? 0) + 1;
  }
  return hostiles;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function snapshot(bot: Bot): BotState {
  const inventory: Record<string, number> = {};
  for (const item of bot.inventory.items()) {
    inventory[item.name] = (inventory[item.name] ?? 0) + item.count;
  }
  const armor = Object.fromEntries(
    Object.entries(ARMOR_SLOTS).map(([slot, index]) => [slot, bot.inventory.slots[index]?.name ?? 'none']),
  ) as Record<ArmorSlot, string>;
  const { x, y, z } = bot.entity.position;
  return {
    position: { x: round1(x), y: round1(y), z: round1(z) },
    dimension: String(bot.game.dimension),
    health: Math.round(bot.health),
    food: Math.round(bot.food),
    xpLevel: bot.experience.level,
    heldItem: bot.heldItem?.name ?? 'empty hand',
    armor,
    inventory,
    time: timePhase(bot.time.timeOfDay),
    clock: clockTime(bot.time.timeOfDay),
    weather: bot.thunderState > 0 ? 'thunder' : bot.isRaining ? 'rain' : 'clear',
    hostiles: nearbyHostiles(bot),
    effects: activeEffects(bot),
  };
}

const formatPosition = ({ x, y, z }: BotState['position']) =>
  `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;

const formatInventory = (inventory: BotState['inventory']) => {
  const entries = Object.entries(inventory).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0 ? 'empty' : entries.map(([name, count]) => `${name} x${count}`).join(', ');
};

const formatEffects = (effects: string[]) => (effects.length === 0 ? 'none' : effects.join(', '));

const formatHostiles = (hostiles: BotState['hostiles']) => {
  const entries = Object.entries(hostiles).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0 ? 'none' : entries.map(([name, count]) => `${name} x${count}`).join(', ');
};

/** Full description of the current state, used for the first observation. */
export function describeState(state: BotState): string[] {
  const armor = Object.entries(state.armor)
    .filter(([, item]) => item !== 'none')
    .map(([slot, item]) => `${slot}: ${item}`);
  return [
    `Position: ${formatPosition(state.position)} in ${state.dimension}`,
    `Health: ${state.health}/20`,
    `Hunger: ${state.food}/20`,
    `XP level: ${state.xpLevel}`,
    `Held item: ${state.heldItem}`,
    `Armor: ${armor.length === 0 ? 'none' : armor.join(', ')}`,
    `Inventory: ${formatInventory(state.inventory)}`,
    `Time: ${state.time} (${state.clock})`,
    `Weather: ${state.weather}`,
    `Hostile mobs within ${HOSTILE_RANGE} blocks: ${formatHostiles(state.hostiles)}`,
    `Effects: ${formatEffects(state.effects)}`,
  ];
}

/** Lines describing only what changed between two states. */
export function diffState(previous: BotState, next: BotState): string[] {
  const lines: string[] = [];
  const moved = Math.hypot(
    next.position.x - previous.position.x,
    next.position.y - previous.position.y,
    next.position.z - previous.position.z,
  );
  if (next.dimension !== previous.dimension) {
    lines.push(`Dimension: ${previous.dimension} → ${next.dimension}`);
  }
  if (moved >= MIN_MOVE || next.dimension !== previous.dimension) {
    lines.push(`Position: ${formatPosition(previous.position)} → ${formatPosition(next.position)}`);
  }
  if (next.health !== previous.health) lines.push(`Health: ${previous.health} → ${next.health}`);
  if (next.food !== previous.food) lines.push(`Hunger: ${previous.food} → ${next.food}`);
  if (next.xpLevel !== previous.xpLevel) lines.push(`XP level: ${previous.xpLevel} → ${next.xpLevel}`);
  if (next.heldItem !== previous.heldItem) {
    lines.push(`Held item: ${previous.heldItem} → ${next.heldItem}`);
  }
  for (const slot of Object.keys(next.armor) as ArmorSlot[]) {
    if (next.armor[slot] !== previous.armor[slot]) {
      lines.push(`Armor ${slot}: ${previous.armor[slot]} → ${next.armor[slot]}`);
    }
  }
  const names = new Set([...Object.keys(previous.inventory), ...Object.keys(next.inventory)]);
  for (const name of [...names].sort()) {
    const before = previous.inventory[name] ?? 0;
    const after = next.inventory[name] ?? 0;
    if (before !== after) lines.push(`Inventory: ${name} ${before} → ${after}`);
  }
  if (next.time !== previous.time) lines.push(`Time: ${previous.time} → ${next.time} (${next.clock})`);
  if (next.weather !== previous.weather) lines.push(`Weather: ${previous.weather} → ${next.weather}`);
  const hostiles = formatHostiles(next.hostiles);
  if (hostiles !== formatHostiles(previous.hostiles)) {
    lines.push(`Hostile mobs within ${HOSTILE_RANGE} blocks: ${formatHostiles(previous.hostiles)} → ${hostiles}`);
  }
  const effects = formatEffects(next.effects);
  if (effects !== formatEffects(previous.effects)) lines.push(`Effects: ${formatEffects(previous.effects)} → ${effects}`);
  return lines;
}
