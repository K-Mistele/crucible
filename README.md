# Blockline Minecraft Server

An AWS Minecraft Java server managed entirely by Alchemy v2. The server runs
Paper in Docker on EC2, keeps its world on an encrypted EBS volume, and
writes a daily compressed backup to a private versioned S3 bucket.

The repository is a Bun workspace with Vite+, Oxlint, and a small operator guide
in `apps/control-center`.

## Why AWS

This starter intentionally chooses AWS EC2 rather than the cheapest possible
VM provider. Alchemy v2 has first-class AWS resources for the complete path this
server needs: a VPC, security group, EC2, IAM instance profile, EBS, S3, and an
S3-backed state store. It also provides Session Manager access without opening
SSH. For a small social server, Hetzner or a managed Minecraft host can cost
less, but this stack is designed for an infrastructure-as-code workflow with no
provider-specific console setup after credentials are configured.

The checked-in default is `t4g.medium` (2 ARM vCPUs, 4 GiB RAM) with a 3 GiB
Java heap. It is a practical Paper baseline for roughly 6-12 concurrent players.
Use a larger non-burstable `m7g.large` for heavier worlds, mods, or 13+ regular
players. As a directional US East estimate, expect roughly $30-35/month for the
default instance, 30 GiB gp3 volume, public IPv4, and small backup storage.
Confirm current regional prices in the AWS Pricing Calculator before deploying.

## Quick Start

1. Install Bun 1.3+ and Vite+ (`curl -fsSL https://vite.plus | bash`), then run
   `bun install`.
2. Copy `.env.example` to `.env` and choose an AWS region. Do not commit `.env`.
3. Authenticate AWS with an IAM Identity Center / SSO profile or environment
   credentials. The deploy identity needs permission to manage EC2, VPC, IAM,
   and S3 resources in the selected account.
4. Optionally add your Minecraft username to `ops` in
   `apps/infra/src/settings.ts` for operator permissions.
5. Store an Alchemy AWS profile with `bun run infra:login`, then review
   `bun run infra:prod:plan` and deploy with `bun run infra:prod:deploy`.

Alchemy creates its encrypted, versioned remote state bucket automatically. No
Terraform state, SSH key pair, manual provisioning step, Docker installation,
or console-created resource is required.

## Connect And Operate

After deployment, Alchemy prints `connect` as the Java Edition address and `url`
as a `minecraft://` address. Java Edition uses the `connect` value in the
Multiplayer server-address field. Both use the EC2 public address and can change
when the instance is replaced; use the latest deployment output or attach DNS
after the first deploy if you need a stable name.

There is no inbound SSH rule. Open a shell through Session Manager using the
printed `ssmCommand` (the local AWS CLI Session Manager plugin is required):

```bash
aws ssm start-session --target i-xxxxxxxxxxxxxxxxx
```

The Alchemy-defined instance provisioning creates the following systemd units.
Useful commands inside the session are:

```bash
sudo systemctl status minecraft
sudo journalctl -u minecraft -f
sudo systemctl restart minecraft
sudo systemctl start minecraft-backup.service
sudo systemctl list-timers minecraft-backup.timer
docker exec minecraft rcon-cli save-all flush
```

## Backups And Recovery

The EC2 role can only list the backup bucket and read/write objects under its
`world/` prefix. It cannot delete backups. S3 versioning is enabled, current
archives expire after 30 days, and noncurrent versions expire after 7 days.

To restore a backup from a Session Manager shell, stop the server first, then
replace the world data:

```bash
sudo systemctl stop minecraft
aws s3 ls "s3://<printed-backup-bucket>/world/"
aws s3 cp "s3://<printed-backup-bucket>/world/<timestamp>.tar.zst" - | \
  sudo tar --zstd -C /srv/minecraft -xvf -
sudo systemctl start minecraft
```

`destroy` deletes the entire application, including compute, networking, the
world volume, and every versioned backup object. The backup bucket is configured
with `forceDestroy` so Alchemy empties it before deletion. This is convenient for
test deployments but means `destroy` permanently deletes world data.

## Configuration

`apps/infra/src/settings.ts` contains the gameplay configuration sent to the
[`itzg/minecraft-server`](https://docker-minecraft-server.readthedocs.io/) image.
Changing that file changes the Alchemy `AWS.EC2.Instance` resource's generated
`userData`. Alchemy replaces the immutable EC2 instance; the still-managed EBS
world volume is reattached and the game server starts with the updated Docker
environment.

`apps/infra/src/alchemy.run.ts` declares the AWS resources and passes generated
`userData` to the EC2 resource. `apps/infra/src/user-data.ts` generates that
cloud-init configuration: it installs Docker, mounts the Alchemy-created volume,
starts Paper, and schedules backups. This is part of the Alchemy application,
not a separate provisioning package or a manually maintained server.

Important defaults:

- Paper, Java 25 image, and pinned Minecraft `26.2`, the current Java Edition
  release when this configuration was updated. Every player should select Java
  Edition `26.2` in the launcher before joining.
- `onlineMode` enabled; no RCON port exposed publicly. Set `whitelistEnabled`
  in `apps/infra/src/settings.ts` to `true` if you later want to restrict
  access to named players.
- TCP `25565` is the only allowed inbound port; Java Edition does not need UDP.
- Daily backups at 04:17 UTC; adjust the systemd timer in
  `apps/infra/src/user-data.ts` if needed.

Update the Minecraft version deliberately, test a copy of the world, and take a
manual backup before a major-version upgrade.

## Development

```bash
bun run dev
bun run check
bun run test
bun run build
```

`bun run dev` starts the Vite operator guide. `bun run infra:plan` and
`bun run infra:deploy` target Alchemy's default per-user development stage; the
`infra:prod:*` scripts explicitly target `prod`.
