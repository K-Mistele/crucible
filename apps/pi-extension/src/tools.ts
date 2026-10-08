import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from './executor.ts';
import type { Session } from './index.ts';

const common = { exposure: 'codemode', executionMode: 'sequential' } as const;

function requireSession(getSession: () => Session | undefined): Session {
  const session = getSession();
  if (!session) throw new Error('Minecraft is not configured: set MCBOT_HOST and restart Pi');
  return session;
}

const text = (value: string): TextContent => ({ type: 'text', text: value });

export function registerTools(pi: ExtensionAPI, getSession: () => Session | undefined): void {
  pi.registerTool({
    ...common,
    name: 'minecraft_run',
    label: 'Minecraft run',
    description:
      'Run JavaScript against the live Mineflayer bot. The code is the body of an async function with bot, mcData, goals, Vec3, sleep(ms), signal and loadSkill(name) in scope; `return` a small JSON value. Resolves to { result }. On error or timeout the bot is stopped.',
    parameters: Type.Object({
      code: Type.String({ description: 'Body of an async function; use `return` for the result' }),
      timeoutMs: Type.Optional(
        Type.Number({
          description: `Time limit in ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS})`,
        }),
      ),
    }),
    outputSchema: Type.Object({ result: Type.Unknown() }),
    async execute(_toolCallId, params, signal) {
      const session = requireSession(getSession);
      const result = await session.executor.run(params.code, {
        timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal,
      });
      return {
        content: [text(JSON.stringify(result) ?? 'null')],
        structuredContent: { result },
        details: undefined,
      };
    },
  });

  pi.registerTool({
    ...common,
    name: 'minecraft_observe',
    label: 'Minecraft observe',
    description:
      'Current state, recent chat and a first-person screenshot, without acting. Resolves to { text, screenshot }; pass screenshot to image() to view it. Does not consume chat from the next observation.',
    parameters: Type.Object({}),
    outputSchema: Type.Object({
      text: Type.String(),
      screenshot: Type.Union([
        Type.Object({ type: Type.Literal('image'), data: Type.String(), mimeType: Type.String() }),
        Type.Null(),
      ]),
    }),
    async execute() {
      const session = requireSession(getSession);
      const { text: summary, screenshot } = await session.observer.peek();
      const content: (TextContent | ImageContent)[] = [text(summary)];
      if (screenshot) content.push(screenshot);
      const image = screenshot && { type: 'image', data: screenshot.data, mimeType: screenshot.mimeType };
      return { content, structuredContent: { text: summary, screenshot: image }, details: undefined };
    },
  });

  pi.registerTool({
    ...common,
    name: 'minecraft_stop',
    label: 'Minecraft stop',
    description: 'Immediately stop pathfinding, movement, digging and any running minecraft_run. Resolves to { stopped }.',
    parameters: Type.Object({}),
    outputSchema: Type.Object({ stopped: Type.Boolean() }),
    async execute() {
      const session = requireSession(getSession);
      session.executor.stop(session.runtime.bot);
      return { content: [text('Stopped')], structuredContent: { stopped: true }, details: undefined };
    },
  });
}
