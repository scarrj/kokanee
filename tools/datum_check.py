"""Phase 0b: horizontal datum check of the guide's UTM grid refs.

Control points: BC Geographic Names (BCGNIS, NAD83 decimal degrees) + ATES KMZ landmarks (WGS84),
plus lidar summit-finding where the lidar has data. Compares guide refs under two hypotheses:
  H83: refs are NAD83 UTM 11N;  H27: refs are NAD27 UTM 11N (converted with NTv2 grid ca_nrc_ntv2_0).
Writes build/datum_check.json; the human summary lives in docs/decisions/horizontal-datum.md.
Run from tools/:  uv run datum_check.py
"""
import json, math, pathlib, re, zipfile
import numpy as np
import pyproj, rasterio
from rasterio.windows import from_bounds

pyproj.network.set_network_enabled(True)
ROOT = pathlib.Path(__file__).resolve().parent.parent
ll2utm = pyproj.Transformer.from_crs(4617, 2955, always_xy=True)          # NAD83(CSRS) geographic -> UTM11N
nad27 = pyproj.Transformer.from_crs(26711, 2955, always_xy=True)          # NAD27 UTM11 -> NAD83(CSRS) UTM11 (NTv2)

# BCGNIS results (queried 2026-11-23, apps.gov.bc.ca/pub/bcgnws), lon/lat
BCGNIS = {
    "The Battleship": (-117.1633333332, 49.7580555518),
    "Giants Kneecap": (-117.1552777776, 49.7549999963),
    "The Pyramids": (-117.1636111117, 49.7538888849),
    "Mount John Carter": (-117.1924999994, 49.7402777737),
    "Outlook Mountain": (-117.1958333337, 49.7319444401),
    "Joker Lakes": (-117.1405555561, 49.7752777736),
    "Lemon Pass": (-117.2177807901, 49.7498627976),
    "Kaslo Lake": (-117.1952777778, 49.7683333296),
    "Enterprise Pass": (-117.1977777777, 49.7727777738),
    "Mount Giegerich": (-117.2205555562, 49.7563888847),
    "Esmeralda Peak": (-117.1511111114, 49.7474999961),
    "Cond Peak": (-117.1419444443, 49.746111107),
}
# Guide grid refs (docs/source/topo.md, section si), easting/northing as printed
GUIDE = [
    ("si1 The Battleship", (488200, 5511800), "The Battleship"),
    ("si1 The Giant's Kneecap", (488700, 5511400), "Giants Kneecap"),
    ("si2 Joker Lakes", (490100, 5513300), "Joker Lakes"),
    ("si3 north summit of Outlook Mtn", (486200, 5509800), "Mount John Carter"),
    ("si3 crest just above Lemon Pass", (485100, 5511300), "Lemon Pass"),
    ("si5 The Pyramids", (488200, 5511300), "The Pyramids"),
]

def ates_points():
    s = zipfile.ZipFile(ROOT / "ates" / "Kokanee Glacier.kmz").read("doc.kml").decode()
    out = {}
    for pm in re.findall(r"<Placemark>(.*?)</Placemark>", s, re.S):
        if "<Point" in pm and "destination" in pm or "cabin_styles" in pm:
            n = re.search(r"<name>(.*?)</name>", pm).group(1)
            lon, lat = map(float, re.search(r"<coordinates>(.*?)</coordinates>", pm, re.S).group(1).split(",")[:2])
            out[n] = (lon, lat)
    return out

LIDAR = sorted((ROOT / "1m_tif_data").glob("*.tif"))
def lidar_summit(e, n, r=120):
    """Highest lidar cell within r m (2 m decimated). None if no data."""
    for p in LIDAR:
        with rasterio.open(p) as ds:
            b = ds.bounds
            if not (b.left < e < b.right and b.bottom < n < b.top):
                continue
            w = from_bounds(e - r, n - r, e + r, n + r, ds.transform)
            a = ds.read(1, window=w, boundless=True, fill_value=-32767)[::2, ::2].astype(float)
            a[a < -1000] = np.nan
            if np.isnan(a).mean() > 0.5:
                return None
            iy, ix = np.unravel_index(np.nanargmax(a), a.shape)
            return (e - r + ix * 2, n + r - iy * 2, float(a[iy, ix]))
    return None

res = {"control": {}, "guide": []}
ates = ates_points()
for name, ll in BCGNIS.items():
    e, n = ll2utm.transform(*ll)
    row = {"bcgnis_utm": [round(e), round(n)]}
    a = ates.get({"Giants Kneecap": "Giants Kneecap", "Mount John Carter": "Mount John Carter"}.get(name, name))
    if a:
        ae, an = ll2utm.transform(*a)
        row["ates_utm"] = [round(ae), round(an)]
        row["bcgnis_vs_ates_m"] = round(math.hypot(ae - e, an - n))
    if any(k in name for k in ("Mount", "Peak", "Battleship", "Kneecap", "Pyramids", "Mountain")):
        s = lidar_summit(e, n)
        if s:
            row["lidar_summit"] = [round(s[0]), round(s[1]), round(s[2], 1)]
            row["bcgnis_vs_lidar_summit_m"] = round(math.hypot(s[0] - e, s[1] - n))
    res["control"][name] = row

print(f"{'guide ref':34s} {'ctrl':18s} {'H83 dist':>9s} {'H27 dist':>9s}")
for label, (ge, gn), ctrl in GUIDE:
    ce, cn = ll2utm.transform(*BCGNIS[ctrl])
    e27, n27 = nad27.transform(ge, gn)
    d83 = math.hypot(ge - ce, gn - cn); d27 = math.hypot(e27 - ce, n27 - cn)
    res["guide"].append(dict(ref=label, printed=[ge, gn], control=ctrl, h83_m=round(d83), h27_m=round(d27),
                             h27_converted=[round(e27), round(n27)]))
    print(f"{label:34s} {ctrl:18s} {d83:9.0f} {d27:9.0f}")
d83 = [g["h83_m"] for g in res["guide"]]; d27 = [g["h27_m"] for g in res["guide"]]
res["summary"] = dict(median_h83=float(np.median(d83)), median_h27=float(np.median(d27)))
print("median H83", np.median(d83), "median H27", np.median(d27))
for k, v in res["control"].items():
    print(k, v)
out = ROOT / "build" / "datum_check.json"; out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(res, indent=1))
