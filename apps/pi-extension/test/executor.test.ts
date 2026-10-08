import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vite-plus/test';
import { goals, Vec3, type Bot } from '@minecraft-cloud/minecraft-bot';
import { Executor, MAX_RESULT_CHARS, toJsonValue, type Bindings } from '../src/executor.ts';

function fakeBot() {
  const calls: string[] = [];
  const bot = {
    health: 20,
    pathfinder: {
      stop: () => calls.push('pathfinder.stop'),
      setGoal: (goal: unknown) => calls.push(`setGoal:${String(goal)}`),
    },
    clearControlStates: () => calls.push('clearControlStates'),
    stopDigging: () => {
      throw new Error('not digging');
    },
    deactivateItem: () => calls.push('deactivateItem'),
  };
  return { bot: bot as unknown as Bot, calls };
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(connected = true) {
  const { bot, calls } = fakeBot();
  const skillsDir = await mkdtemp(join(tmpdir(), 'skills-'));
  dirs.push(skillsDir);
  const bindings: Bindings = { bot, mcData: {} as Bindings['mcData'], goals, Vec3 };
  const executor = new Executor(() => (connected ? bindings : undefined), skillsDir);
  return { executor, calls, skillsDir };
}

describe('Executor', () => {
  test('returns the value of the code', async () => {
    const { executor } = await setup();
    expect(await executor.run('await sleep(1); return { health: bot.health }', { timeoutMs: 1000 })).toEqual({
      health: 20,
    });
  });

  test('rejects syntax errors without running', async () => {
    const { executor } = await setup();
    await expect(executor.run('return {', { timeoutMs: 1000 })).rejects.toThrow(/Syntax error/);
  });

  test('stops the bot when the code throws', async () => {
    const { executor, calls } = await setup();
    await expect(executor.run('throw new Error("boom")', { timeoutMs: 1000 })).rejects.toThrow('boom');
    expect(calls).toEqual(['pathfinder.stop', 'setGoal:null', 'clearControlStates', 'deactivateItem']);
  });

  test('times out, stops the bot and aborts sleep', async () => {
    const { executor, calls } = await setup();
    const started = Date.now();
    await expect(executor.run('while (true) await sleep(10)', { timeoutMs: 50 })).rejects.toThrow(/Timed out/);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(calls).toContain('clearControlStates');
    expect(executor.busy).toBe(false);
  });

  test('cancels when the caller aborts', async () => {
    const { executor } = await setup();
    const controller = new AbortController();
    const run = executor.run('await sleep(5000)', { timeoutMs: 10_000, signal: controller.signal });
    controller.abort();
    await expect(run).rejects.toThrow(/Cancelled/);
  });

  test('stop() cancels the running execution', async () => {
    const { executor } = await setup();
    const run = executor.run('await sleep(5000)', { timeoutMs: 10_000 });
    expect(executor.stop(undefined)).toBe(true);
    await expect(run).rejects.toThrow(/minecraft_stop/);
  });

  test('allows only one execution at a time', async () => {
    const { executor } = await setup();
    const first = executor.run('await sleep(50); return 1', { timeoutMs: 1000 });
    await expect(executor.run('return 2', { timeoutMs: 1000 })).rejects.toThrow(/still executing/);
    expect(await first).toBe(1);
  });

  test('fails when not connected', async () => {
    const { executor } = await setup(false);
    await expect(executor.run('return 1', { timeoutMs: 1000 })).rejects.toThrow(/Not connected/);
  });

  test('loads skills from the skills directory', async () => {
    const { executor, skillsDir } = await setup();
    await writeFile(
      join(skillsDir, 'double-health.ts'),
      'export async function run({ bot, factor }: { bot: { health: number }; factor: number }) { return bot.health * factor; }\n',
    );
    expect(
      await executor.run("const run = await loadSkill('double-health'); return await run({ factor: 2 })", {
        timeoutMs: 5000,
      }),
    ).toBe(40);
  });

  test('rejects skill names that could leave the skills directory', async () => {
    const { executor } = await setup();
    await expect(executor.run("return await loadSkill('../secret')", { timeoutMs: 1000 })).rejects.toThrow(
      /Invalid skill name/,
    );
  });
});

describe('toJsonValue', () => {
  test('converts vectors, drops functions and marks cycles', () => {
    const value: Record<string, unknown> = { position: new Vec3(1, 2, 3), fn: () => 1 };
    value.self = value;
    expect(toJsonValue(value)).toEqual({ position: { x: 1, y: 2, z: 3 }, self: '[Circular]' });
  });

  test('turns undefined into null', () => {
    expect(toJsonValue(undefined)).toBeNull();
  });

  test('truncates large values', () => {
    const result = toJsonValue('x'.repeat(MAX_RESULT_CHARS + 10)) as { truncated: boolean };
    expect(result.truncated).toBe(true);
  });
});
