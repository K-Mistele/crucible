import { afterEach, describe, expect, it } from 'vite-plus/test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const script = resolve(import.meta.dirname, 'migrate-uuids.py');
const roots: string[] = [];
const old = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const offline = 'b50ad385-829d-3141-a216-7e7d7539ba7f';

async function fixture(layout: 'legacy' | 'paper' = 'legacy') {
  const root = await mkdtemp(join(tmpdir(), 'uuid-migration-'));
  roots.push(root);
  const directories =
    layout === 'paper'
      ? ['players/data', 'players/advancements', 'players/stats']
      : ['playerdata', 'advancements', 'stats'];
  for (const directory of directories)
    await mkdir(join(root, 'world', directory), { recursive: true });
  await writeFile(join(root, 'world', directories[0], `${old}.dat`), 'inventory');
  await writeFile(join(root, 'world', directories[0], `${old}.dat_old`), 'old inventory');
  await writeFile(join(root, 'world', directories[1], `${old}.json`), 'advancements');
  await writeFile(join(root, 'world', directories[2], `${old}.json`), 'stats');
  await writeFile(
    join(root, 'usercache.json'),
    JSON.stringify([{ name: 'Notch', uuid: old, expiresOn: 'soon' }]),
  );
  for (const name of ['ops.json', 'whitelist.json', 'banned-players.json'])
    await writeFile(join(root, name), JSON.stringify([{ uuid: old, name: 'Notch' }]));
  return root;
}

function run(args: string[], env?: Record<string, string>) {
  const result = spawnSync('python3', [script, ...args], {
    env: { ...process.env, ...env },
  });
  return { ...result, exitCode: result.status };
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe('UUID migration tool', () => {
  it('computes the canonical Notch offline UUID', () => {
    expect(run(['--uuid', 'Notch']).stdout.toString().trim()).toBe(offline);
  });

  it('previews without changing files or creating a backup', async () => {
    const root = await fixture();
    const result = run(['--dry-run', '--force', root]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('Dry run');
    expect(await readFile(join(root, 'world/playerdata', `${old}.dat`), 'utf8')).toBe('inventory');
    expect((await readdir(root)).some((name) => name.startsWith('uuid-migration-backup-'))).toBe(
      false,
    );
  });

  it('migrates every player file and UUID-bearing JSON file', async () => {
    const root = await fixture();
    expect(run(['--force', root]).exitCode).toBe(0);
    expect(await readFile(join(root, 'world/playerdata', `${offline}.dat`), 'utf8')).toBe(
      'inventory',
    );
    expect(await readFile(join(root, 'world/playerdata', `${offline}.dat_old`), 'utf8')).toBe(
      'old inventory',
    );
    expect(await readFile(join(root, 'world/advancements', `${offline}.json`), 'utf8')).toBe(
      'advancements',
    );
    expect(await readFile(join(root, 'world/stats', `${offline}.json`), 'utf8')).toBe('stats');
    for (const name of ['usercache.json', 'ops.json', 'whitelist.json', 'banned-players.json']) {
      expect(await readFile(join(root, name), 'utf8')).toContain(offline);
      expect(await readFile(join(root, name), 'utf8')).not.toContain(old);
    }
    expect((await readdir(root)).some((name) => name.startsWith('uuid-migration-backup-'))).toBe(
      true,
    );
  });

  it('auto-detects Paper 26.2 layout and preserves it in the backup', async () => {
    const root = await fixture('paper');
    expect(run(['--force', root]).exitCode).toBe(0);
    expect(await readFile(join(root, 'world/players/data', `${offline}.dat`), 'utf8')).toBe(
      'inventory',
    );
    expect(
      await readFile(join(root, 'world/players/advancements', `${offline}.json`), 'utf8'),
    ).toBe('advancements');
    expect(await readFile(join(root, 'world/players/stats', `${offline}.json`), 'utf8')).toBe(
      'stats',
    );
    const backup = (await readdir(root)).find((name) => name.startsWith('uuid-migration-backup-'))!;
    expect(await readFile(join(root, backup, 'world/players/data', `${old}.dat`), 'utf8')).toBe(
      'inventory',
    );
    expect(
      await readFile(join(root, backup, 'world/players/advancements', `${old}.json`), 'utf8'),
    ).toBe('advancements');
  });

  it('refuses an ambiguous layout before making changes', async () => {
    const root = await fixture('paper');
    await mkdir(join(root, 'world/playerdata'), { recursive: true });
    await writeFile(join(root, 'world/playerdata', `${old}.dat`), 'legacy inventory');
    const result = run(['--force', root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('ambiguous player layout');
    expect(await readFile(join(root, 'world/players/data', `${old}.dat`), 'utf8')).toBe(
      'inventory',
    );
    expect((await readdir(root)).some((name) => name.startsWith('uuid-migration-backup-'))).toBe(
      false,
    );
  });

  it('rejects conflicting duplicate old UUID mappings before making changes', async () => {
    const root = await fixture();
    await writeFile(
      join(root, 'usercache.json'),
      JSON.stringify([
        { name: 'Notch', uuid: old },
        { name: 'jeb_', uuid: old },
      ]),
    );
    const result = run(['--force', root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('conflicting usercache mappings');
    expect(await readFile(join(root, 'world/playerdata', `${old}.dat`), 'utf8')).toBe('inventory');
    expect((await readdir(root)).some((name) => name.startsWith('uuid-migration-backup-'))).toBe(
      false,
    );
  });

  it('rolls back files and JSON after a mid-apply failure', async () => {
    const root = await fixture();
    const originalCache = await readFile(join(root, 'usercache.json'), 'utf8');
    const result = run(['--force', root], { _MIGRATE_UUIDS_TEST_FAIL_AFTER: '5' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('all applied changes were rolled back');
    expect(await readFile(join(root, 'world/playerdata', `${old}.dat`), 'utf8')).toBe('inventory');
    expect(await readFile(join(root, 'world/playerdata', `${old}.dat_old`), 'utf8')).toBe(
      'old inventory',
    );
    expect(await readFile(join(root, 'world/advancements', `${old}.json`), 'utf8')).toBe(
      'advancements',
    );
    expect(await readFile(join(root, 'world/stats', `${old}.json`), 'utf8')).toBe('stats');
    expect(await readFile(join(root, 'usercache.json'), 'utf8')).toBe(originalCache);
    expect(
      (await readdir(join(root, 'world/playerdata'))).some((name) => name.startsWith(offline)),
    ).toBe(false);
  });

  it('is idempotent', async () => {
    const root = await fixture();
    expect(run(['--force', root]).exitCode).toBe(0);
    const second = run(['--force', root]);
    expect(second.exitCode).toBe(0);
    expect(second.stdout.toString()).toContain('Migrating 0 file(s) and update 0 JSON value(s)');
    expect(second.stdout.toString()).toContain('No changes needed');
    expect(await readFile(join(root, 'world/playerdata', `${offline}.dat`), 'utf8')).toBe(
      'inventory',
    );
  });

  it('refuses all changes when a destination collides', async () => {
    const root = await fixture();
    await writeFile(join(root, 'world/playerdata', `${offline}.dat`), 'new login');
    const result = run(['--force', root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('collision detected; nothing was changed');
    expect(await readFile(join(root, 'world/playerdata', `${old}.dat`), 'utf8')).toBe('inventory');
    expect(await readFile(join(root, 'usercache.json'), 'utf8')).toContain(old);
    expect((await readdir(root)).some((name) => name.startsWith('uuid-migration-backup-'))).toBe(
      false,
    );
  });

  it('refuses to run while the minecraft container is running', async () => {
    const root = await fixture();
    const bin = join(root, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'docker'), '#!/bin/sh\necho minecraft\n', { mode: 0o755 });
    await writeFile(join(bin, 'pgrep'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const result = run([root], { PATH: `${bin}:${process.env.PATH}` });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('minecraft container is running');
    expect(await readFile(join(root, 'world/playerdata', `${old}.dat`), 'utf8')).toBe('inventory');
  });

  it('allows a dry run while the minecraft container is running', async () => {
    const root = await fixture();
    const bin = join(root, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'docker'), '#!/bin/sh\necho minecraft\n', { mode: 0o755 });
    await writeFile(join(bin, 'pgrep'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const result = run(['--dry-run', root], { PATH: `${bin}:${process.env.PATH}` });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('Dry run');
    expect(await readFile(join(root, 'world/playerdata', `${old}.dat`), 'utf8')).toBe('inventory');
  });
});
