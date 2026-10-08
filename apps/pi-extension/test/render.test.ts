import { afterEach, describe, expect, test } from 'vite-plus/test';
import { resetCapabilitiesCache, setCapabilities } from '@earendil-works/pi-tui';
import { renderObservation } from '../src/render.ts';

// A 1x1 PNG.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text };
const message = {
  role: 'custom',
  customType: 'minecraft-observation',
  content: [
    { type: 'text', text: 'Chat:\n- Alex: hi' },
    { type: 'image', data: PNG, mimeType: 'image/png' },
  ],
  display: true,
  timestamp: 0,
};

const render = () =>
  renderObservation(message as never, { expanded: false, outputPad: 1 }, theme as never)!.render(80).join('\n');

describe('renderObservation', () => {
  afterEach(() => resetCapabilitiesCache());

  test('shows the text and draws the screenshot on terminals with images', () => {
    setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false });
    const output = render();
    expect(output).toContain('Alex: hi');
    expect(output).toContain('\x1b_G'); // Kitty graphics escape
  });

  test('says so when the terminal cannot show images', () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    expect(render()).toContain('[screenshot: this terminal cannot show images]');
  });
});
