"""One-off: PDF guide text -> docs/source/topo.md (Phase 0d).

Agents read topo.md instead of the 9 MB PDF. Stable ids: zones z-*, routes r01..r35, S&I descents si1..si6.
Run from tools/:  uv run --with pypdf extract_topo.py
"""
import pathlib, re
import pypdf

ROOT = pathlib.Path(__file__).resolve().parent.parent
PDF = ROOT / "topo" / "KokaneeGlacierCabin_Topo.pdf"
OUT = ROOT / "docs" / "source" / "topo.md"

ZONES = [  # id, heading in PDF, route numbers
    ("z-tanal", "TANAL PEAK AREA", range(1, 7)),
    ("z-robert-smith", "MOUNT ROBERT SMITH AREA", range(7, 9)),
    ("z-nansen", "MOUNT NANSEN AREA", range(9, 15)),
    ("z-giegerich", "MOUNT GEIGERICH AREA", range(15, 18)),
    ("z-john-carter", "MOUNT JOHN CARTER AREA", range(18, 29)),
    ("z-pyramid", "THE PYRAMID AREA", range(29, 34)),
    ("z-longer-tours", "LONGER TOURS", range(34, 36)),
]
NAMES = {1: "Over Easy", 2: "Hot Cheeks", 3: "Holy Slab", 4: "Big Meatballs", 5: "Future Champion", 6: "Cream Puff",
         7: "Mount Robert Smith Southeast Face", 8: "Mark's Slot", 9: "Northern Exposure", 10: "Roll Map", 11: "Aquavit",
         12: "Lute Fish", 13: "Unibomber", 14: "Nansen East Face", 15: "Molly's Elevens", 16: "Mount Giegerich - Skol",
         17: "Mount Giegerich - East Face", 18: "Mount John Carter North", 19: "Mount John Carter West #1",
         20: "Mount John Carter West #2", 21: "Mount John Carter West #3", 22: "Giants Nut Sack", 23: "Easy's",
         24: "Simple Pleasures", 25: "Beaujolais", 26: "Cat Fish Comes Home", 27: "Sunset Mountain", 28: "Andy's Slide",
         29: "Field of Dreams", 30: "J.C.'s", 31: "Knee D-2", 32: "Knee Dropping Tree Fairy", 33: "Squat to Pee",
         34: "The Keyhole", 35: "Gray's Peak"}
FLAGS = {  # known source-text problems, shown inline so agents don't trust them blindly
    34: "SOURCE ERROR: description text is a copy of #8 Mark's Slot; approach/descent for The Keyhole is undocumented. "
        "ATES has a 'Keyhole' landmark at -117.152373, 49.749477 (between Esmeralda Peak and Kokanee Glacier).",
    35: "Refers to The Keyhole directions, which are missing (see r34).",
    22: "Text says 'sustained 480 metre descent' but header gain is 430 m.",
    33: "Text says 'Filed of Dreams' (= Field of Dreams).",
}

def clean(s):
    s = s.replace(" ", " ").replace("­", "-").replace("∙", "")
    s = re.sub(r"[ \t]+", " ", s)
    return s

def para(lines):
    txt = " ".join(l.strip() for l in lines if l.strip())
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt

raw = "\n".join(clean(p.extract_text()) for p in pypdf.PdfReader(PDF).pages)
lines = [l.rstrip() for l in raw.splitlines()]

# --- locate route blocks
route_idx = {}
for i, l in enumerate(lines):
    m = re.match(r"\s*ROUTE:\s*#(\d+)", l)
    if m:
        route_idx[int(m.group(1))] = i
heading_set = {z[1] for z in ZONES}
def is_name_line(l):
    s = l.strip()
    return bool(s) and s.upper() == s and any(c.isalpha() for c in s) and not s.startswith(("ROUTE", "TIME", "ELEVATION"))

routes = {}
nums = sorted(route_idx)
for k, n in enumerate(nums):
    i = route_idx[n]
    time = re.sub(r"^TIME:\s*", "", lines[i + 1].strip())
    gain = re.sub(r"^ELEVATION GAIN:\s*", "", lines[i + 2].strip())
    end = route_idx[nums[k + 1]] if k + 1 < len(nums) else len(lines)
    body = lines[i + 3:end]
    # trim trailing next-route name / zone heading + zone intro
    cut = len(body)
    for j in range(len(body)):
        s = body[j].strip()
        if s in heading_set or (is_name_line(body[j]) and j > 0 and (j + 1 >= len(body) or not body[j + 1].strip() or is_name_line(body[j + 1]) or True)):
            if s.upper() in {x.upper() for x in NAMES.values()} or s in heading_set or s.startswith(("MOUNT JOHN CARTER WEST", "KNEE D", "THE KEYHOLE", "J.C.", "GRAY")):
                cut = j
                break
    text = re.sub(r"\s+[A-Z][A-Z .'\-#0-9]{6,}$", "", para(body[:cut]))  # drop trailing next-route heading
    routes[n] = dict(time=time, gain=gain, text=text)

# --- zone intros: text between zone heading and first route name
zone_intro = {}
for zid, head, rng in ZONES:
    i = next(j for j, l in enumerate(lines) if l.strip() == head)
    first = route_idx[rng[0]]
    seg = lines[i + 1:first - 1]
    # drop the route-name line(s) right before ROUTE:
    while seg and (not seg[-1].strip() or is_name_line(seg[-1])):
        seg.pop()
    zone_intro[zid] = para(seg)

# --- front matter + S&I
start_si = next(j for j, l in enumerate(lines) if l.strip().startswith("Ski tours from Kokanee Glacier Cabin"))
start_bcs = next(j for j, l in enumerate(lines) if l.strip().startswith("Here are a few") and j > start_si + 1)
front = para(lines[:start_si])
si_block = " ".join(l.strip() for l in lines[start_si + 2:start_bcs])
si_items = [s.strip() for s in re.split(r"\s(?=[1-6]\.\s)", " " + si_block) if s.strip()]

out = ["# Kokanee Glacier Cabin guide — extracted text",
       "",
       "Source: `topo/KokaneeGlacierCabin_Topo.pdf` (22 pages). Extracted once by `tools/extract_topo.py`. "
       "Agents: use this file, never the PDF. Text is verbatim except whitespace/hyphen cleanup; "
       "`> FLAG:` lines are editorial notes, not source text.",
       "",
       "## hut — Hut, access, booking, history (front matter)",
       "", front, "",
       "## si — Summits & Icefields 2 descents (grid refs: UTM zone 11; datum see docs/decisions/horizontal-datum.md)",
       ""]
for k, s in enumerate(si_items, 1):
    s = re.sub(r"^\d\.\s*", "", s)
    out += [f"### si{k}", "", s, ""]
out += ["> FLAG: si3 'north summit of Outlook Mountain (486200 E 5509800 N)' coincides with today's Mount John Carter "
        "(ATES landmark within ~60 m). 's50 vertical metres' is a typo (likely 550 or 650). '55113°0' = 5511300; '55II300' = 5511300.", ""]
for zid, head, rng in ZONES:
    out += [f"## {zid} — {head.title()}", "", zone_intro[zid], ""]
    for n in rng:
        r = routes[n]
        out += [f"### r{n:02d} — #{n} {NAMES[n]}", "", f"- zone: {zid}", f"- time: {r['time']}", f"- elevation gain: {r['gain']}", "",
                r["text"], ""]
        if n in FLAGS:
            out += [f"> FLAG: {FLAGS[n]}", ""]
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n".join(out), encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size} bytes), routes={len(routes)}, si={len(si_items)}")
