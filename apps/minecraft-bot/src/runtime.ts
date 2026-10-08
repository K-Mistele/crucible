import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import minecraftData from 'minecraft-data';
import mineflayer, { type Bot } from 'mineflayer';
import armorManager from 'mineflayer-armor-manager';
import { loader as autoEat } from 'mineflayer-auto-eat';
import { plugin as collectBlock } from 'mineflayer-collectblock';
import pathfinderModule from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { EventBuffer } from './events.ts';

const { goals, Movements, pathfinder } = pathfinderModule;

export { goals, Vec3 };
export type MinecraftData = ReturnType<typeof minecraftData>;

export interface RuntimeConfig {
  host: string;
  port: number;
  username: string;
  version: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const host = env.MCBOT_HOST;
  if (!host) throw new Error('MCBOT_HOST is required');
  const port = Number.parseInt(env.MCBOT_PORT ?? '25565', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MCBOT_PORT must be a valid port');
  }
  return {
    host,
    port,
    username: env.MCBOT_USERNAME ?? 'ChameleonBot',
    version: env.MCBOT_VERSION ?? '26.2',
  };
}

const INITIAL_RECONNECT_MS = 5_000;
const MAX_RECONNECT_MS = 60_000;
// playerJoined fires for everyone already online when the bot joins; ignore that burst.
const JOIN_GRACE_MS = 3_000;

type SpawnListener = (bot: Bot) => void;

/**
 * Keeps one Mineflayer bot connected, reconnecting with backoff, and records chat and notable
 * events into a buffer that outlives individual connections.
 */
export class MinecraftRuntime {
  readonly events = new EventBuffer();
  private current: Bot | undefined;
  private ready = false;
  private closed = false;
  private reconnectDelay = INITIAL_RECONNECT_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private spawnListeners = new Set<SpawnListener>();
  private dataCache: MinecraftData | undefined;

  readonly config: RuntimeConfig;
  private readonly log: (message: string) => void;

  constructor(config: RuntimeConfig, log: (message: string) => void = () => {}) {
    this.config = config;
    this.log = log;
  }

  /** Connects and resolves on first spawn. Later disconnects reconnect automatically. */
  start(): Promise<Bot> {
    return new Promise((resolve) => {
      const onFirstSpawn = (bot: Bot) => {
        this.spawnListeners.delete(onFirstSpawn);
        resolve(bot);
      };
      this.spawnListeners.add(onFirstSpawn);
      this.connect();
    });
  }

  /** The bot, if it is connected and spawned. */
  get bot(): Bot | undefined {
    return this.ready ? this.current : undefined;
  }

  get connected(): boolean {
    return this.ready;
  }

  get mcData(): MinecraftData {
    this.dataCache ??= minecraftData(this.config.version);
    return this.dataCache;
  }

  /** Called on every spawn, including after reconnects. Returns an unsubscribe function. */
  onSpawn(listener: SpawnListener): () => void {
    this.spawnListeners.add(listener);
    if (this.bot) listener(this.bot);
    return () => this.spawnListeners.delete(listener);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    this.ready = false;
    // end() exists from creation; quit() only once plugins load, which may not have happened yet.
    this.current?.end('Harness shutting down');
    this.current = undefined;
  }

  private connect(): void {
    if (this.closed) return;
    const { host, port, username, version } = this.config;
    this.log(`connecting to ${host}:${port} as ${username}`);
    const bot = mineflayer.createBot({ host, port, username, version, auth: 'offline' });
    this.current = bot;
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(collectBlock);
    bot.loadPlugin(autoEat);
    bot.loadPlugin(armorManager);
    this.attachListeners(bot);
  }

  private attachListeners(bot: Bot): void {
    let spawnedAt = 0;
    let disconnected = false;

    bot.once('spawn', () => {
      if (this.closed) return;
      spawnedAt = Date.now();
      this.ready = true;
      this.reconnectDelay = INITIAL_RECONNECT_MS;
      bot.pathfinder.setMovements(new Movements(bot));
      bot.autoEat.enableAuto();
      this.events.push('event', `Connected to ${this.config.host} as ${bot.username}`);
      for (const listener of [...this.spawnListeners]) listener(bot);
    });

    bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      this.events.push('chat', `${username}: ${message}`);
    });
    bot.on('whisper', (username, message) => {
      if (username === bot.username) return;
      this.events.push('whisper', `${username} (whisper): ${message}`);
    });
    bot.on('messagestr', (message, position) => {
      // Player chat arrives through the chat/whisper events; keep server and system messages.
      if (position === 'system' && message.trim()) this.events.push('system', message);
    });
    bot.on('death', () => {
      this.events.push('event', 'You died');
    });
    bot.on('respawn', () => {
      if (spawnedAt) this.events.push('event', 'Respawned');
    });
    bot.on('playerJoined', (player) => {
      if (!spawnedAt || Date.now() - spawnedAt < JOIN_GRACE_MS) return;
      if (player.username !== bot.username) this.events.push('event', `${player.username} joined`);
    });
    bot.on('playerLeft', (player) => {
      if (player.username !== bot.username) this.events.push('event', `${player.username} left`);
    });
    bot.on('goal_reached', () => {
      this.events.push('event', 'Pathfinder reached its goal');
    });
    bot.on('path_update', (result) => {
      if (result.status === 'noPath') this.events.push('event', 'Pathfinder found no path');
      if (result.status === 'timeout') this.events.push('event', 'Pathfinder timed out');
    });

    const onDisconnect = (reason: string) => {
      if (disconnected) return;
      disconnected = true;
      this.ready = false;
      if (this.current === bot) this.current = undefined;
      if (this.closed) return;
      this.events.push('event', `Disconnected: ${reason}. Reconnecting in ${this.reconnectDelay / 1000}s`);
      this.log(`disconnected: ${reason}`);
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_MS);
    };
    bot.on('kicked', (reason) => onDisconnect(`kicked (${stringifyReason(reason)})`));
    bot.on('end', (reason) => onDisconnect(reason || 'connection closed'));
    bot.on('error', (error) => {
      this.log(`bot error: ${error.message}`);
      // Errors before login (e.g. ECONNREFUSED) are not always followed by 'end'.
      if (!this.ready && !disconnected) {
        onDisconnect(error.message);
        bot.end();
      }
    });
  }
}

function stringifyReason(reason: unknown): string {
  return typeof reason === 'string' ? reason : JSON.stringify(reason);
}

/** Absolute paths of the type definitions for the bot and its plugins, for looking up APIs. */
export function apiReferencePaths(): Record<string, string> {
  const require = createRequire(import.meta.url);
  const packageDir = (name: string) => dirname(require.resolve(`${name}/package.json`));
  return {
    mineflayer: join(packageDir('mineflayer'), 'index.d.ts'),
    'mineflayer-pathfinder': join(packageDir('mineflayer-pathfinder'), 'index.d.ts'),
    'mineflayer-collectblock': join(packageDir('mineflayer-collectblock'), 'lib'),
    'mineflayer-auto-eat': join(packageDir('mineflayer-auto-eat'), 'dist'),
  };
}
