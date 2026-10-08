import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { MessageRenderer } from '@earendil-works/pi-coding-agent';
import { Box, getCapabilities, Image, Spacer, Text } from '@earendil-works/pi-tui';

const IMAGE_WIDTH_CELLS = 60;

/**
 * Draws an observation in the transcript: its text and, when the terminal can show images, the
 * screenshot the model saw. Pi's default rendering of custom messages shows only the text.
 */
export const renderObservation: MessageRenderer = (message, options, theme) => {
  const content: (TextContent | ImageContent)[] =
    typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
  const box = new Box(options.outputPad, 1, (text) => theme.bg('customMessageBg', text));
  box.addChild(new Text(theme.fg('customMessageLabel', '\x1b[1m⛏ observation\x1b[22m'), 0, 0));
  for (const part of content) {
    box.addChild(new Spacer(1));
    if (part.type === 'text') {
      box.addChild(new Text(theme.fg('customMessageText', part.text), 0, 0));
    } else if (getCapabilities().images) {
      box.addChild(
        new Image(part.data, part.mimeType, { fallbackColor: (text) => theme.fg('muted', text) }, { maxWidthCells: IMAGE_WIDTH_CELLS }),
      );
    } else {
      box.addChild(new Text(theme.fg('muted', '[screenshot: this terminal cannot show images]'), 0, 0));
    }
  }
  return box;
};
