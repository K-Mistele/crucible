import { createHash } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';

export interface CameraOptions {
  width?: number;
  height?: number;
  /** Longest time to wait for the rendered frame to stop changing. */
  settleMs?: number;
}

export interface Camera {
  /** A PNG of the bot's current first-person view, base64-encoded. */
  capture(): Promise<string>;
  /** Reload the viewer page, e.g. after the bot reconnects. */
  reload(): Promise<void>;
  close(): Promise<void>;
}

const SETTLE_POLL_MS = 250;

/** Keeps a headless Chromium page open on the viewer and screenshots it on demand. */
export async function openCamera(url: string, options: CameraOptions = {}): Promise<Camera> {
  const { width = 1280, height = 720, settleMs = 1500 } = options;
  const browser: Browser = await chromium.launch({
    // Software WebGL, so rendering works without a GPU.
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page: Page = await browser.newPage({ viewport: { width, height } });
  page.on('dialog', (dialog) => void dialog.dismiss());

  const load = async () => {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 15_000 });
  };
  await load();

  // The whole page, so the HUD drawn over the canvas is included.
  const shoot = () => page.screenshot({ type: 'png' });
  const hash = (buffer: Buffer) => createHash('sha1').update(buffer).digest('hex');

  return {
    async capture() {
      // Wait until two consecutive frames match, so movement and chunk meshing have landed.
      let frame = await shoot();
      const deadline = Date.now() + settleMs;
      while (Date.now() < deadline) {
        await page.waitForTimeout(SETTLE_POLL_MS);
        const next = await shoot();
        const same = hash(next) === hash(frame);
        frame = next;
        if (same) break;
      }
      return frame.toString('base64');
    },
    async reload() {
      await load();
    },
    async close() {
      await browser.close();
    },
  };
}
