import { describe, expect, it } from 'vite-plus/test';

import { minecraftSettings } from '../src/settings.ts';
import { createMinecraftUserData } from '../src/user-data.ts';

describe('createMinecraftUserData', () => {
  it('creates a locked-down Paper server with daily S3 backups', () => {
    const userData = createMinecraftUserData({
      backupBucketName: 'minecraft-backups-123456789012-us-east-1',
      settings: {
        ...minecraftSettings,
        ops: ['CloudCrafter'],
        whitelist: ['CloudCrafter'],
      },
    });

    expect(userData).toContain('TYPE=PAPER');
    expect(userData).toContain('VERSION="${MINECRAFT_VERSION}"');
    expect(userData).toContain('itzg/minecraft-server:java25');
    expect(userData).toContain('dnf -y install awscli docker openssl util-linux zstd');
    expect(userData).not.toContain('awscli2');
    expect(userData).toContain('MINECRAFT_ENFORCE_WHITELIST=FALSE');
    expect(userData).toContain('ENFORCE_WHITELIST="${MINECRAFT_ENFORCE_WHITELIST}"');
    expect(userData).toContain('OnCalendar=*-*-* 04:17:00 UTC');
    expect(userData).toContain('minecraft-backups-123456789012-us-east-1');
    expect(userData).not.toContain('-p 25575:25575');
  });

  it('rejects unsafe server settings before creating cloud infrastructure', () => {
    expect(() =>
      createMinecraftUserData({
        backupBucketName: 'minecraft-backups-123456789012-us-east-1',
        settings: {
          ...minecraftSettings,
          memory: '3072M' as '3G',
        },
      }),
    ).toThrow('Minecraft memory');
  });
});
