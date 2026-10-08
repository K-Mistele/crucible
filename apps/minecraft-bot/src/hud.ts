import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bot } from 'mineflayer';

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

/** What the vanilla HUD shows: health, food, armor, XP and the hotbar. */
export function hudState(bot: Bot, icon: (name: string) => string | undefined): HudState {
  const item = (slot: number): HudItem | null => {
    const stack = bot.inventory.slots[slot];
    return stack ? { name: stack.name, count: stack.count, icon: icon(stack.name) } : null;
  };
  return {
    health: Math.max(0, Math.round(bot.health)),
    food: Math.max(0, Math.round(bot.food)),
    armor: armorPoints(bot),
    xpLevel: bot.experience.level,
    xpProgress: bot.experience.progress,
    hotbar: Array.from({ length: 9 }, (_, index) => item(HOTBAR_FIRST_SLOT + index)),
    selected: bot.quickBarSlot,
    offhand: item(OFFHAND_SLOT),
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
  const draw = (hud) => {
    const width = innerWidth / S;
    const height = innerHeight / S;
    const left = Math.floor(width / 2 - 91);
    const top = height - 22;
    let html = img(SPRITES + 'crosshair.png', width / 2 - 7.5, height / 2 - 7.5, 15, 15);
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
