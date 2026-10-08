// Builds vendor/minecraft-data: minecraft-data 3.117.0 plus Minecraft Java 26.2 data, trimmed to
// the versions this repo uses: Java 26.2, the 26.1 data it builds on, and 1.16.2, which
// prismarine-viewer reads biome tints from.
//
// minecraft-data has no 26.2 release yet. The 26.2 files come from the upstream `pc_26_2` branch,
// which was checked against the registries and block states reported by the 26.2 server jar. The
// branch's protocol.json predates master's 26.1 protocol fixes, so protocol.json comes from the
// open PR that carries those fixes over (PrismarineJS/minecraft-data#1333).
//
//   node scripts/vendor-minecraft-data.mjs
//
// Replace vendor/minecraft-data with the npm release once one includes 26.2.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_VERSION = '3.117.0';
const DATA_26_2 = 'https://raw.githubusercontent.com/PrismarineJS/minecraft-data/68ea7b5/data/pc/26.2';
const PR_1333 = 'https://raw.githubusercontent.com/0xmthan/minecraft-data/4005723728fe00435209ebdd2234e9fb1184a184/data/pc';
const PROTOCOL_26_2 = `${PR_1333}/26.2/protocol.json`;
// Same as 3.117.0's apart from listing 26.2.
const VERSIONS = `${PR_1333}/common/versions.json`;
// The data kinds 26.2 changes (pc/26.2 in upstream dataPaths.json); the rest are shared with 26.1.
const FILES_26_2 = [
  'attributes', 'biomes', 'blockCollisionShapes', 'blockLoot', 'blocks', 'commands', 'entities',
  'entityLoot', 'foods', 'items', 'language', 'loginPacket', 'materials', 'particles', 'protocol',
  'recipes', 'sounds', 'tints', 'version',
];
// Versions kept from the published package. 26.2 is added on top of 26.1.
const KEEP_VERSIONS = ['1.16.2', '26.1'];

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'vendor', 'minecraft-data');
const work = mkdtempSync(join(tmpdir(), 'vendor-minecraft-data-'));

const download = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
};

// 1. The published package.
execFileSync('npm', ['pack', `minecraft-data@${BASE_VERSION}`, '--silent'], { cwd: work });
execFileSync('tar', ['xzf', `minecraft-data-${BASE_VERSION}.tgz`], { cwd: work });
const source = join(work, 'package');
const dataDir = join(source, 'minecraft-data', 'data');

// 2. The 26.2 files.
mkdirSync(join(dataDir, 'pc', '26.2'), { recursive: true });
for (const file of FILES_26_2) {
  const url = file === 'protocol' ? PROTOCOL_26_2 : `${DATA_26_2}/${file}.json`;
  writeFileSync(join(dataDir, 'pc', '26.2', `${file}.json`), await download(url));
}
writeFileSync(join(dataDir, 'pc', 'common', 'versions.json'), await download(VERSIONS));

// 3. data.js with only the kept versions. 26.2 starts from 26.1 and switches the files it changes.
const dataJs = readFileSync(join(source, 'data.js'), 'utf8');
const entryFor = (version) => {
  const escaped = version.replaceAll('.', '\\.');
  const entry = dataJs.match(new RegExp(` {4}'${escaped}': \\{\\n[\\s\\S]*?\\n {4}\\}`))?.[0];
  if (!entry) throw new Error(`${version} entry not found in data.js`);
  return entry;
};
const kept = KEEP_VERSIONS.map(entryFor);
let entry26_2 = entryFor('26.1').replace("'26.1':", "'26.2':");
for (const file of FILES_26_2) {
  const getter = new RegExp(`(get ${file} \\(\\) \\{ return require\\(")[^"]+(")`);
  if (!getter.test(entry26_2)) throw new Error(`26.1 has no ${file} getter`);
  entry26_2 = entry26_2.replace(getter, `$1./minecraft-data/data/pc/26.2/${file}.json$2`);
}
const entries = [...kept, entry26_2].join(',\n');
const trimmedDataJs = `module.exports =\n{\n  'pc': {\n${entries}\n  },\n  'bedrock': {}\n}\n`;

// 4. Copy the code and only the data files that the kept versions and index.js reference.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const path of ['index.js', 'index.d.ts', 'lib', 'README.md']) {
  cpSync(join(source, path), join(out, path), { recursive: true });
}
writeFileSync(join(out, 'data.js'), trimmedDataJs);
const referenced = new Set(
  [...entries.matchAll(/require\("\.\/(minecraft-data\/data\/[^"]+)"\)/g)].map((match) => match[1]),
);
referenced.add('minecraft-data/data/pc/latest/proto.yml');
for (const path of referenced) {
  mkdirSync(dirname(join(out, path)), { recursive: true });
  cpSync(join(source, path), join(out, path));
}
for (const path of ['minecraft-data/schemas', 'minecraft-data/data/pc/common', 'minecraft-data/data/bedrock/common']) {
  cpSync(join(source, path), join(out, path), { recursive: true });
}

const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
delete manifest.scripts;
delete manifest.devDependencies;
manifest.description = `${manifest.description} (vendored: Java ${[...KEEP_VERSIONS, '26.2'].join(', ')} only, see scripts/vendor-minecraft-data.mjs)`;
writeFileSync(join(out, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
rmSync(work, { recursive: true, force: true });
console.log(`Wrote ${out}`);
