import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const REMINDER = 'Reminder: your notes have not changed in a while. Rewrite notes/current-task.md to match what you are doing now, and add anything new you learned to the other notes.';

export interface NotesReminderOptions {
  /** How long the notes can go unchanged, and how often to remind. */
  intervalMs?: number;
  now?: () => number;
}

/**
 * Returns a function that yields a reminder to update the notes when no file in `notesDir` has
 * changed for `intervalMs`, at most once per interval.
 */
export function notesReminder(notesDir: string, options: NotesReminderOptions = {}) {
  const intervalMs = options.intervalMs ?? 10 * 60_000;
  const now = options.now ?? Date.now;
  let lastReminder = now();

  return async (): Promise<string | undefined> => {
    const time = now();
    if (time - lastReminder < intervalMs) return undefined;
    const files = await readdir(notesDir).catch(() => [] as string[]);
    const modified = await Promise.all(
      files.map((file) => stat(join(notesDir, file)).then((info) => info.mtimeMs, () => 0)),
    );
    if (time - Math.max(0, ...modified) < intervalMs) return undefined;
    lastReminder = time;
    return REMINDER;
  };
}
