#!/usr/bin/env python3
"""Import ElevenLabs voice samples from a local folder into voice_library.

Bypasses the ElevenLabs API paywall by having the user download voice previews
from the web UI manually. Each voice = one audio file + one entry in metadata.json.

Usage:
    python3 import-local.py /Users/dungdm/voice-import

Layout expected in <folder>:
    <folder>/
      metadata.json
      <voice1>.mp3
      <voice2>.wav
      ...
"""
import argparse, hashlib, json, os, re, shutil, sqlite3, sys, uuid
from datetime import datetime, timezone

DB = "/Users/dungdm/LocalMiniDrama/backend-node/data/drama_generator.db"
STORAGE_BASE = "/Users/dungdm/LocalMiniDrama/backend-node/data/storage"
DEST_DIR = os.path.join(STORAGE_BASE, "voice_library")

SAFE_ID_RE = re.compile(r"[^a-zA-Z0-9_-]")


def safe_id(s: str) -> str:
    return SAFE_ID_RE.sub("", s or "local")


def now_iso() -> str:
    # match backend format: 2026-07-09T01:51:48.675Z
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now().microsecond // 1000:03d}Z"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", help="Folder containing metadata.json + audio files")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    meta_path = os.path.join(args.folder, "metadata.json")
    if not os.path.isfile(meta_path):
        sys.exit(f"metadata.json not found in {args.folder}")

    with open(meta_path, "r", encoding="utf-8") as f:
        entries = json.load(f)
    if not isinstance(entries, list):
        sys.exit("metadata.json must be a JSON array")

    os.makedirs(DEST_DIR, exist_ok=True)

    conn = sqlite3.connect(DB)
    existing = {row[0] for row in conn.execute(
        "SELECT source_ref FROM voice_library WHERE source='elevenlabs' AND deleted_at IS NULL"
    ).fetchall() if row[0]}
    existing_names = {row[0] for row in conn.execute(
        "SELECT name FROM voice_library WHERE deleted_at IS NULL"
    ).fetchall()}

    success, skipped, failed = [], [], []
    for i, entry in enumerate(entries, 1):
        name = (entry.get("name") or "").strip()
        file_rel = entry.get("file", "")
        src = os.path.join(args.folder, file_rel)

        if not name:
            print(f"[{i:2}] SKIP  missing 'name'")
            failed.append({"entry": entry, "reason": "no name"})
            continue
        if not file_rel or not os.path.isfile(src):
            print(f"[{i:2}] SKIP  {name}: file not found ({file_rel})")
            failed.append({"entry": entry, "reason": f"file not found: {file_rel}"})
            continue
        if entry.get("source_ref") and entry["source_ref"] in existing:
            print(f"[{i:2}] SKIP  {name}: source_ref {entry['source_ref']} already imported")
            skipped.append(entry)
            continue
        if name in existing_names:
            print(f"[{i:2}] SKIP  {name}: name already exists (rename in metadata.json)")
            skipped.append(entry)
            continue

        # Copy audio into voice_library/ with unique name
        ext = os.path.splitext(file_rel)[1].lower() or ".mp3"
        if ext not in (".mp3", ".wav", ".m4a", ".ogg", ".flac"):
            print(f"[{i:2}] SKIP  {name}: unsupported extension {ext}")
            failed.append({"entry": entry, "reason": f"bad ext {ext}"})
            continue

        prefix = safe_id(entry.get("source_ref") or name)
        dest_name = f"local_{prefix}_{uuid.uuid4().hex[:8]}{ext}"
        dest_path = os.path.join(DEST_DIR, dest_name)
        ref_audio_path = f"voice_library/{dest_name}"

        if args.dry_run:
            print(f"[{i:2}] DRYRUN {name} ← {file_rel} → {ref_audio_path}")
            continue

        shutil.copyfile(src, dest_path)

        tags = entry.get("tags") or []
        row = (
            name,
            entry.get("description"),
            entry.get("gender"),
            entry.get("age_range"),
            json.dumps(tags, ensure_ascii=False) if tags else None,
            "elevenlabs",
            entry.get("source_ref"),
            ref_audio_path,
            entry.get("ref_text") or "",
            "/static/" + ref_audio_path,
            entry.get("language") or "en",
            1,
            now_iso(),
            now_iso(),
        )
        cur = conn.execute(
            "INSERT INTO voice_library (name, description, gender, age_range, tags, source, source_ref, ref_audio_path, ref_text, sample_url, language, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            row,
        )
        new_id = cur.lastrowid
        conn.commit()
        existing.add(entry.get("source_ref") or "")
        existing_names.add(name)
        print(f"[{i:2}] OK    {name} → voice_library id={new_id} ({os.path.getsize(dest_path)//1024}KB)")
        success.append({"id": new_id, "name": name, "file": ref_audio_path})

    conn.close()

    print("\n=== SUMMARY ===")
    print(f"  success: {len(success)}")
    print(f"  skipped: {len(skipped)}")
    print(f"  failed:  {len(failed)}")

    if failed:
        print("\nFAILURES:")
        for f in failed:
            print(f"  {f['entry'].get('name','?')} — {f['reason']}")


if __name__ == "__main__":
    main()
