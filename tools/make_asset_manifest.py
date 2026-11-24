"""Walk web/ and write web/asset-manifest.json plus web/packs/*.kpack (stdlib only; used by CI and locally).

Usage: python tools/make_asset_manifest.py [web_dir]

Packs (see docs/build/CONTRACTS.md, "Offline packs"): every tile (tiles/<layer>/<z>/<x>/<y>.png|jpg) is
bundled into packs/<layer>-z<zoom>-<n>.kpack, grouped by layer and zoom and split at ~PACK_TARGET bytes.
Pack layout: 4-byte little-endian header length, UTF-8 JSON header {"files":[{path,offset,bytes,sha256,type}]},
then the concatenated file bytes. `offset` is relative to the start of the data section (just after the
header). Output is deterministic: sorted paths, compact JSON, no timestamps, so identical input gives
identical pack bytes and sha256 (delta updates rely on this).
"""
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

EXCLUDE = {"sw.js", "asset-manifest.json"}
PACK_DIR = "packs"
PACK_TARGET = 8 * 1024 * 1024
TILE_RE = re.compile(r"^tiles/([^/]+)/(\d+)/\d+/\d+\.(png|jpg)$")
MIME = {"png": "image/png", "jpg": "image/jpeg"}


def build_packs(web: Path, files: list) -> list:
    """Write web/packs/*.kpack for the tile files; return the manifest `packs` list."""
    out_dir = web / PACK_DIR
    out_dir.mkdir(exist_ok=True)
    for old in out_dir.glob("*.kpack"):
        old.unlink()

    groups = {}  # (layer, zoom) -> [file entries]; files is already sorted by path
    for f in files:
        m = TILE_RE.match(f["path"])
        if m:
            groups.setdefault((m.group(1), int(m.group(2))), []).append((f, m.group(3)))

    packs = []
    for (layer, zoom) in sorted(groups):
        chunks, cur, size = [], [], 0
        for item in groups[(layer, zoom)]:
            if cur and size + item[0]["bytes"] > PACK_TARGET:
                chunks.append(cur)
                cur, size = [], 0
            cur.append(item)
            size += item[0]["bytes"]
        if cur:
            chunks.append(cur)
        for n, chunk in enumerate(chunks):
            hdr_files, body, off = [], [], 0
            for f, ext in chunk:
                hdr_files.append({"path": f["path"], "offset": off, "bytes": f["bytes"],
                                  "sha256": f["sha256"], "type": MIME[ext]})
                body.append((web / f["path"]).read_bytes())
                off += f["bytes"]
            hdr = json.dumps({"files": hdr_files}, separators=(",", ":"), sort_keys=True).encode("utf-8")
            blob = struct.pack("<I", len(hdr)) + hdr + b"".join(body)
            rel = f"{PACK_DIR}/{layer}-z{zoom}-{n}.kpack"
            (web / rel).write_bytes(blob)
            packs.append({"path": rel, "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest(),
                          "files": [f["path"] for f, _ in chunk]})
    return packs


def main(web: Path) -> None:
    files = []
    for p in sorted(web.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(web).as_posix()
        if rel in EXCLUDE or rel.startswith(PACK_DIR + "/") or any(part.startswith(".") for part in rel.split("/")):
            continue
        data = p.read_bytes()
        files.append({"path": rel, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})

    content_rev, dem_version = None, "none"
    try:
        content_rev = json.loads((web / "data/routes.json").read_text("utf-8")).get("content_rev")
    except (OSError, ValueError):
        pass
    try:
        dem_version = json.loads((web / "tiles/tiles.json").read_text("utf-8")).get("dem_version", "none")
    except (OSError, ValueError):
        pass

    packs = build_packs(web, files)

    h = hashlib.sha256("".join(f["sha256"] for f in files).encode()).hexdigest()[:12]
    out = {
        "version": h,
        "content_rev": content_rev,
        "dem_version": dem_version,
        "files": files,
        "total_bytes": sum(f["bytes"] for f in files),
        "packs": packs,
    }
    (web / "asset-manifest.json").write_text(json.dumps(out, separators=(",", ":")), "utf-8")
    packed = sum(len(p["files"]) for p in packs)
    print(f"asset-manifest: {len(files)} files, {out['total_bytes']} bytes, version {h}, "
          f"content_rev {content_rev}, dem {dem_version}; {len(packs)} packs "
          f"({sum(p['bytes'] for p in packs)} bytes, {packed} tiles)")


if __name__ == "__main__":
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "web"
    main(root)
