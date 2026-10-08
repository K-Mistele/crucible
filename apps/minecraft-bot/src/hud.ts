import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bot } from 'mineflayer';
import { effectLevel, effectName } from './state.ts';

/** Texture version the viewer bundle is built with (see scripts/build-viewer.mjs). */
const TEXTURE_VERSION = '26.1';
const HOTBAR_FIRST_SLOT = 36;
const OFFHAND_SLOT = 45;
// Items the game draws as 3D models. Their texture mapping is an unrelated stand-in (a shield maps
// to dark oak planks), so they get a text label instead.
const MODEL_ITEMS = /shield|chest$|_bed$|banner$|_skull$|_head$|decorated_pot|conduit/;

export interface HudItem {
  name: string;
  count: number;
  /** Texture URL relative to the viewer page, if one exists. */
  icon: string | undefined;
}

export interface HudState {
  health: number;
  food: number;
  armor: number;
  xpLevel: number;
  /** Progress to the next level, 0 to 1. */
  xpProgress: number;
  hotbar: (HudItem | null)[];
  selected: number;
  offhand: HudItem | null;
  effects: HudEffect[];
}

export interface HudEffect {
  name: string;
  /** "II" for amplifier 1; empty for level I. */
  level: string;
  /** Seconds left, or null for an infinite effect. */
  secondsLeft: number | null;
  icon: string | undefined;
}

export interface HudIcons {
  item(name: string): string | undefined;
  effect(name: string): string | undefined;
}

/** Looks up item and status effect icons in the viewer bundle's textures. */
export function hudIcons(publicDir: string): HudIcons {
  const texturesDir = join(publicDir, 'textures', TEXTURE_VERSION);
  const effect = (name: string) =>
    existsSync(join(texturesDir, 'mob_effect', `${name}.png`)) ? `textures/${TEXTURE_VERSION}/mob_effect/${name}.png` : undefined;
  return { item: itemIcons(publicDir), effect };
}

/** Looks up item icons in the viewer bundle's textures. */
export function itemIcons(publicDir: string): (name: string) => string | undefined {
  const texturesDir = join(publicDir, 'textures', TEXTURE_VERSION);
  const mapping = new Map<string, string>();
  try {
    const entries = JSON.parse(readFileSync(join(texturesDir, 'items_textures.json'), 'utf8')) as {
      name: string;
      texture: unknown;
    }[];
    for (const { name, texture } of entries) {
      if (typeof texture !== 'string') continue;
      // e.g. "minecraft:items/potato", "minecraft:block/spruce_planks", "block/dark_oak_planks"
      const path = texture.replace(/^minecraft:/, '').replace(/^block\//, 'blocks/').replace(/^item\//, 'items/');
      mapping.set(name, path);
    }
  } catch {
    // No mapping: fall back to items/<name>.png only.
  }
  const cache = new Map<string, string | undefined>();
  return (name) => {
    if (!cache.has(name)) {
      const candidates = [`items/${name}`, MODEL_ITEMS.test(name) ? undefined : mapping.get(name)].filter(
        (path) => path !== undefined,
      );
      const found = candidates.find((path) => existsSync(join(texturesDir, `${path}.png`)));
      cache.set(name, found && `textures/${TEXTURE_VERSION}/${found}.png`);
    }
    return cache.get(name);
  };
}

/** When each of the bot's effects was last applied, to count down its duration. */
const effectStarts = new WeakMap<Bot, Map<number, number>>();

function effectStartTimes(bot: Bot): Map<number, number> {
  let starts = effectStarts.get(bot);
  if (!starts) {
    const created = new Map<number, number>();
    bot.on('entityEffect', (entity, effect) => {
      if (entity === bot.entity) created.set(effect.id, Date.now());
    });
    effectStarts.set(bot, created);
    starts = created;
  }
  return starts;
}

/** What the vanilla HUD shows: health, food, armor, XP, the hotbar, offhand and status effects. */
export function hudState(bot: Bot, icons: HudIcons, now = Date.now()): HudState {
  const item = (slot: number): HudItem | null => {
    const stack = bot.inventory.slots[slot];
    return stack ? { name: stack.name, count: stack.count, icon: icons.item(stack.name) } : null;
  };
  const starts = effectStartTimes(bot);
  // Typed as an array, but mineflayer keys it by effect ID.
  const effects = Object.values(bot.entity.effects ?? {}).map((effect): HudEffect => {
    const name = effectName(bot, effect.id) ?? `effect_${effect.id}`;
    if (!starts.has(effect.id)) starts.set(effect.id, now); // applied before the HUD first looked
    const elapsed = (now - (starts.get(effect.id) ?? now)) / 1000;
    return {
      name,
      level: effectLevel(effect.amplifier),
      secondsLeft: effect.duration < 0 ? null : Math.max(0, Math.round(effect.duration / 20 - elapsed)),
      icon: icons.effect(name),
    };
  });
  return {
    health: Math.max(0, Math.round(bot.health)),
    food: Math.max(0, Math.round(bot.food)),
    armor: armorPoints(bot),
    xpLevel: bot.experience.level,
    xpProgress: bot.experience.progress,
    hotbar: Array.from({ length: 9 }, (_, index) => item(HOTBAR_FIRST_SLOT + index)),
    selected: bot.quickBarSlot,
    offhand: item(OFFHAND_SLOT),
    effects,
  };
}

/** The armor attribute: base value plus flat modifiers from worn armor. */
function armorPoints(bot: Bot): number {
  const attributes = (bot.entity as { attributes?: Record<string, { value: number; modifiers?: { amount: number; operation: number }[] }> }).attributes ?? {};
  const armor = Object.entries(attributes).find(([key]) => key.replace(/^minecraft:/, '').replace(/^generic\./, '') === 'armor')?.[1];
  if (!armor) return 0;
  const added = (armor.modifiers ?? []).filter((modifier) => modifier.operation === 0).reduce((sum, modifier) => sum + modifier.amount, 0);
  return Math.max(0, Math.min(20, Math.round(armor.value + added)));
}

/**
 * Script injected into the viewer page that draws a vanilla-style HUD from `GET hud`, using the
 * game's own sprites. Sizes are in GUI pixels at GUI scale 2, as in the game.
 */
export const HUD_SCRIPT = `<style>
  #hud { position: fixed; inset: 0; pointer-events: none; image-rendering: pixelated; font: bold 16px monospace; color: #fff; }
  #hud img, #hud div { position: absolute; }
  #hud .count { text-shadow: 2px 2px 0 #3f3f3f; }
</style>
<div id="hud"></div>
<script>
(() => {
  const S = 2;
  const SPRITES = 'textures/${TEXTURE_VERSION}/gui/sprites/hud/';
  const root = document.getElementById('hud');
  const px = (n) => n * S + 'px';
  const img = (src, x, y, w, h, extra = '') =>
    '<img src="' + src + '" style="left:' + px(x) + ';top:' + px(y) + ';width:' + px(w) + ';height:' + px(h) + ';' + extra + '">';
  const item = (stack, x, y) => {
    if (!stack) return '';
    let html = stack.icon
      ? img(stack.icon, x, y, 16, 16)
      : '<div class="count" style="left:' + px(x) + ';top:' + px(y + 4) + ';font-size:12px">' + stack.name.slice(0, 3) + '</div>';
    if (stack.count > 1) {
      html += '<div class="count" style="left:' + px(x) + ';top:' + px(y + 7) + ';width:' + px(17) + ';text-align:right">' + stack.count + '</div>';
    }
    return html;
  };
  // A row of 10 icons from a 0-20 value, e.g. hearts. rightToLeft for food.
  const row = (value, x, y, empty, full, half, rightToLeft) => {
    let html = '';
    for (let i = 0; i < 10; i++) {
      const left = rightToLeft ? x - i * 8 - 9 : x + i * 8;
      html += img(SPRITES + empty, left, y, 9, 9);
      if (value >= i * 2 + 2) html += img(SPRITES + full, left, y, 9, 9);
      else if (value === i * 2 + 1) html += img(SPRITES + half, left, y, 9, 9);
    }
    return html;
  };
  // First-person hands, drawn flat: the held item at bottom right, the offhand item at bottom
  // left, and the bare arm from the default skin when the main hand is empty.
  const HAND = 84;
  const hands = (hud, width, height) => {
    let html = '';
    const main = hud.hotbar[hud.selected];
    if (main && main.icon) {
      html += img(main.icon, width - HAND - width * 0.12, height - HAND + 8, HAND, HAND, 'transform:scaleX(-1) rotate(-12deg)');
    } else if (!main) {
      // Right arm, front face: 4x12 pixels at (44, 20) in the 64x64 skin, shoulder at the top.
      // Turned so the hand points up and in, from the bottom-right corner.
      const k = 9;
      html += '<div style="left:' + px(width - 4 * k - width * 0.13) + ';top:' + px(height - 12 * k + 40) + ';width:' + px(4 * k) +
        ';height:' + px(12 * k) + ';background:url(textures/1.16.4/entity/steve.png) ' + px(-44 * k) + ' ' + px(-20 * k) + '/' +
        px(64 * k) + ' ' + px(64 * k) + ';transform:rotate(152deg)"></div>';
    }
    if (hud.offhand && hud.offhand.icon) {
      html += img(hud.offhand.icon, width * 0.12, height - HAND + 8, HAND, HAND, 'transform:rotate(-12deg)');
    }
    return html;
  };
  // Status effects in the top right, as in the game, with the time left underneath.
  const effects = (list, width) => {
    let html = '';
    list.forEach((effect, index) => {
      const x = width - 25 * (index + 1);
      html += img(SPRITES + 'effect_background.png', x, 1, 24, 24);
      if (effect.icon) html += img(effect.icon, x + 3, 4, 18, 18);
      if (effect.level) {
        html += '<div class="count" style="left:' + px(x) + ';top:' + px(14) + ';width:' + px(23) + ';text-align:right;font-size:12px">' + effect.level + '</div>';
      }
      const time = effect.secondsLeft === null ? '∞' : Math.floor(effect.secondsLeft / 60) + ':' + String(effect.secondsLeft % 60).padStart(2, '0');
      html += '<div class="count" style="left:' + px(x - 2) + ';top:' + px(26) + ';width:' + px(28) + ';text-align:center;font-size:12px">' + time + '</div>';
    });
    return html;
  };
  const draw = (hud) => {
    const width = innerWidth / S;
    const height = innerHeight / S;
    const left = Math.floor(width / 2 - 91);
    const top = height - 22;
    let html = hands(hud, width, height);
    html += effects(hud.effects, width);
    html += img(SPRITES + 'crosshair.png', width / 2 - 7.5, height / 2 - 7.5, 15, 15);
    html += img(SPRITES + 'hotbar.png', left, top, 182, 22);
    html += img(SPRITES + 'hotbar_selection.png', left - 1 + hud.selected * 20, top - 1, 24, 23);
    hud.hotbar.forEach((stack, index) => (html += item(stack, left + 3 + index * 20, top + 3)));
    if (hud.offhand) {
      html += img(SPRITES + 'hotbar_offhand_left.png', left - 29, top - 1, 29, 24);
      html += item(hud.offhand, left - 26, top + 3);
    }
    html += img(SPRITES + 'experience_bar_background.png', left, height - 29, 182, 5);
    html += '<div style="left:' + px(left) + ';top:' + px(height - 29) + ';width:' + px(Math.round(182 * hud.xpProgress)) +
      ';height:' + px(5) + ';overflow:hidden">' + img(SPRITES + 'experience_bar_progress.png', 0, 0, 182, 5) + '</div>';
    if (hud.xpLevel > 0) {
      html += '<div class="count" style="left:0;width:100%;top:' + px(height - 37) + ';text-align:center;color:#80ff20">' + hud.xpLevel + '</div>';
    }
    html += row(hud.health, left, height - 39, 'heart/container.png', 'heart/full.png', 'heart/half.png', false);
    if (hud.armor > 0) html += row(hud.armor, left, height - 49, 'armor_empty.png', 'armor_full.png', 'armor_half.png', false);
    html += row(hud.food, left + 182, height - 39, 'food_empty.png', 'food_full.png', 'food_half.png', true);
    root.innerHTML = html;
  };
  let last = '';
  setInterval(async () => {
    try {
      const text = await (await fetch('hud')).text();
      if (text === last) return;
      last = text;
      draw(JSON.parse(text));
    } catch {}
  }, 250);
  addEventListener('resize', () => last && draw(JSON.parse(last)));
})();
</script>`;
