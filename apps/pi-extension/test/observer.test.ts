import { describe, expect, test } from 'vite-plus/test';
import { delivered, fakeBot, fakeRuntime, observerFor } from './fakes.ts';

const textOf = (content: unknown) =>
  (content as { type: string; text?: string }[]).find((part) => part.type === 'text')?.text;

describe('Observer', () => {
  test('first observation is a full baseline with a screenshot', async () => {
    const runtime = fakeRuntime();
    const observation = await observerFor(runtime).build();
    const content = observation.draft.content as { type: string }[];
    expect(textOf(content)).toContain('State:\n- Position: (0.0, 64.0, 0.0) in overworld');
    expect(content.some((part) => part.type === 'image')).toBe(true);
    expect(observation.draft.details).toEqual({ seq: 1 });
  });

  test('later observations contain only chat and changes', async () => {
    const runtime = fakeRuntime();
    const observer = observerFor(runtime);
    const first = await observer.build();
    observer.confirm([delivered(first.seq)]);

    runtime.bot = fakeBot({ x: 5, food: 19, items: [{ name: 'oak_log', count: 2 }] });
    runtime.events.push('chat', 'ChameleonOKarma: ChameleonBot, bring those logs back here');
    const second = await observer.build();
    expect(textOf(second.draft.content)).toBe(
      [
        'Chat:\n- ChameleonOKarma: ChameleonBot, bring those logs back here',
        'Changes:\n- Position: (0.0, 64.0, 0.0) → (5.0, 64.0, 0.0)\n- Hunger: 20 → 19\n- Inventory: oak_log 0 → 2',
      ].join('\n\n'),
    );
  });

  test('says "No changes." when nothing happened', async () => {
    const runtime = fakeRuntime();
    const observer = observerFor(runtime);
    observer.confirm([delivered((await observer.build()).seq)]);
    expect(observer.hasNews()).toBe(false);
    expect(textOf((await observer.build()).draft.content)).toBe('No changes.');
  });

  test('re-sends chat when an observation never reached the conversation', async () => {
    const runtime = fakeRuntime();
    const observer = observerFor(runtime);
    observer.confirm([delivered((await observer.build()).seq)]);

    runtime.events.push('chat', 'Alex: hello');
    await observer.build(); // dropped: never confirmed
    observer.confirm([]);
    const retry = await observer.build();
    expect(textOf(retry.draft.content)).toBe('Chat:\n- Alex: hello');

    observer.confirm([delivered(retry.seq)]);
    expect(textOf((await observer.build()).draft.content)).toBe('No changes.');
  });

  test('reports disconnection and skips the screenshot', async () => {
    const runtime = fakeRuntime();
    runtime.bot = undefined;
    runtime.connected = false;
    runtime.events.push('event', 'Disconnected: server closed. Reconnecting in 5s');
    const observation = await observerFor(runtime).build();
    const content = observation.draft.content as { type: string }[];
    expect(textOf(content)).toBe(
      'Events:\n- Disconnected: server closed. Reconnecting in 5s\n\nNot connected to the server; reconnecting automatically.',
    );
    expect(content.some((part) => part.type === 'image')).toBe(false);
  });

  test('peek does not consume chat', async () => {
    const runtime = fakeRuntime();
    const observer = observerFor(runtime);
    observer.confirm([delivered((await observer.build()).seq)]);
    runtime.events.push('chat', 'Alex: hi');
    expect((await observer.peek()).text).toContain('Chat:\n- Alex: hi');
    expect(textOf((await observer.build()).draft.content)).toContain('Alex: hi');
  });
});
