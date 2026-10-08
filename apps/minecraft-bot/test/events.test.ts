import { describe, expect, test } from 'vite-plus/test';
import { EventBuffer } from '../src/events.ts';

describe('EventBuffer', () => {
  test('returns events after a cursor in order', () => {
    const events = new EventBuffer();
    events.push('chat', 'Alex: hi');
    const second = events.push('event', 'Alex joined');
    events.push('whisper', 'Alex (whisper): psst');

    expect(events.since(0).map((event) => event.text)).toEqual([
      'Alex: hi',
      'Alex joined',
      'Alex (whisper): psst',
    ]);
    expect(events.since(second.seq).map((event) => event.text)).toEqual(['Alex (whisper): psst']);
    expect(events.latest).toBe(3);
  });

  test('trim drops delivered events but keeps sequence numbers', () => {
    const events = new EventBuffer();
    events.push('chat', 'a');
    events.push('chat', 'b');
    events.trim(1);
    expect(events.since(0).map((event) => event.seq)).toEqual([2]);
    expect(events.push('chat', 'c').seq).toBe(3);
  });

  test('caps the number of stored events', () => {
    const events = new EventBuffer(2);
    events.push('chat', 'a');
    events.push('chat', 'b');
    events.push('chat', 'c');
    expect(events.since(0).map((event) => event.text)).toEqual(['b', 'c']);
  });
});
