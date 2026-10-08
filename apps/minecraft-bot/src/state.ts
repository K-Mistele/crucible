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
}

type ArmorSlot = 'head' | 'chest' | 'legs' | 'feet';

// Player inventory window slots for armor.
const ARMOR_SLOTS: Record<ArmorSlot, number> = { head: 5, chest: 6, legs: 7, feet: 8 };
const MIN_MOVE = 0.5;

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
  };
}

const formatPosition = ({ x, y, z }: BotState['position']) =>
  `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;

const formatInventory = (inventory: BotState['inventory']) => {
  const entries = Object.entries(inventory).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0 ? 'empty' : entries.map(([name, count]) => `${name} x${count}`).join(', ');
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
  return lines;
}
