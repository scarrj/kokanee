"""WS9: run every automated check. Exit 0 only if all pass.

Usage (from tools/):  python -m uv run check_all.py [--quick]
--quick skips smoke_runtime.py (it reads a remote COG, so it needs network).

Checks: smoke_runtime, validate_routes, check_routes, metrics parity (JS vs Python),
tiles.json schema, asset-manifest freshness, layer-id lint (ids used in web/js are a
subset of CONTRACTS.md#layers).
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
WEB = ROOT / "web"
results = []


def record(name, ok, msg=""):
    results.append((name, ok, msg))
    print(f"{'PASS' if ok else 'FAIL'} {name}" + (f": {msg}" if msg else ""), flush=True)


def run(name, cmd, cwd=TOOLS, timeout=600, env=None):
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired) as e:
        record(name, False, f"{type(e).__name__}: {e}")
        return
    out = (p.stdout + p.stderr).strip().splitlines()
    tail = out[-1] if out else ""
    record(name, p.returncode == 0, tail if p.returncode == 0 else " | ".join(out[-4:]))


def tiles_schema():
    try:
        t = json.loads((WEB / "tiles/tiles.json").read_text("utf-8"))
    except (OSError, ValueError) as e:
        return record("tiles.json schema", False, str(e))
    errs = []
    for k in ("dem_version", "bounds", "layers", "analysis_zoom", "legends", "sources"):
        if k not in t:
            errs.append(f"missing {k}")
    b = t.get("bounds", [])
    if not (len(b) == 4 and b[0] < b[2] and b[1] < b[3]):
        errs.append("bad bounds")
    layers = t.get("layers", {})
    for k in ("dem", "quality", "qcode", "slope", "aspect", "elev"):
        L = layers.get(k)
        if not L:
            errs.append(f"layer {k} missing")
            continue
        if not all(x in L for x in ("minzoom", "maxzoom", "encoding")):
            errs.append(f"layer {k} incomplete")
            continue
        if L["minzoom"] > L["maxzoom"]:
            errs.append(f"layer {k} min>max")
        # tiles must exist on disk for each zoom
        for z in range(L["minzoom"], L["maxzoom"] + 1):
            if not any((WEB / "tiles" / k / str(z)).rglob("*.png")):
                errs.append(f"{k} z{z} has no tiles")
    if layers.get("dem", {}).get("encoding") != "terrarium":
        errs.append("dem encoding != terrarium")
    az = t.get("analysis_zoom")
    for k in ("dem", "qcode"):
        L = layers.get(k, {})
        if L and not (L["minzoom"] <= az <= L["maxzoom"]):
            errs.append(f"analysis_zoom {az} outside {k}")
    lg = t.get("legends", {})
    for k in ("slope", "aspect", "elev", "quality"):
        if not lg.get(k):
            errs.append(f"legend {k} missing")
    if len(lg.get("slope", [])) != 5:
        errs.append("slope legend != 5 classes")
    if len(lg.get("aspect", [])) != 8:
        errs.append("aspect legend != 8 sectors")
    codes = {s.get("code") for s in t.get("sources", [])}
    if not {1, 2, 3} <= codes:
        errs.append("sources missing codes 1-3")
    record("tiles.json schema", not errs, "; ".join(errs) or f"{len(layers)} layers, analysis_zoom {az}")


def manifest_fresh():
    mf = WEB / "asset-manifest.json"
    if not mf.exists():
        # CI builds it; locally, prove the generator runs on a copy of web/ and every file is listed
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            cp = Path(td) / "web"
            shutil.copytree(WEB, cp)
            p = subprocess.run([sys.executable, str(TOOLS / "make_asset_manifest.py"), str(cp)], capture_output=True, text=True)
            ok = p.returncode == 0 and (cp / "asset-manifest.json").exists()
            return record("asset manifest freshness", ok, "no local manifest (CI builds it); generator dry-run: " + (p.stdout.strip() or p.stderr.strip()))
    m = json.loads(mf.read_text("utf-8"))
    listed = {f["path"]: f for f in m["files"]}
    errs = []
    actual = set()
    for p in sorted(WEB.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(WEB).as_posix()
        if rel in ("sw.js", "asset-manifest.json") or rel.startswith("packs/") or any(s.startswith(".") for s in rel.split("/")):
            continue
        actual.add(rel)
        f = listed.get(rel)
        if f is None:
            errs.append(f"unlisted {rel}")
        elif hashlib.sha256(p.read_bytes()).hexdigest() != f["sha256"]:
            errs.append(f"stale {rel}")
    for rel in listed:
        if rel not in actual:
            errs.append(f"missing {rel}")
    record("asset manifest freshness", not errs, "; ".join(errs[:6]) + (f" (+{len(errs)-6} more)" if len(errs) > 6 else "") or f"{len(listed)} files")


def layer_lint():
    contract = (ROOT / "docs/build/CONTRACTS.md").read_text("utf-8")
    sec = contract.split("## layers", 1)[1].split("**Default draw order**", 1)[0]
    allowed = set(re.findall(r"`([a-z0-9-]+)`", sec))
    used = {}
    for p in sorted((WEB / "js").glob("*.js")):
        src = p.read_text("utf-8")
        for m in re.finditer(r"""\bid:\s*['"]([a-z0-9-]+)['"][^\n]*?\btype:""", src):
            used.setdefault(m.group(1), p.name)
        for m in re.finditer(r"""\blayers:\s*\[(\s*['"][^\]]*)\]""", src):
            for s in re.findall(r"""['"]([a-z0-9-]+)['"]""", m.group(1)):
                used.setdefault(s, p.name)
        for m in re.finditer(r"""\b(?:getLayer|removeLayer|setLayoutProperty|setPaintProperty|setFilter|moveLayer)\(\s*['"]([a-z0-9-]+)['"]""", src):
            used.setdefault(m.group(1), p.name)
    # the 'bg' background layer is declared by id/type in separate objects
    extra = {k: v for k, v in used.items() if k not in allowed}
    record("layer id lint", not extra, ", ".join(f"{k} ({v})" for k, v in extra.items()) or f"{len(used)} ids, all in #layers")


def main():
    quick = "--quick" in sys.argv
    py = sys.executable
    if quick:
        print("SKIP smoke_runtime (--quick)")
    else:
        run("smoke_runtime", [py, "smoke_runtime.py"])
    run("validate_routes", [py, "validate_routes.py", str(WEB / "data/routes.json")])
    run("check_routes", [py, "check_routes.py", "--routes", str(WEB / "data/routes.json")])
    node = shutil.which("node")
    if node:
        # the parity script calls `python -m uv run`; inside the uv venv `python` has no uv, so use the outer PATH
        env = dict(os.environ)
        venv = env.pop("VIRTUAL_ENV", None)
        if venv:
            env["PATH"] = os.pathsep.join(d for d in env["PATH"].split(os.pathsep) if not d.lower().startswith(venv.lower()))
        run("metrics parity", [node, "test_metrics_parity.mjs"], env=env)
        run("model tests", [node, "test_model.mjs", str(WEB / "data/routes.json")])
    else:
        record("metrics parity", False, "node not found")
    tiles_schema()
    manifest_fresh()
    layer_lint()
    bad = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} checks passed" + (f"; FAILED: {', '.join(bad)}" if bad else ""))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
