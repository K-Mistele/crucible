#!/usr/bin/env python3
"""Migrate Minecraft player files from online UUIDs to offline UUIDs.

Run this on the server host while Minecraft is stopped. No AWS resources or
server configuration are changed by this tool.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone
import uuid


JSON_FILES = ("usercache.json", "ops.json", "whitelist.json", "banned-players.json")
LEGACY_PLAYER_DIRS = ("playerdata", "advancements", "stats")
PAPER_PLAYER_DIRS = ("players/data", "players/advancements", "players/stats")
SUFFIXES = ("", ".dat", ".dat_old", ".json")


def offline_uuid(name: str) -> str:
    """Return Java's UUID.nameUUIDFromBytes(b'OfflinePlayer:' + name)."""
    digest = bytearray(hashlib.md5(f"OfflinePlayer:{name}".encode("utf-8")).digest())
    digest[6] = (digest[6] & 0x0F) | 0x30
    digest[8] = (digest[8] & 0x3F) | 0x80
    return str(uuid.UUID(bytes=bytes(digest)))


def server_is_running() -> str | None:
    if shutil.which("docker"):
        result = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
            check=False,
        )
        if "minecraft" in result.stdout.splitlines():
            return "the minecraft container is running"
    if shutil.which("pgrep"):
        result = subprocess.run(
            ["pgrep", "-f", r"[j]ava .*\.jar"], capture_output=True, check=False
        )
        if result.returncode == 0:
            return "a Java server process is running"
    return None


def replace_uuid_values(value: object, replacements: dict[str, str]) -> tuple[object, int]:
    if isinstance(value, str):
        replacement = replacements.get(value.lower())
        return (replacement, 1) if replacement is not None else (value, 0)
    if isinstance(value, list):
        changed = 0
        output = []
        for item in value:
            new_item, count = replace_uuid_values(item, replacements)
            output.append(new_item)
            changed += count
        return output, changed
    if isinstance(value, dict):
        changed = 0
        output = {}
        for key, item in value.items():
            new_item, count = replace_uuid_values(item, replacements)
            output[key] = new_item
            changed += count
        return output, changed
    return value, 0


def load_players(cache: Path) -> list[tuple[str, str, str]]:
    try:
        entries = json.loads(cache.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read {cache}: {error}") from error
    if not isinstance(entries, list):
        raise ValueError(f"{cache} must contain a JSON array")
    players = []
    old_mappings: dict[str, tuple[str, str]] = {}
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or not isinstance(entry.get("uuid"), str):
            raise ValueError(f"invalid name/uuid entry at {cache}[{index}]")
        try:
            old = str(uuid.UUID(entry["uuid"]))
        except ValueError as error:
            raise ValueError(f"invalid UUID at {cache}[{index}]") from error
        new = offline_uuid(entry["name"])
        previous = old_mappings.get(old)
        if previous is not None and previous[1] != new:
            raise ValueError(
                f"conflicting usercache mappings for {old}: "
                f"{previous[0]!r} -> {previous[1]} and {entry['name']!r} -> {new}"
            )
        if previous is None:
            old_mappings[old] = (entry["name"], new)
            players.append((entry["name"], old, new))
    if not players:
        raise ValueError(f"{cache} has no players")
    return players


def detect_player_dirs(world: Path) -> tuple[str, ...]:
    def has_data(directories: tuple[str, ...]) -> bool:
        return any(
            path.is_file()
            for directory in directories
            if (root := world / directory).is_dir()
            for path in root.iterdir()
        )

    legacy_has_data = has_data(LEGACY_PLAYER_DIRS)
    paper_has_data = has_data(PAPER_PLAYER_DIRS)
    if legacy_has_data and paper_has_data:
        raise ValueError(
            f"ambiguous player layout: both {world / 'playerdata'} and "
            f"{world / 'players'} contain data"
        )
    if paper_has_data:
        return PAPER_PLAYER_DIRS
    if legacy_has_data:
        return LEGACY_PLAYER_DIRS

    paper_exists = (world / PAPER_PLAYER_DIRS[0]).is_dir()
    legacy_exists = (world / LEGACY_PLAYER_DIRS[0]).is_dir()
    if paper_exists and not legacy_exists:
        return PAPER_PLAYER_DIRS
    if legacy_exists and not paper_exists:
        return LEGACY_PLAYER_DIRS
    raise ValueError(f"no unambiguous player-data layout found under {world}")


def migration_moves(world: Path, player_dirs: tuple[str, ...], players: list[tuple[str, str, str]]) -> list[tuple[Path, Path]]:
    moves = []
    for _name, old, new in players:
        if old == new:
            continue
        for directory in player_dirs:
            for suffix in SUFFIXES:
                source = world / directory / f"{old}{suffix}"
                if source.is_file():
                    moves.append((source, world / directory / f"{new}{suffix}"))
    return moves


def create_backup(data: Path, world: Path, player_dirs: tuple[str, ...]) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = data / f"uuid-migration-backup-{stamp}"
    backup.mkdir()
    for directory in player_dirs:
        source = world / directory
        if source.exists():
            shutil.copytree(source, backup / "world" / directory)
    for filename in JSON_FILES:
        source = data / filename
        if source.is_file():
            shutil.copy2(source, backup / filename)
    return backup


def migrate(data: Path, *, dry_run: bool = False, force: bool = False) -> int:
    world = data / "world"
    player_dirs = detect_player_dirs(world)
    cache = data / "usercache.json"
    if not cache.is_file():
        raise ValueError(f"no usercache.json at {cache}")
    if not dry_run and not force:
        running = server_is_running()
        if running:
            raise RuntimeError(f"{running}; stop it first or re-run with --force")

    players = load_players(cache)
    moves = migration_moves(world, player_dirs, players)
    destinations: dict[Path, Path] = {}
    collisions = []
    for source, destination in moves:
        if destination.exists() and destination != source:
            collisions.append(f"{destination} already exists (source: {source})")
        previous = destinations.get(destination)
        if previous is not None and previous != source:
            collisions.append(f"multiple files would become {destination}")
        destinations[destination] = source
    if collisions:
        raise RuntimeError("collision detected; nothing was changed:\n  " + "\n  ".join(collisions))

    replacements = {old.lower(): new for _name, old, new in players if old != new}
    json_updates: list[tuple[Path, object, int]] = []
    for filename in JSON_FILES:
        path = data / filename
        if not path.is_file():
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid JSON in {path}: {error}") from error
        updated, count = replace_uuid_values(value, replacements)
        if count:
            json_updates.append((path, updated, count))

    mode = "Would migrate" if dry_run else "Migrating"
    for name, old, new in players:
        print(f"{'=' if old == new else '->'} {name}: {old} -> {new}")
    print(f"{mode} {len(moves)} file(s) and update {sum(x[2] for x in json_updates)} JSON value(s).")
    if dry_run:
        print("Dry run: no files were changed and no backup was created.")
        return 0
    if not moves and not json_updates:
        print("No changes needed; no backup was created.")
        return 0

    backup = create_backup(data, world, player_dirs)
    print(f"Backup written to {backup}")
    moved: list[tuple[Path, Path]] = []
    temporary_files: list[Path] = []
    original_json = {}
    for path, _value, _count in json_updates:
        metadata = path.stat()
        original_json[path] = (
            path.read_bytes(),
            metadata.st_mode,
            metadata.st_uid,
            metadata.st_gid,
        )
    applied_operations = 0
    fail_after_text = os.environ.get("_MIGRATE_UUIDS_TEST_FAIL_AFTER")
    fail_after = int(fail_after_text) if fail_after_text is not None else None

    def operation_applied() -> None:
        nonlocal applied_operations
        applied_operations += 1
        if fail_after is not None and applied_operations >= fail_after:
            raise OSError("injected migration failure")

    try:
        for source, destination in moves:
            source.rename(destination)
            moved.append((source, destination))
            operation_applied()
        for path, value, _count in json_updates:
            temporary = path.with_name(f".{path.name}.uuid-migration.tmp")
            temporary_files.append(temporary)
            temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            os.chmod(temporary, original_json[path][1])
            os.chown(temporary, original_json[path][2], original_json[path][3])
            os.replace(temporary, path)
            operation_applied()
    except BaseException as apply_error:
        rollback_errors = []
        for temporary in temporary_files:
            try:
                temporary.unlink(missing_ok=True)
            except OSError as rollback_error:
                rollback_errors.append(f"remove temporary file {temporary}: {rollback_error}")
        for path, (contents, mode, uid, gid) in original_json.items():
            try:
                temporary = path.with_name(f".{path.name}.uuid-migration.rollback.tmp")
                temporary.write_bytes(contents)
                os.chmod(temporary, mode)
                os.chown(temporary, uid, gid)
                os.replace(temporary, path)
            except OSError as rollback_error:
                rollback_errors.append(f"restore {path}: {rollback_error}")
        for source, destination in reversed(moved):
            try:
                if destination.exists():
                    destination.rename(source)
            except OSError as rollback_error:
                rollback_errors.append(f"restore {source}: {rollback_error}")
        if rollback_errors:
            raise RuntimeError(
                f"migration failed ({apply_error}); rollback was incomplete; restore from {backup}:\n  "
                + "\n  ".join(rollback_errors)
            ) from apply_error
        raise RuntimeError(
            f"migration failed ({apply_error}); all applied changes were rolled back; backup retained at {backup}"
        ) from apply_error
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", nargs="?", default="/srv/minecraft", type=Path, help="server data directory (default: /srv/minecraft)")
    parser.add_argument("--dry-run", action="store_true", help="validate and preview without changing files")
    parser.add_argument("--force", action="store_true", help="skip the running-server safety check")
    parser.add_argument("--uuid", metavar="NAME", help="print the offline UUID for one player and exit")
    args = parser.parse_args(argv)
    if args.uuid is not None:
        print(offline_uuid(args.uuid))
        return 0
    try:
        return migrate(args.data.resolve(), dry_run=args.dry_run, force=args.force)
    except (ValueError, RuntimeError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
