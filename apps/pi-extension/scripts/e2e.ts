// End-to-end check of the extension inside a real Pi session, against a live server.
// Pi's scripted "faux" model plays the agent; a second bot plays the owner and chats.
//
//   MCBOT_HOST=localhost MCBOT_PORT=25599 bun scripts/e2e.ts [screenshot-dir]
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import {
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { configFromEnv, MinecraftRuntime } from '@minecraft-cloud/minecraft-bot';
import minecraftExtension from '../src/index.ts';

const screenshotDir = process.argv[2];
const owner = 'ChameleonOKarma';
const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// The owner: joins, walks away a bit, and replies when ChameleonBot greets.
const ownerRuntime = new MinecraftRuntime({ ...configFromEnv(), username: owner });
const ownerBot = await ownerRuntime.start();
ownerBot.on('chat', (username, message) => {
  if (username === 'ChameleonBot' && message.includes('hello from ChameleonBot')) {
    setTimeout(() => ownerBot.chat('ChameleonBot, come here'), 500);
  }
});
ownerBot.setControlState('forward', true);
await new Promise((resolve) => setTimeout(resolve, 1500));
ownerBot.clearControlStates();

// Scripted model.
const faux = createFauxCore({
  provider: 'faux',
  api: 'faux',
  models: [{ id: 'scripted', input: ['text', 'image'], contextWindow: 200_000, maxTokens: 8000 }],
});
const fauxExtension = (pi: ExtensionAPI) => {
  pi.registerProvider('faux', {
    baseUrl: 'http://localhost',
    apiKey: 'unused',
    api: 'faux',
    streamSimple: faux.streamSimple,
    models: [
      {
        id: 'scripted',
        name: 'Scripted',
        reasoning: false,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 8000,
      },
    ],
  });
};

type Part = { type: string; text?: string; data?: string };
const observations = (context: TranscriptContext) =>
  context.messages
    .filter((message) => message.role === 'user' && Array.isArray(message.content))
    .map((message) => message.content as Part[])
    .filter((content) => content.some((part) => part.text?.match(/^(State|Chat|Events|Changes):|^No changes\./)));
const lastToolResult = (context: TranscriptContext) => {
  const message = context.messages.findLast((candidate) => candidate.role === 'toolResult');
  return (message?.content as Part[] | undefined)?.map((part) => part.text ?? '').join('\n') ?? '';
};
const codemode = (code: string) => fauxAssistantMessage(fauxToolCall('codemode', { code }), { stopReason: 'toolUse' });
let settleStarted = 0;
let lastObservationCount = 0;
const observationTimes: number[] = [];

const agentDir = await mkdtemp(join(tmpdir(), 'minecraft-agent-'));
process.env.MCBOT_AGENT_DIR = agentDir;

faux.setResponses([
  // 1. Act: greet and report.
  (context) => {
    // The system prompt and tool declarations travel as system messages.
    const system = JSON.stringify(context.messages.filter((message) => (message.role as string) === 'system'));
    check('system prompt has the Minecraft section', system.includes('<minecraft>'));
    check('codemode lists minecraft_run', system.includes('minecraft_run('));
    return codemode(`
      const r = await tools.minecraft_run({ code: "bot.chat('hello from ChameleonBot'); return { health: bot.health, version: bot.version, pos: bot.entity.position, tool: typeof bot.tool?.equipForBlock, collect: typeof bot.collectBlock?.collect, autoEat: typeof bot.autoEat?.eat }" });
      return r;
    `);
  },
  // 2. Read the result, then stop without a tool call (exercises agent_before_settle).
  (context) => {
    const result = lastToolResult(context);
    check('minecraft_run returned structured result to the script', /"health":\d/.test(result), result.slice(0, 300));
    check('plugins loaded (tool, collectBlock, autoEat)', /"tool":"function".*"collect":"function".*"autoEat":"function"/s.test(result));
    check('turn_end added an observation after the tool turn', observations(context).length === 1);
    lastObservationCount = observations(context).length;
    settleStarted = Date.now();
    return fauxAssistantMessage(fauxText('Waiting for instructions.'));
  },
  // 3. The settle observation should carry the owner's chat and a screenshot; follow the owner.
  async (context) => {
    observationTimes.push(Date.now() - settleStarted);
    const all = observations(context);
    check('agent_before_settle continued with a new observation', all.length === lastObservationCount + 1);
    const text = all.flat().map((part) => part.text ?? '').join('\n');
    check('owner chat delivered in an observation', text.includes(`${owner}: ChameleonBot, come here`));
    const image = all.at(-1)?.find((part) => part.type === 'image');
    check('observation includes a screenshot', Boolean(image?.data && image.data.length > 10_000));
    if (screenshotDir && image?.data) await writeFile(join(screenshotDir, 'e2e-observation.png'), Buffer.from(image.data, 'base64'));
    return codemode(`
      const r = await tools.minecraft_run({ code: \`
        const player = bot.players['${owner}']?.entity;
        if (!player) return { found: false };
        const before = bot.entity.position.distanceTo(player.position);
        bot.pathfinder.setGoal(new goals.GoalFollow(player, 1), true);
        await sleep(4000);
        return { found: true, before, after: bot.entity.position.distanceTo(player.position) };
      \` });
      await tools.minecraft_run({ code: "bot.chat('on my way'); return true" });
      return r;
    `);
  },
  // 4. Following worked? Then check the timeout path stops the bot.
  (context) => {
    const result = lastToolResult(context);
    const match = /"before":([\d.]+),"after":([\d.]+)/.exec(result);
    check(
      'pathfinder GoalFollow moves toward the owner',
      // Walking covers ~4 blocks/s; require clear progress rather than arrival.
      Boolean(match && (Number(match[1]) - Number(match[2]) >= 3 || Number(match[2]) <= 3)),
      result.slice(0, 200),
    );
    const latest = observations(context).at(-1)?.map((part) => part.text ?? '').join('\n') ?? '';
    check('observation reports the position change', latest.includes('Position:'), latest.slice(0, 300));
    return codemode(`
      await tools.minecraft_stop({});
      try {
        await tools.minecraft_run({ code: "bot.setControlState('forward', true); while (true) await sleep(100)", timeoutMs: 1000 });
        return 'no timeout';
      } catch (error) {
        const moving = await tools.minecraft_run({ code: "return bot.controlState.forward" });
        return { error: String(error), stillMoving: moving.result };
      }
    `);
  },
  // 5. Save a skill with the write tool and load it.
  (context) => {
    const result = lastToolResult(context);
    check('timeout stops the bot', result.includes('Timed out') && result.includes('"stillMoving":false'), result.slice(0, 300));
    return codemode(`
      await tools.write({ path: ${JSON.stringify(join(agentDir, 'skills', 'report.ts'))}, content: "export async function run({ bot, label }) { return label + ':' + Math.round(bot.health); }\\n" });
      const r = await tools.minecraft_run({ code: "const run = await loadSkill('report'); return await run({ label: 'hp' })" });
      return r;
    `);
  },
  // 6. Idle: the settle hook should wait ~2s before observing.
  (context) => {
    check('agent-written skill loads and runs', /"hp:\d+"/.test(lastToolResult(context)), lastToolResult(context).slice(0, 200));
    settleStarted = Date.now();
    return fauxAssistantMessage(fauxText('Nothing to do.'));
  },
  // 7. Finish the run.
  (context) => {
    const waited = Date.now() - settleStarted;
    check('idle observation waits about 2s', waited >= 1800, `${waited}ms`);
    const latest = observations(context).at(-1)?.map((part) => part.text ?? '').join('\n') ?? '';
    check('idle observation reports only what changed', !latest.includes('State:'), latest.slice(0, 200));
    return fauxAssistantMessage(fauxText('stopping'), { stopReason: 'aborted' });
  },
]);

const cwd = process.cwd();
const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir,
  extensionFactories: [createCodemodeExtension({ mode: 'on' }), fauxExtension, minecraftExtension],
});
await resourceLoader.reload();
const settingsManager = SettingsManager.inMemory();
const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null });
const { session } = await createAgentSession({
  cwd,
  agentDir,
  resourceLoader,
  settingsManager,
  modelRuntime,
  sessionManager: SessionManager.inMemory(),
});
await session.bindExtensions({});
const model = modelRuntime.getModel('faux', 'scripted');
if (!model) throw new Error('faux model not registered');
await session.setModel(model);

// Wait for ChameleonBot to join, then give the viewer and camera time to start.
for (let i = 0; i < 60 && !ownerBot.players.ChameleonBot; i++) {
  await new Promise((resolve) => setTimeout(resolve, 500));
}
await new Promise((resolve) => setTimeout(resolve, 8000));

const started = Date.now();
await session.prompt('Start playing.');
console.log(`run finished in ${Date.now() - started}ms; model calls: ${faux.state.callCount}`);
check('every scripted step ran', faux.getPendingResponseCount() === 0, `${faux.getPendingResponseCount()} left`);

session.dispose();
ownerRuntime.close();
await new Promise((resolve) => setTimeout(resolve, 1000));
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
