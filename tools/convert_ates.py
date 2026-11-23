"""Convert ates/Kokanee Glacier.kmz -> web/data/ates.geojson + content/seed/_pois.json
(+ the ATES section of web/data/ATTRIBUTION.md). Stdlib only. No style colours are kept."""
import datetime
import html
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KMZ = ROOT / "ates" / "Kokanee Glacier.kmz"
NS = {"k": "http://www.opengis.net/kml/2.2"}
LAYER_BY_FOLDER = {"Points of Interest": "landmark", "Access Routes": "road",
                   "Avalanche Paths": "path", "Decision Points": "decision"}
CLASS_BY_FOLDER = {"Class 1": "simple", "Class 2": "challenging", "Class 3": "complex"}


def coords(text):
    out = []
    for tok in text.split():
        p = [float(v) for v in tok.split(",")]
        out.append([round(p[0], 6), round(p[1], 6)])
    return out


def geometry(pm):
    pt = pm.find("k:Point/k:coordinates", NS)
    if pt is not None:
        return {"type": "Point", "coordinates": coords(pt.text)[0]}
    ls = pm.find("k:LineString/k:coordinates", NS)
    if ls is not None:
        return {"type": "LineString", "coordinates": coords(ls.text)}
    poly = pm.find("k:Polygon", NS)
    rings = [coords(poly.find("k:outerBoundaryIs/k:LinearRing/k:coordinates", NS).text)]
    for ib in poly.findall("k:innerBoundaryIs/k:LinearRing/k:coordinates", NS):
        rings.append(coords(ib.text))
    return {"type": "Polygon", "coordinates": rings}


def plain_text(desc):
    """Description is HTML-escaped HTML. Return plain text, one line per table row / <br>."""
    s = html.unescape(desc)
    s = re.sub(r"(?is)<style.*?</style>|<meta[^>]*>", "", s)
    s = re.sub(r"(?i)<br\s*/?>|</tr>|</p>|</th>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\u2717", "")
    lines = [re.sub(r"[ \t\xa0]+", " ", l).strip() for l in s.split("\n")]
    return "\n".join(l for l in lines if l)


def poi_type(name):
    n = name.lower()
    if n == "cabin":
        return "hut"
    if n in ("keyhole", "enterprise"):
        return "pass"
    if re.search(r"lake", n):
        return "lake"
    if re.search(r"peak|mount|ridge", n):
        return "peak"
    return "landmark"


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    with zipfile.ZipFile(KMZ) as z:
        root = ET.fromstring(z.read("doc.kml"))
    feats = []

    def visit(folder, trail):
        name = folder.find("k:name", NS).text
        trail = trail + [name]
        for pm in folder.findall("k:Placemark", NS):
            pname = (pm.find("k:name", NS).text or "").strip()
            d = pm.find("k:description", NS)
            desc = plain_text(d.text) if d is not None and d.text else ""
            props = {"name": pname}
            if name in LAYER_BY_FOLDER:
                props["layer"] = LAYER_BY_FOLDER[name]
            elif name in ("Kokanee Glacier",) and len(trail) == 2 or (len(trail) == 1):
                props["layer"] = "boundary"
            else:
                cls = next((v for k, v in CLASS_BY_FOLDER.items() if name.startswith(k)), None)
                if cls is None:
                    continue
                props["layer"] = "zone"
                props["class"] = cls
            if props["layer"] == "path":
                props["name"] = re.sub(r"^(Path \d+)\.0$", r"\1", pname)
            if desc:
                props["description"] = desc
            feats.append({"type": "Feature", "properties": props, "geometry": geometry(pm)})
        for sub in folder.findall("k:Folder", NS):
            visit(sub, trail)

    doc = root.find("k:Document", NS)
    for f in doc.findall("k:Folder", NS):
        visit(f, [])
    # the top folder holds the boundary placemark directly; its sub-folders are visited too
    out = ROOT / "web" / "data"
    out.mkdir(parents=True, exist_ok=True)
    (out / "ates.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                                                  separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    counts = {}
    for f in feats:
        counts[f["properties"]["layer"]] = counts.get(f["properties"]["layer"], 0) + 1
    print("ates.geojson:", counts)

    pois, used = [], set()
    for f in feats:
        p = f["properties"]
        if p["layer"] != "landmark":
            continue
        pid = "cabin" if p["name"] == "Cabin" else slug(p["name"])
        assert pid not in used, pid
        used.add(pid)
        pois.append({"id": pid, "name": "Kokanee Glacier Cabin" if pid == "cabin" else p["name"],
                     "type": poi_type(p["name"]), "coord": f["geometry"]["coordinates"],
                     "description": ""})
    seed = ROOT / "content" / "seed"
    seed.mkdir(parents=True, exist_ok=True)
    (seed / "_pois.json").write_text(json.dumps({"pois": pois}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("pois:", len(pois), {t: sum(1 for p in pois if p["type"] == t) for t in {p["type"] for p in pois}})

    mt = datetime.datetime.fromtimestamp(KMZ.stat().st_mtime).date().isoformat()
    section = ("<!-- ates:begin -->\n## ATES\n- Source file: `ates/Kokanee Glacier.kmz` (file date " + mt +
               "). Avalanche Terrain Exposure Scale zones, paths, decision points, boundary, access road and "
               "landmarks as supplied in the KMZ; converted read-only, style colours dropped. "
               "Not a substitute for avalanche forecasts or field assessment.\n<!-- ates:end -->\n")
    att = out / "ATTRIBUTION.md"
    txt = att.read_text(encoding="utf-8") if att.exists() else "# Data attribution\n\n"
    if "<!-- ates:begin -->" in txt:
        txt = re.sub(r"<!-- ates:begin -->.*?<!-- ates:end -->\n", lambda m: section, txt, flags=re.S)
    else:
        txt += "\n" + section
    att.write_text(txt, encoding="utf-8")


if __name__ == "__main__":
    main()
