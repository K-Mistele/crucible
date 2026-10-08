import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  apiReferencePaths,
  configFromEnv,
  goals,
  MinecraftRuntime,
  openCamera,
  startViewer,
  Vec3,
  type Camera,
  type RuntimeConfig,
  type Viewer,
} from '@minecraft-cloud/minecraft-bot';
import { Executor } from './executor.ts';
import { registerLoop } from './loop.ts';
import { Observer } from './observer.ts';
import { minecraftPrompt } from './prompt.ts';
import { registerTools } from './tools.ts';

const STATUS_KEY = 'minecraft';
const NOTES = ['current-task.md', 'players.md', 'world.md', 'lessons.md'];

/** Everything that exists for one Pi session. Recreated on /new, /reload, resume and fork. */
export interface Session {
  config: RuntimeConfig;
  owner: string;
  agentDir: string;
  runtime: MinecraftRuntime;
  executor: Executor;
  observer: Observer;
  viewer: Viewer | undefined;
  camera: Camera | undefined;
  paused: boolean;
}

export default function minecraftExtension(pi: ExtensionAPI): void {
  let session: Session | undefined;
  let statusContext: ExtensionContext | undefined;

  const setStatus = (text: string) => statusContext?.ui.setStatus(STATUS_KEY, text);
  const describeStatus = (current: Session) => {
    const connection = current.runtime.connected ? 'connected' : 'connecting';
    const loop = current.paused ? ', paused' : '';
    const view = current.viewer ? ` · ${current.viewer.url}` : '';
    return `⛏ ${current.config.username} ${connection}${loop}${view}`;
  };

  registerTools(pi, () => session);
  registerLoop(pi, {
    getSession: () => session,
    onChange: () => {
      if (session) setStatus(describeStatus(session));
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    statusContext = ctx;
    let config: RuntimeConfig;
    try {
      config = configFromEnv();
    } catch {
      ctx.ui.notify('Minecraft extension: set MCBOT_HOST (and optionally MCBOT_PORT) to connect.', 'warning');
      return;
    }

    const agentDir = resolve(ctx.cwd, process.env.MCBOT_AGENT_DIR ?? 'minecraft-agent');
    await mkdir(join(agentDir, 'notes'), { recursive: true });
    await mkdir(join(agentDir, 'skills'), { recursive: true });
    for (const note of NOTES) {
      // 'wx' leaves existing notes untouched.
      await writeFile(join(agentDir, 'notes', note), '', { flag: 'wx' }).catch(() => {});
    }

    const runtime = new MinecraftRuntime(config);
    const current: Session = {
      config,
      owner: process.env.MCBOT_OWNER ?? 'ChameleonOKarma',
      agentDir,
      runtime,
      executor: new Executor(() => {
        const bot = runtime.bot;
        return bot && { bot, mcData: runtime.mcData, goals, Vec3 };
      }, join(agentDir, 'skills')),
      observer: new Observer(runtime, () => current.camera),
      viewer: undefined,
      camera: undefined,
      paused: false,
    };
    session = current;

    // Code mode is how the model reaches the Minecraft tools.
    const active = pi.getActiveTools();
    if (!active.includes('codemode')) pi.setActiveTools([...active, 'codemode']);

    setStatus(describeStatus(current));
    runtime.onSpawn((bot) => {
      void (async () => {
        try {
          if (!current.viewer) {
            current.viewer = await startViewer(bot, { port: Number(process.env.MCBOT_VIEWER_PORT ?? 3007) });
            current.camera = await openCamera(current.viewer.url);
          } else {
            current.viewer.setBot(bot);
            await current.camera?.reload();
          }
        } catch (error) {
          ctx.ui.notify(`Minecraft viewer unavailable: ${String(error)}`, 'warning');
        }
        if (session !== current) {
          // The session ended while the viewer was starting.
          await current.camera?.close().catch(() => {});
          await current.viewer?.close().catch(() => {});
          return;
        }
        setStatus(describeStatus(current));
      })();
    });
    // Connecting can take a while or wait for the server; do not block the session on it.
    void runtime.start();
  });

  pi.on('session_shutdown', async () => {
    const current = session;
    session = undefined;
    statusContext?.ui.setStatus(STATUS_KEY, undefined);
    statusContext = undefined;
    if (!current) return;
    current.executor.stop(current.runtime.bot);
    current.runtime.close();
    await current.camera?.close().catch(() => {});
    await current.viewer?.close().catch(() => {});
  });

  pi.on('before_agent_start', (event) => {
    if (!session) return;
    event.systemPromptOptions.sections.minecraft = minecraftPrompt({
      username: session.config.username,
      owner: session.owner,
      agentDir: session.agentDir,
      viewerUrl: session.viewer?.url,
      apiReferences: apiReferencePaths(),
    });
  });

  pi.registerCommand('mc-status', {
    description: 'Show the Minecraft bot connection, viewer URL and loop state',
    handler: async (_args, ctx) => {
      ctx.ui.notify(session ? describeStatus(session) : 'Minecraft extension is not connected (set MCBOT_HOST).', 'info');
    },
  });
}
