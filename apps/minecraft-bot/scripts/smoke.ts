// Live check against a real server: connect, start the viewer, take a screenshot, print state.
//   MCBOT_HOST=localhost MCBOT_PORT=25599 bun run smoke [out.png]
import { writeFileSync } from 'node:fs';
import { configFromEnv, describeState, MinecraftRuntime, openCamera, snapshot, startViewer } from '../src/index.ts';

const out = process.argv[2] ?? 'smoke.png';
const runtime = new MinecraftRuntime(configFromEnv(), (message) => console.log(`[runtime] ${message}`));
const bot = await runtime.start();
console.log(`spawned as ${bot.username}, version ${bot.version}, protocol ${bot.protocolVersion}`);
console.log(describeState(snapshot(bot)).join('\n'));

const viewer = await startViewer(bot);
console.log(`viewer at ${viewer.url}`);
const camera = await openCamera(viewer.url);
await new Promise((resolve) => setTimeout(resolve, 3000));
const png = Buffer.from(await camera.capture(), 'base64');
writeFileSync(out, png);
console.log(`screenshot: ${out} (${png.length} bytes)`);

bot.chat('smoke test');
await new Promise((resolve) => setTimeout(resolve, 1000));
console.log('events:', runtime.events.since(0).map((event) => event.text));

await camera.close();
await viewer.close();
runtime.close();
process.exit(0);
