import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { JsonValue } from '@earendil-works/pi-ai';
import type { Bot, goals, MinecraftData, Vec3 } from '@minecraft-cloud/minecraft-bot';

export interface Bindings {
  bot: Bot;
  mcData: MinecraftData;
  goals: typeof goals;
  Vec3: typeof Vec3;
}

export interface RunOptions {
  timeoutMs: number;
  /** Abort from the caller, e.g. the user pressing Esc. */
  signal?: AbortSignal | undefined;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;
export const MAX_RESULT_CHARS = 20_000;

const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;

type CompiledCode = (...args: unknown[]) => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => CompiledCode;

const PARAMETERS = ['bot', 'mcData', 'goals', 'Vec3', 'sleep', 'signal', 'loadSkill'];

/** Stop everything the bot might be doing: pathing, movement keys, digging, item use. */
export function stopBot(bot: Bot): void {
  const attempts = [
    () => bot.pathfinder.stop(),
    () => bot.pathfinder.setGoal(null),
    () => bot.clearControlStates(),
    () => bot.stopDigging(),
    () => bot.deactivateItem(),
  ];
  for (const attempt of attempts) {
    try {
      attempt();
    } catch {
      // Each step is best effort; e.g. stopDigging throws when not digging.
    }
  }
}

/**
 * Runs agent-written JavaScript against the live bot, one execution at a time, with a timeout and
 * cancellation. This is not a sandbox: code runs with the same permissions as the Pi process.
 */
export class Executor {
  private active: AbortController | undefined;
  private readonly getBindings: () => Bindings | undefined;
  private readonly skillsDir: string;

  constructor(getBindings: () => Bindings | undefined, skillsDir: string) {
    this.getBindings = getBindings;
    this.skillsDir = skillsDir;
  }

  get busy(): boolean {
    return this.active !== undefined;
  }

  async run(code: string, options: RunOptions): Promise<JsonValue> {
    if (this.active) throw new Error('Another minecraft_run is still executing');
    const bindings = this.getBindings();
    if (!bindings) throw new Error('Not connected to the Minecraft server');

    let compiled: CompiledCode;
    try {
      compiled = new AsyncFunction(...PARAMETERS, code);
    } catch (error) {
      throw new Error(`Syntax error: ${errorMessage(error)}`);
    }

    const controller = new AbortController();
    this.active = controller;
    const timeoutMs = Math.min(Math.max(options.timeoutMs, 1), MAX_TIMEOUT_MS);
    const timer = setTimeout(
      () => controller.abort(new Error(`Timed out after ${timeoutMs}ms; the bot was stopped`)),
      timeoutMs,
    );
    const onCallerAbort = () => controller.abort(new Error('Cancelled; the bot was stopped'));
    options.signal?.addEventListener('abort', onCallerAbort, { once: true });
    if (options.signal?.aborted) onCallerAbort();

    const { signal } = controller;
    const sleep = (ms: number) => abortableSleep(ms, signal);
    const loadSkill = (name: string) => this.loadSkill(name, bindings, signal);
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });

    try {
      const result = await Promise.race([
        compiled(bindings.bot, bindings.mcData, bindings.goals, bindings.Vec3, sleep, signal, loadSkill),
        aborted,
      ]);
      return toJsonValue(result);
    } catch (error) {
      stopBot(bindings.bot);
      throw error instanceof Error ? error : new Error(errorMessage(error));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onCallerAbort);
      if (!signal.aborted) controller.abort(new Error('Execution finished'));
      this.active = undefined;
    }
  }

  /** Cancel the running execution, if any, and stop the bot. Returns whether one was running. */
  stop(bot: Bot | undefined): boolean {
    const wasRunning = this.active !== undefined;
    this.active?.abort(new Error('Stopped by minecraft_stop'));
    if (bot) stopBot(bot);
    return wasRunning;
  }

  private async loadSkill(name: string, bindings: Bindings, signal: AbortSignal) {
    if (!SKILL_NAME.test(name)) {
      throw new Error(`Invalid skill name "${name}": use lowercase letters, digits and dashes`);
    }
    const path = join(this.skillsDir, `${name}.ts`);
    const { mtimeMs } = await stat(path).catch(() => {
      throw new Error(`No skill named "${name}" at ${path}`);
    });
    // The mtime query makes edits to the file load fresh instead of from the module cache.
    const module = (await import(`${pathToFileURL(path).href}?v=${mtimeMs}`)) as {
      run?: (context: unknown) => unknown;
    };
    if (typeof module.run !== 'function') throw new Error(`Skill "${name}" must export run()`);
    const run = module.run;
    return (args: Record<string, unknown> = {}) =>
      run({ ...bindings, sleep: (ms: number) => abortableSleep(ms, signal), signal, ...args });
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Convert a return value into plain JSON: vectors become {x, y, z}, cycles and functions are
 * dropped, and output over MAX_RESULT_CHARS is truncated.
 */
export function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  const seen = new WeakSet<object>();
  const json = JSON.stringify(value, function replacer(_key, current: unknown) {
    if (typeof current === 'bigint') return current.toString();
    if (typeof current === 'function' || typeof current === 'symbol') return undefined;
    if (current && typeof current === 'object') {
      if (isVector(current)) return { x: current.x, y: current.y, z: current.z };
      if (seen.has(current)) return '[Circular]';
      seen.add(current);
      if (current instanceof Map) return Object.fromEntries(current);
      if (current instanceof Set) return [...current];
    }
    return current;
  });
  if (json === undefined) return null;
  if (json.length > MAX_RESULT_CHARS) {
    return {
      truncated: true,
      totalChars: json.length,
      preview: json.slice(0, MAX_RESULT_CHARS),
      hint: 'Return a smaller value: select only the fields you need.',
    };
  }
  return JSON.parse(json) as JsonValue;
}

function isVector(value: object): value is { x: number; y: number; z: number } {
  return (
    value.constructor?.name === 'Vec3' &&
    'x' in value &&
    'y' in value &&
    'z' in value
  );
}
