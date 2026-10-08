import type { BoundaryState, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { Session } from './index.ts';

export interface LoopOptions {
  getSession: () => Session | undefined;
  /** Called when the paused state changes. */
  onChange?: () => void;
  /** Wait before observing when nothing changed, so an idle bot does not call the model nonstop. */
  idleMs?: number;
  /** While disconnected, wait up to this long for the bot to reconnect before observing. */
  disconnectedWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const POLL_MS = 500;

/**
 * Delivers an observation after every turn and keeps the agent running:
 * - turn_end: after a turn that ran tools, add an observation. Pi calls the model again itself.
 * - agent_before_settle: when the model stopped without a tool call, add an observation and continue.
 */
export function registerLoop(pi: ExtensionAPI, options: LoopOptions): void {
  const { getSession, onChange } = options;
  const idleMs = options.idleMs ?? 2_000;
  const disconnectedWaitMs = options.disconnectedWaitMs ?? 60_000;
  const sleep = options.sleep ?? defaultSleep;

  const observe = async (session: Session, event: BoundaryState) => {
    const observation = await session.observer.build();
    return [...event.entries, observation.draft];
  };

  /** Wait while there is nothing new: briefly when idle, longer while disconnected. */
  const waitForNews = async (session: Session) => {
    if (session.observer.hasNews()) return;
    if (session.runtime.connected) {
      await sleep(idleMs);
      return;
    }
    for (let waited = 0; waited < disconnectedWaitMs && !session.runtime.connected; waited += POLL_MS) {
      if (session.observer.hasNews()) return;
      await sleep(POLL_MS);
    }
  };

  pi.on('turn_end', async (event) => {
    const session = getSession();
    if (!session || session.paused || event.outcome !== 'completed') return;
    if (event.toolResults.length === 0) return; // agent_before_settle handles turns without tools
    session.observer.confirm(event.context.contextMessages);
    return { entries: await observe(session, event) };
  });

  pi.on('agent_before_settle', async (event) => {
    const session = getSession();
    if (!session || session.paused || event.outcome !== 'completed') return;
    session.observer.confirm(event.context.contextMessages);
    await waitForNews(session);
    // The session may have ended or been paused while waiting.
    if (getSession() !== session || session.paused) return;
    return { entries: await observe(session, event), continue: true };
  });

  pi.registerCommand('mc-pause', {
    description: 'Stop the Minecraft loop after the current turn (Esc stops it immediately)',
    handler: async (_args, ctx) => {
      const session = getSession();
      if (!session) return ctx.ui.notify('Minecraft extension is not connected.', 'warning');
      session.paused = true;
      onChange?.();
      ctx.ui.notify('Minecraft loop paused. /mc-resume to continue.', 'info');
    },
  });

  pi.registerCommand('mc-resume', {
    description: 'Start or resume the Minecraft loop with a fresh observation',
    handler: async (_args, ctx) => {
      const session = getSession();
      if (!session) return ctx.ui.notify('Minecraft extension is not connected.', 'warning');
      session.paused = false;
      onChange?.();
      const observation = await session.observer.build();
      const { customType, content, display, details } = observation.draft;
      pi.sendMessage({ customType, content, display, details }, { triggerTurn: true });
    },
  });
}
