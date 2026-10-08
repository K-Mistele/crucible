import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { CustomMessageEntryDraft } from '@earendil-works/pi-coding-agent';
import {
  describeState,
  diffState,
  snapshot,
  type BotEvent,
  type BotState,
  type Camera,
  type MinecraftRuntime,
} from '@minecraft-cloud/minecraft-bot';

export const OBSERVATION_TYPE = 'minecraft-observation';

interface Mark {
  /** Last event `seq` included. */
  cursor: number;
  state: BotState | undefined;
}

export interface Observation {
  seq: number;
  draft: CustomMessageEntryDraft;
}

/** The parts of the runtime the observer reads. */
export type ObservedRuntime = Pick<MinecraftRuntime, 'bot' | 'connected' | 'events'>;

interface ContextMessage {
  role: string;
  customType?: string;
  details?: unknown;
}

/**
 * Builds observations: new chat and events, what changed, and a screenshot. Chat and state are
 * marked delivered only once an observation is seen in the conversation, so a dropped observation
 * is rebuilt with the same chat instead of losing it.
 */
export class Observer {
  private delivered: Mark = { cursor: 0, state: undefined };
  private pending: { seq: number; mark: Mark } | undefined;
  private nextSeq = 1;
  private readonly runtime: ObservedRuntime;
  private readonly getCamera: () => Camera | undefined;

  constructor(runtime: ObservedRuntime, getCamera: () => Camera | undefined) {
    this.runtime = runtime;
    this.getCamera = getCamera;
  }

  /** Mark the pending observation delivered if it appears in the conversation. */
  confirm(messages: readonly ContextMessage[]): void {
    const pending = this.pending;
    if (!pending) return;
    const found = messages.some(
      (message) =>
        message.role === 'custom' &&
        message.customType === OBSERVATION_TYPE &&
        (message.details as { seq?: number } | undefined)?.seq === pending.seq,
    );
    if (!found) return;
    this.delivered = pending.mark;
    this.pending = undefined;
    this.runtime.events.trim(this.delivered.cursor);
  }

  /** Whether there is new chat, a new event, or a state change since the last delivery. */
  hasNews(): boolean {
    if (this.runtime.events.since(this.delivered.cursor).length > 0) return true;
    const bot = this.runtime.bot;
    if (!bot || !this.delivered.state) return bot !== undefined;
    return diffState(this.delivered.state, snapshot(bot)).length > 0;
  }

  async build(): Promise<Observation> {
    const events = this.runtime.events.since(this.delivered.cursor);
    const bot = this.runtime.bot;
    const state = bot ? snapshot(bot) : undefined;
    const content: (TextContent | ImageContent)[] = [
      { type: 'text', text: this.describe(events, state, this.delivered.state) },
    ];
    const screenshot = await this.screenshot();
    if (screenshot) content.push(screenshot);

    const seq = this.nextSeq++;
    this.pending = {
      seq,
      mark: { cursor: events.at(-1)?.seq ?? this.delivered.cursor, state: state ?? this.delivered.state },
    };
    return {
      seq,
      draft: { type: 'custom_message', customType: OBSERVATION_TYPE, content, display: true, details: { seq } },
    };
  }

  /** Full state, undelivered chat and a screenshot, without affecting the next observation. */
  async peek(): Promise<{ text: string; screenshot: ImageContent | null }> {
    const events = this.runtime.events.since(this.delivered.cursor);
    const bot = this.runtime.bot;
    return {
      text: this.describe(events, bot ? snapshot(bot) : undefined, undefined),
      screenshot: (await this.screenshot()) ?? null,
    };
  }

  /** Chat, events, and either the changes since `baseline` or the full state when there is none. */
  private describe(events: BotEvent[], state: BotState | undefined, baseline: BotState | undefined): string {
    const sections: string[] = [];
    const chat = events.filter((event) => event.kind === 'chat' || event.kind === 'whisper');
    const other = events.filter((event) => event.kind === 'system' || event.kind === 'event');
    if (chat.length > 0) sections.push(section('Chat', chat.map((event) => event.text)));
    if (other.length > 0) sections.push(section('Events', other.map((event) => event.text)));
    if (state && baseline) {
      const changes = diffState(baseline, state);
      if (changes.length > 0) sections.push(section('Changes', changes));
    } else if (state) {
      sections.push(section('State', describeState(state)));
    }
    if (!this.runtime.connected) sections.push('Not connected to the server; reconnecting automatically.');
    return sections.length === 0 ? 'No changes.' : sections.join('\n\n');
  }

  private async screenshot(): Promise<ImageContent | undefined> {
    const camera = this.getCamera();
    if (!this.runtime.bot || !camera) return undefined;
    try {
      return { type: 'image', data: await camera.capture(), mimeType: 'image/png' };
    } catch {
      return undefined;
    }
  }
}

function section(title: string, lines: string[]): string {
  return [`${title}:`, ...lines.map((line) => `- ${line}`)].join('\n');
}
