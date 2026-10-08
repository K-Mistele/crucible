/// <reference path="./prismarine-viewer.d.ts" />
import compression from 'compression';
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bot } from 'mineflayer';
import { WorldView } from 'prismarine-viewer/viewer/lib/worldView.js';
import { Server, type Socket } from 'socket.io';

/** Browser bundle built by `scripts/build-viewer.mjs`. */
export const VIEWER_PUBLIC_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), '.viewer', 'public');

export interface ViewerOptions {
  port?: number;
  viewDistance?: number;
}

export interface Viewer {
  url: string;
  /** Point the viewer at a new bot, e.g. after a reconnect. Connected browsers are reloaded. */
  setBot(bot: Bot): void;
  close(): Promise<void>;
}

/**
 * First-person web viewer for the bot. Based on prismarine-viewer's lib/mineflayer.js, serving the
 * locally built bundle and supporting a bot that changes across reconnects.
 */
export async function startViewer(initialBot: Bot, options: ViewerOptions = {}): Promise<Viewer> {
  const { port = 3007, viewDistance = 6 } = options;
  if (!existsSync(join(VIEWER_PUBLIC_DIR, 'worker.js'))) {
    throw new Error(
      `Viewer bundle missing at ${VIEWER_PUBLIC_DIR}. Run: bun --cwd apps/minecraft-bot viewer:build`,
    );
  }

  let bot = initialBot;
  let session = 1;
  const app = express();
  app.use(compression());
  // The bundled client cannot re-initialize for a new bot, so pages reload when the session changes.
  const indexHtml = readFileSync(join(VIEWER_PUBLIC_DIR, 'index.html'), 'utf8').replace(
    '</body>',
    `<script>
      let session;
      setInterval(async () => {
        try {
          const next = await (await fetch('session')).text();
          if (session !== undefined && next !== session) location.reload();
          session = next;
        } catch {}
      }, 2000);
    </script></body>`,
  );
  app.get('/', (_request, response) => {
    response.type('html').send(indexHtml);
  });
  app.get('/session', (_request, response) => {
    response.type('text').send(String(session));
  });
  app.use(express.static(VIEWER_PUBLIC_DIR));
  const http = createServer(app);
  const io = new Server(http);
  const detachers = new Map<Socket, () => void>();

  const attach = (socket: Socket) => {
    const current = bot;
    socket.emit('version', current.version);
    const worldView = new WorldView(current.world, viewDistance, current.entity.position, socket);
    void worldView.init(current.entity.position);
    const sendPosition = () => {
      const { position, yaw, pitch } = current.entity;
      socket.emit('position', { pos: position, yaw, pitch, addMesh: true });
      void worldView.updatePosition(position);
    };
    current.on('move', sendPosition);
    worldView.listenToBot(current);
    sendPosition();
    detachers.set(socket, () => {
      current.removeListener('move', sendPosition);
      worldView.removeListenersFromBot(current);
    });
  };

  io.on('connection', (socket) => {
    attach(socket);
    socket.on('disconnect', () => {
      detachers.get(socket)?.();
      detachers.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, '127.0.0.1', () => resolve());
  });
  const { port: boundPort } = http.address() as AddressInfo;

  return {
    url: `http://localhost:${boundPort}`,
    setBot(next) {
      if (next === bot) return;
      bot = next;
      session += 1;
      for (const [socket, detach] of detachers) {
        detach();
        socket.disconnect(true);
      }
      detachers.clear();
    },
    async close() {
      for (const detach of detachers.values()) detach();
      detachers.clear();
      await io.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
