export type Difficulty = 'easy' | 'normal' | 'hard' | 'peaceful';
export type GameMode = 'adventure' | 'creative' | 'spectator' | 'survival';

export interface MinecraftSettings {
  allowFlight: boolean;
  difficulty: Difficulty;
  gameMode: GameMode;
  maxPlayers: number;
  memory: `${number}G`;
  motd: string;
  onlineMode: boolean;
  ops: string[];
  pvp: boolean;
  seed?: string;
  simulationDistance: number;
  version: string;
  viewDistance: number;
  whitelist: string[];
  whitelistEnabled: boolean;
}

export const minecraftSettings: MinecraftSettings = {
  allowFlight: false,
  difficulty: 'normal',
  gameMode: 'survival',
  maxPlayers: 12,
  memory: '3G',
  motd: "Kyle's cloud Minecraft server",
  onlineMode: true,
  ops: [],
  pvp: true,
  seed: '-4995054936707021313',
  simulationDistance: 8,
  version: '26.2',
  viewDistance: 10,
  whitelist: [],
  whitelistEnabled: false,
};

export const validateMinecraftSettings = (settings: MinecraftSettings): void => {
  if (!/^\d+G$/.test(settings.memory)) {
    throw new Error('Minecraft memory must be expressed as whole GiB, for example "3G".');
  }

  if (
    !Number.isInteger(settings.maxPlayers) ||
    settings.maxPlayers < 1 ||
    settings.maxPlayers > 100
  ) {
    throw new Error('Minecraft maxPlayers must be an integer from 1 through 100.');
  }

  for (const [name, value] of [
    ['simulationDistance', settings.simulationDistance],
    ['viewDistance', settings.viewDistance],
  ] as const) {
    if (!Number.isInteger(value) || value < 3 || value > 32) {
      throw new Error(`Minecraft ${name} must be an integer from 3 through 32.`);
    }
  }

  if (!/^[A-Za-z0-9._-]+$/.test(settings.version)) {
    throw new Error(
      'Minecraft version may contain only letters, numbers, periods, underscores, and hyphens.',
    );
  }

  for (const player of [...settings.ops, ...settings.whitelist]) {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(player)) {
      throw new Error(`Invalid Minecraft player name: ${player}`);
    }
  }
};
