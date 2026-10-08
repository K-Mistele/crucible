# ChameleonBot Pi extension

A [Pi](https://github.com/earendil-works/pi) extension that turns Pi into a Minecraft player. The AI controls a Mineflayer bot by running code, sees a screenshot plus new chat and changes after every step, and keeps playing until you pause it. It chats with players and follows instructions from its owner.

## Setup

Needs Node 22.19 or newer and Bun. From the repo root:

```bash
nvm use
bun install
bun --cwd apps/minecraft-bot viewer:build
(cd apps/minecraft-bot && bunx playwright install chromium)
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi install ./apps/pi-extension
```

Pi remembers this folder, so keep the checkout where it is. Then start `pi` once, run `/login` to sign in (for example "OpenAI (ChatGPT subscription)"), and pick a model that accepts images with `/model`.

## Running

Start Pi from the folder where the bot should keep its memory:

```bash
mkdir -p ~/chameleonbot && cd ~/chameleonbot
MCBOT_HOST=<server address> pi
```

The footer shows `⛏ ChameleonBot connected · http://localhost:3007`; open that URL to watch. Type a message or run `/mc-resume` to start it playing.

| Command | What it does |
| --- | --- |
| Esc | Stop now |
| `/mc-pause` | Stop after the current step |
| `/mc-resume` | Start or continue |
| `/mc-status` | Connection and viewer URL |

| Variable | Default | |
| --- | --- | --- |
| `MCBOT_HOST` | required | Server address |
| `MCBOT_PORT` | `25565` | Server port |
| `MCBOT_USERNAME` | `ChameleonBot` | Must be on the server whitelist |
| `MCBOT_OWNER` | `ChameleonOKarma` | The only player it takes instructions from |
| `MCBOT_VIEWER_PORT` | `3007` | Viewer port |
| `MCBOT_AGENT_DIR` | `./minecraft-agent` | Its notes and saved skills |

Each observation in Pi's transcript includes the screenshot the model saw. Pi only draws images in iTerm2, Ghostty, Kitty, WezTerm or Warp, and not inside tmux; elsewhere the screenshot shows as a placeholder line.

Only run one copy per username: two bots with the same name keep kicking each other off.

## Checks

```bash
bun --cwd apps/pi-extension test
bun --cwd apps/pi-extension typecheck
MCBOT_HOST=localhost bun --cwd apps/pi-extension scripts/e2e.ts   # against a local server
```
