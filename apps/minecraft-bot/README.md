# Minecraft bot library

The Mineflayer runtime behind ChameleonBot, used by `apps/pi-extension`. It has no CLI of its own.

- `MinecraftRuntime` keeps one bot connected with offline auth, reconnects with backoff, and loads pathfinder, collectblock, auto-eat and armor-manager.
- `EventBuffer` records chat, whispers, system messages and notable events across reconnects.
- `snapshot`, `describeState` and `diffState` summarize the bot's state and what changed.
- `startViewer` serves a first-person prismarine-viewer page, and `openCamera` screenshots it with headless Chromium.

## Minecraft 26.2 support

Upstream packages don't support 26.2 (protocol 776) yet, so the repo carries it:

- `vendor/minecraft-data` is minecraft-data with upstream's 26.2 data, trimmed to the versions we use. Rebuild it with `node scripts/vendor-minecraft-data.mjs`. The root `package.json` overrides `minecraft-data` to it.
- `patches/` adds 26.2 to mineflayer, minecraft-protocol, prismarine-chunk and prismarine-physics. Bun applies them on install. The physics patch matches the server's float player hitbox, without which the server rejects moves next to blocks.

## Viewer

prismarine-viewer is installed from GitHub, which Bun can't build, so build its browser bundle once after `bun install`:

```bash
bun --cwd apps/minecraft-bot viewer:build
cd apps/minecraft-bot && bunx playwright install chromium
```

It renders with 26.1 textures, with a game-style HUD (hearts, armor, food, XP, hotbar, offhand, status effects, held items, crosshair) drawn over it by `src/hud.ts`. Chests, beds, signs, banners and blocks new in 26.2 don't draw.

## Checks

```bash
bun run bot:test
bun run bot:typecheck
MCBOT_HOST=localhost bun --cwd apps/minecraft-bot smoke   # live, against a running server
```
