import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vite-plus/test';
import { notesReminder } from '../src/notes.ts';

const MINUTE = 60_000;

async function notesDir(modifiedAt: number) {
  const dir = await mkdtemp(join(tmpdir(), 'notes-'));
  const file = join(dir, 'current-task.md');
  await writeFile(file, '# Current task');
  await utimes(file, modifiedAt / 1000, modifiedAt / 1000);
  return { dir, file };
}

describe('notesReminder', () => {
  test('reminds once the notes are stale, then waits another interval', async () => {
    let now = Date.now();
    const { dir } = await notesDir(now - 30 * MINUTE);
    const reminder = notesReminder(dir, { intervalMs: 10 * MINUTE, now: () => now });

    expect(await reminder()).toBeUndefined(); // not right at session start
    now += 10 * MINUTE;
    expect(await reminder()).toContain('notes/current-task.md');
    now += 5 * MINUTE;
    expect(await reminder()).toBeUndefined();
    now += 5 * MINUTE;
    expect(await reminder()).toContain('notes/current-task.md');
  });

  test('stays quiet while the notes are being updated', async () => {
    let now = Date.now();
    const { dir, file } = await notesDir(now);
    const reminder = notesReminder(dir, { intervalMs: 10 * MINUTE, now: () => now });
    now += 10 * MINUTE;
    await utimes(file, (now - MINUTE) / 1000, (now - MINUTE) / 1000);
    expect(await reminder()).toBeUndefined();
  });
});
