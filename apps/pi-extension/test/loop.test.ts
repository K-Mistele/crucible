import { describe, expect, test } from 'vite-plus/test';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { Session } from '../src/index.ts';
import { registerLoop } from '../src/loop.ts';
import { delivered, fakeRuntime, observerFor } from './fakes.ts';

type Handler = (event: unknown, ctx?: unknown) => Promise<unknown>;

function setup() {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, Handler>();
  const sent: { message: unknown; options: unknown }[] = [];
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: (name: string, options: { handler: Handler }) => commands.set(name, options.handler),
    sendMessage: (message: unknown, options: unknown) => sent.push({ message, options }),
  } as unknown as ExtensionAPI;

  const runtime = fakeRuntime();
  const session = { runtime, observer: observerFor(runtime), paused: false } as unknown as Session;
  const sleeps: number[] = [];
  registerLoop(pi, {
    getSession: () => session,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  const notifications: string[] = [];
  const ctx = { ui: { notify: (message: string) => notifications.push(message) } };
  return {
    runtime,
    session,
    sleeps,
    sent,
    turnEnd: (event: object) => handlers.get('turn_end')!(event),
    beforeSettle: (event: object) => handlers.get('agent_before_settle')!(event),
    command: (name: string) => commands.get(name)!('', ctx),
  };
}

const boundary = (overrides: object = {}) => ({
  entries: [{ type: 'custom', customType: 'other' }],
  continue: false,
  outcome: 'completed',
  context: { contextMessages: [] },
  toolResults: [],
  ...overrides,
});

type Result = { entries: { customType: string; details?: { seq: number } }[]; continue?: boolean } | undefined;

describe('observation loop', () => {
  test('turn_end adds an observation after a turn that ran tools, keeping earlier entries', async () => {
    const { turnEnd } = setup();
    const result = (await turnEnd(boundary({ toolResults: [{}] }))) as Result;
    expect(result?.entries.map((entry) => entry.customType)).toEqual(['other', 'minecraft-observation']);
    expect(result?.continue).toBeUndefined();
  });

  test('turn_end does nothing for a turn without tool calls', async () => {
    const { turnEnd } = setup();
    expect(await turnEnd(boundary())).toBeUndefined();
  });

  test('turn_end does nothing for aborted turns', async () => {
    const { turnEnd } = setup();
    expect(await turnEnd(boundary({ toolResults: [{}], outcome: 'aborted' }))).toBeUndefined();
  });

  test('agent_before_settle adds an observation and continues', async () => {
    const { beforeSettle, sleeps } = setup();
    const result = (await beforeSettle(boundary())) as Result;
    expect(result?.continue).toBe(true);
    expect(result?.entries.at(-1)?.customType).toBe('minecraft-observation');
    expect(sleeps).toEqual([]); // the first observation is news
  });

  test('agent_before_settle waits before observing an idle bot', async () => {
    const { beforeSettle, sleeps } = setup();
    const first = (await beforeSettle(boundary())) as Result;
    const seq = first!.entries.at(-1)!.details!.seq;
    await beforeSettle(boundary({ context: { contextMessages: [delivered(seq)] } }));
    expect(sleeps).toEqual([2000]);
  });

  test('does not wait when chat arrived', async () => {
    const { beforeSettle, runtime, sleeps } = setup();
    const first = (await beforeSettle(boundary())) as Result;
    runtime.events.push('chat', 'Alex: hi');
    await beforeSettle(boundary({ context: { contextMessages: [delivered(first!.entries.at(-1)!.details!.seq)] } }));
    expect(sleeps).toEqual([]);
  });

  test('paused loop neither observes nor continues; resume restarts it', async () => {
    const { beforeSettle, turnEnd, command, session, sent } = setup();
    await command('mc-pause');
    expect(session.paused).toBe(true);
    expect(await beforeSettle(boundary())).toBeUndefined();
    expect(await turnEnd(boundary({ toolResults: [{}] }))).toBeUndefined();

    await command('mc-resume');
    expect(session.paused).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.options).toEqual({ triggerTurn: true });
  });
});
