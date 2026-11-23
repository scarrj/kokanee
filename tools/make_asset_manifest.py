"""Walk web/ and write web/asset-manifest.json (stdlib only; used by CI and locally).

Usage: python tools/make_asset_manifest.py [web_dir]
"""
import hashlib
import json
import sys
from pathlib import Path

EXCLUDE = {"sw.js", "asset-manifest.json"}


def main(web: Path) -> None:
    files = []
    for p in sorted(web.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(web).as_posix()
        if rel in EXCLUDE or any(part.startswith(".") for part in rel.split("/")):
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

    h = hashlib.sha256("".join(f["sha256"] for f in files).encode()).hexdigest()[:12]
    out = {
        "version": h,
        "content_rev": content_rev,
        "dem_version": dem_version,
        "files": files,
        "total_bytes": sum(f["bytes"] for f in files),
    }
    (web / "asset-manifest.json").write_text(json.dumps(out, separators=(",", ":")), "utf-8")
    print(f"asset-manifest: {len(files)} files, {out['total_bytes']} bytes, version {h}, "
          f"content_rev {content_rev}, dem {dem_version}")


if __name__ == "__main__":
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "web"
    main(root)
