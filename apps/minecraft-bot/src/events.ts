export type EventKind = 'chat' | 'whisper' | 'system' | 'event';

export interface BotEvent {
  seq: number;
  time: number;
  kind: EventKind;
  text: string;
}

/**
 * Ordered record of chat and notable events. Consumers keep a cursor (the last `seq` they
 * delivered) and read everything after it, so nothing is lost between observations.
 */
export class EventBuffer {
  private events: BotEvent[] = [];
  private nextSeq = 1;

  private readonly maxEvents: number;

  constructor(maxEvents = 1000) {
    this.maxEvents = maxEvents;
  }

  push(kind: EventKind, text: string, time = Date.now()): BotEvent {
    const event = { seq: this.nextSeq++, time, kind, text };
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    return event;
  }

  /** Events with `seq` greater than `cursor`. */
  since(cursor: number): BotEvent[] {
    return this.events.filter((event) => event.seq > cursor);
  }

  /** The `seq` of the newest event, or 0 if none were recorded. */
  get latest(): number {
    return this.nextSeq - 1;
  }

  /** Drop events at or before `cursor`; they have been delivered. */
  trim(cursor: number): void {
    this.events = this.events.filter((event) => event.seq > cursor);
  }
}
