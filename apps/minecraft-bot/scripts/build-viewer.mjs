// Builds prismarine-viewer's browser bundle (public/) for Minecraft 26.2 with 26.1 textures.
//
// The viewer is installed from a GitHub commit because its 26.1 support is not on npm. Bun does not
// install devDependencies for a git dependency's `prepare` script, so the bundle is never built. This
// copies the installed package, installs its build dependencies with npm, applies the repo's 26.2
// support (vendored minecraft-data and patches/), and builds 26.1 textures, the newest the viewer has.
// The output goes to `.viewer/public`, which `src/viewer.ts` serves.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(appDir, '.viewer');
const buildDir = join(outDir, 'build');
const publicDir = join(outDir, 'public');
const force = process.argv.includes('--force');

if (existsSync(join(publicDir, 'worker.js')) && !force) {
  console.log(`Viewer already built at ${publicDir} (use --force to rebuild)`);
  process.exit(0);
}

const require = createRequire(join(appDir, 'package.json'));
const sourceDir = dirname(require.resolve('prismarine-viewer/package.json'));

const run = (command, args) => {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: buildDir, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
};

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
cpSync(sourceDir, buildDir, {
  recursive: true,
  dereference: true,
  filter: (path) => !relative(sourceDir, path).startsWith('node_modules'),
});

// Only 26.1 textures are built; 26.x versions use them, with their own block data.
writeFileSync(
  join(buildDir, 'viewer/lib/version.js'),
  [
    "const supportedVersions = ['26.1']",
    'function getVersion (version) {',
    "  return supportedVersions.includes(version) ? version : (/^26\\./.test(version) ? '26.1' : null)",
    '}',
    'module.exports = { getVersion, supportedVersions }',
    '',
  ].join('\n'),
);

// Keep only the devDependencies the build needs; the rest (jest, puppeteer, headless gl) are for
// the viewer's own tests and pull in native modules that fail to build on newer Node versions.
const manifestPath = join(buildDir, 'package.json');
const manifest = require(manifestPath);
const buildDependencies = ['assert', 'buffer', 'canvas', 'fs-extra', 'minecraft-assets', 'process', 'webpack', 'webpack-cli'];
manifest.devDependencies = Object.fromEntries(
  buildDependencies.map((name) => [name, manifest.devDependencies[name]]),
);
delete manifest.scripts;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock']);
run('npm', ['rebuild', 'canvas']);

// The browser parses chunks and meshes blocks with the same libraries as the bot, so give the
// bundle the same 26.2 support: the vendored minecraft-data and the repo's patches.
const repoDir = dirname(dirname(appDir));
for (const copy of findPackages(join(buildDir, 'node_modules'), 'minecraft-data')) {
  rmSync(copy, { recursive: true, force: true });
  cpSync(join(repoDir, 'vendor', 'minecraft-data'), copy, { recursive: true });
}
for (const patch of readdirSync(join(repoDir, 'patches'))) {
  const name = patch.slice(0, patch.lastIndexOf('@'));
  for (const copy of findPackages(join(buildDir, 'node_modules'), name)) {
    run('patch', ['-p1', '--forward', '-d', copy, '-i', join(repoDir, 'patches', patch)]);
  }
}
run('node', ['viewer/prerender.js', '-f']);

// Players and mobs are drawn with the viewer's built-in 1.16.4 entity models, which load their
// textures from textures/1.16.4/entity. Prerender only copies textures for supportedVersions (26.1),
// so without this every entity renders as a plain white shape.
const buildRequire = createRequire(join(buildDir, 'package.json'));
const entityTextures = join(buildRequire('minecraft-assets')('1.16.4').directory, 'entity');
cpSync(entityTextures, join(buildDir, 'public', 'textures', '1.16.4', 'entity'), { recursive: true });
run('npx', ['webpack']);

rmSync(publicDir, { recursive: true, force: true });
cpSync(join(buildDir, 'public'), publicDir, { recursive: true });
rmSync(buildDir, { recursive: true, force: true });
console.log(`Viewer built at ${publicDir}`);

/** Every installed copy of a package under node_modules, including nested ones. */
function findPackages(nodeModules, name) {
  const found = [];
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    const candidate = join(dir, name);
    if (existsSync(join(candidate, 'package.json'))) found.push(candidate);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const scoped = entry.name.startsWith('@') ? readdirSync(join(dir, entry.name)).map((child) => join(dir, entry.name, child)) : [join(dir, entry.name)];
      for (const packageDir of scoped) visit(join(packageDir, 'node_modules'));
    }
  };
  visit(nodeModules);
  return found;
}
