import { describe, expect, test } from 'vite-plus/test';
import minecraftData from 'minecraft-data';
import mineflayer from 'mineflayer';

describe('Minecraft 26.2 support', () => {
  test('minecraft-data serves real 26.2 data', () => {
    const data = minecraftData('26.2');
    expect(data.version.version).toBe(776);
    expect(data.version.minecraftVersion).toBe('26.2');
    expect(data.version.majorVersion).toBe('26.2');
    // IDs from the 26.2 server's registries report; 26.1 has player=155 and no cinnabar.
    expect(data.entitiesByName.player?.id).toBe(156);
    expect(data.blocksByName.cinnabar?.id).toBe(1012);
    expect(data.itemsByName.oak_log?.id).toBe(161);
  });

  test('mineflayer accepts 26.2', () => {
    const bot = mineflayer.createBot({
      username: 'ChameleonBot',
      version: '26.2',
      auth: 'offline',
      connect: () => {},
    });
    expect(bot.version).toBe('26.2');
    expect(bot.protocolVersion).toBe(776);
    bot.end();
  });
});

describe('26.2 entity attributes', () => {
  test('attribute IDs follow the 26.2 registry', () => {
    const data = minecraftData('26.2');
    const packet = (data.protocol as any).play.toClient.types.packet_entity_update_attributes;
    const mappings = packet[1][1].type[1].type[1][0].type[1].mappings as Record<string, string>;
    expect(Object.keys(mappings)).toHaveLength(40);
    expect(mappings['0']).toBe('air_drag_modifier');
    expect(mappings['1']).toBe('generic.armor');
    expect(mappings['26']).toBe('generic.movement_speed');
  });
});
