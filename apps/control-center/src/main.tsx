import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

type ServerProfile = {
  estimate: string;
  instance: string;
  memory: string;
  note: string;
};

const defaultProfile: ServerProfile = {
  estimate: 'About $30-35/mo',
  instance: 't4g.medium',
  memory: '3G',
  note: 'The checked-in default. A balanced starting point for Paper.',
};

const profiles: Record<string, ServerProfile> = {
  '2-5': {
    estimate: 'About $17-20/mo',
    instance: 't4g.small',
    memory: '2G',
    note: 'Great for a quiet vanilla world. Keep simulation distance at 6-8.',
  },
  '6-12': defaultProfile,
  '13-25': {
    estimate: 'About $65-75/mo',
    instance: 'm7g.large',
    memory: '6G',
    note: 'Use this when loading more chunks, players, or optimization mods.',
  },
};

const deployCommand = 'bun run infra:deploy';

function App() {
  const [players, setPlayers] = useState('6-12');
  const [copied, setCopied] = useState(false);
  const profile = useMemo(() => profiles[players] ?? defaultProfile, [players]);

  const copyDeployCommand = async () => {
    await navigator.clipboard.writeText(deployCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <main>
      <section className="hero">
        <div className="orb orb-one" />
        <div className="orb orb-two" />
        <div className="hero-grid" />
        <nav aria-label="Primary navigation">
          <a className="brand" href="#top" aria-label="Blockline home">
            <span className="brand-mark">B</span>
            BLOCKLINE
          </a>
          <a className="nav-link" href="#launch">
            Operator guide
          </a>
        </nav>

        <div className="hero-content" id="top">
          <p className="eyebrow">Minecraft Java Edition / AWS / Alchemy v2</p>
          <h1>
            Your world,
            <br />
            <em>built to last.</em>
          </h1>
          <p className="hero-copy">
            A small, private Paper server with durable world storage, daily S3 backups, and no open
            SSH port.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#launch">
              Launch checklist
            </a>
            <a className="button button-secondary" href="#architecture">
              Inspect the stack
            </a>
          </div>
        </div>

        <div className="hero-status" aria-label="Server design status">
          <div>
            <span className="status-light" /> Ready to provision
          </div>
          <dl>
            <div>
              <dt>Server</dt>
              <dd>Paper on Docker</dd>
            </div>
            <div>
              <dt>Data</dt>
              <dd>Encrypted EBS</dd>
            </div>
            <div>
              <dt>Recovery</dt>
              <dd>30-day S3 history</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="section architecture" id="architecture">
        <div className="section-heading">
          <p className="eyebrow">A deliberately small footprint</p>
          <h2>One box. The right guardrails.</h2>
        </div>
        <div className="architecture-layout">
          <div className="flow-card">
            <div className="flow-label">Players</div>
            <div className="flow-line" />
            <div className="flow-node flow-node-server">
              <span>EC2</span>
              <strong>Paper server</strong>
              <small>TCP 25565 only</small>
            </div>
            <div className="flow-branch">
              <div className="flow-line vertical" />
              <div className="flow-node flow-node-data">
                <span>EBS</span>
                <strong>World volume</strong>
                <small>encrypted, managed</small>
              </div>
              <div className="flow-node flow-node-backup">
                <span>S3</span>
                <strong>Daily backup</strong>
                <small>versioned, 30 days</small>
              </div>
            </div>
          </div>
          <div className="architecture-notes">
            <article>
              <span>01</span>
              <h3>SSH stays closed</h3>
              <p>
                Use AWS Systems Manager Session Manager for shell access instead of public keys.
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>Your world is separate</h3>
              <p>
                The game data lives on encrypted EBS storage, not inside the disposable container.
              </p>
            </article>
            <article>
              <span>03</span>
              <h3>Backups are automatic</h3>
              <p>
                Alchemy deploys the EC2 setup and a least-privilege role that can only read and
                write its world backups.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="section launch-section" id="launch">
        <div className="section-heading">
          <p className="eyebrow">From keys to connected</p>
          <h2>Launch in four moves.</h2>
        </div>
        <ol className="launch-list">
          <li>
            <span>1</span>
            <div>
              <strong>Install the local tooling</strong>
              <p>
                Install Bun and Vite+, then run <code>bun install</code> at the repository root.
              </p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Connect AWS</strong>
              <p>
                Use AWS SSO or credentials with permission to create EC2, IAM, S3, and VPC
                resources.
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Set player names</strong>
              <p>
                Edit the operator and whitelist arrays in <code>apps/infra/src/settings.ts</code>.
              </p>
            </div>
          </li>
          <li>
            <span>4</span>
            <div>
              <strong>Plan, then deploy</strong>
              <p>Review the resource plan before Alchemy creates anything in your account.</p>
            </div>
          </li>
        </ol>
        <div className="command-row">
          <code>{deployCommand}</code>
          <button type="button" onClick={copyDeployCommand}>
            {copied ? 'Copied' : 'Copy command'}
          </button>
        </div>
      </section>

      <section className="sizing" aria-labelledby="sizing-title">
        <div>
          <p className="eyebrow">Right-size before you deploy</p>
          <h2 id="sizing-title">How many people are building?</h2>
          <p>
            These are directional us-east-1 on-demand estimates for a continuously running server
            plus a 30 GiB gp3 volume. AWS pricing varies by region and usage.
          </p>
        </div>
        <div className="sizing-panel">
          <label htmlFor="player-count">Expected concurrent players</label>
          <select
            id="player-count"
            value={players}
            onChange={(event) => setPlayers(event.target.value)}
          >
            <option value="2-5">2 to 5 players</option>
            <option value="6-12">6 to 12 players</option>
            <option value="13-25">13 to 25 players</option>
          </select>
          <div className="profile-result">
            <span>{profile.estimate}</span>
            <strong>{profile.instance}</strong>
            <small>{profile.memory} Java heap</small>
          </div>
          <p>{profile.note}</p>
        </div>
      </section>

      <footer>
        <span>Blockline</span>
        <span>Infrastructure as code for a world worth keeping.</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
