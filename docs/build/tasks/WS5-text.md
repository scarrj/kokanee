# WS5 Text: seeds, schema, model.js, assembly
**Model:** Haiku · **Effort:** low · **Depends:** WS0 · **Scope:** text for every route in both phases (geometry stays empty)
**Optional inputs (use them if present, never wait for them):**
- `content/seed/_pois.json` (WS2)
- `web/tiles/tiles.json` (WS1)

## Goal
Turn `docs/source/topo.md` into App JSON seed files with text only, and provide the schema, the model helpers and the one-time assembly script.

## Read
- `CONTRACTS.md#app-json` (including **Validation rules** and **Where the values come from**), `#geojson-mapping`, `#modules` (`model.js`), `#ui` (zone palette)
- `docs/source/topo.md`

## Own
- `content/seed/<zone-id>.json` for the zones `z-tanal`, `z-robert-smith`, `z-nansen`, `z-giegerich`, `z-john-carter`, `z-pyramid`, `z-longer-tours`, `z-si`, `z-hut`
- `web/data/routes.schema.json`, `web/js/model.js`
- `tools/assemble_routes.py`, `tools/validate_routes.py`, `tools/test_model.mjs`
- Outputs written by your acceptance run: `web/data/routes.json`, `build/routes.backup.*.json`

## Do not read
The PDF, any tiles, `web/js/*` except `model.js`.

## Field mapping from topo.md
| topo.md | App JSON |
|---|---|
| Heading `### r01 — #1 Over Easy` | `id` "r01", `num` "1", `name` "Over Easy" |
| `- zone: z-tanal` | `zone` |
| `- time: 2 -3 hrs` | `time` "2 -3 hrs" (verbatim) |
| `- elevation gain: 140m/460'` | `gain_m` 140, the number before `m` in the **header line** (header wins over figures in the body; e.g. r22 is 430) |
| Paragraph text | `description`, **verbatim**, even where it's known to be wrong (r34) |
| `> FLAG: …` | appended to `notes` as "Guide note: …" |
| Zone heading `## z-tanal — Tanal Peak Area` | zone `id`, `name` "Tanal Peak Area"; `description` = the zone's intro paragraph |
| `## si` + `### si1`… | zone `z-si` "Summits & Icefields 2 descents"; routes `si1`…`si6`, `num` "S&I 1"…, `name` = a short name of 6 words or fewer that you write from the text (e.g. "Battleship NW slope"), `descent_m` 600 / 800 / null / 250 / null / null |
| `## hut` | zone `z-hut` "Hut & access", description = the front matter; no routes |

Every route gets: `descent: []`, `skin: []`, `approx: true`, `confidence: "low"` (WS8 sets the real value), and `descent_m: null` unless the table above gives one. Every zone gets `info_point: null`, and `color` from `#ui`. `source` is "backcountryskiingcanada.com (via guide PDF)", or "Summits & Icefields 2 (via guide PDF)" for `z-si`.

## Steps
1. Write the 9 seed files: `{ "zone": {...}, "routes": [...], "pois": [], "areas": [] }`.
2. Write `routes.schema.json` (JSON Schema 2020-12) implementing the contract's Validation rules 1–8.
3. Write `model.js`, an ES module (`export function …`) with no dependencies:
   - `toGeoJSON(app)` per `#geojson-mapping`
   - `validate(app) → {ok, errors[]}` implementing rules 1–8 by hand
   - `diff(a, b) → {added[], changed[], removed[]}`, where each item is `{kind: "zone"|"route"|"poi"|"area", id}`.
4. Write `assemble_routes.py [--pilot] [--force] [--only <route ids>]`:
   - Load all seeds, plus `_pois.json` if it exists. Seeds with `"zone": null` add only their pois and areas.
   - `--only r26,r34`: keep only those routes, the zones they belong to, and `z-hut`. Keep all pois and areas.
   - Set `schema_version` 1, `published_at`, and `dem_version` (see the contract).
     - `--pilot`: `content_rev` 0, `"pilot": true`, seeds stay in place.
     - Otherwise: `content_rev` 1, then move the seeds to `content/archive/`.
   - Refuse to overwrite an existing `web/data/routes.json` unless `--force`; if forced, back it up to `build/routes.backup.<YYYYmmddHHMMSS>.json` first.
   - Run the validator before writing, and exit non-zero on errors.
5. Write `validate_routes.py <file>`, the same rules 1–8 in Python, exiting non-zero on errors. Write `test_model.mjs`, which imports `../web/js/model.js`, validates the given file and prints PASS or the errors.

## Acceptance
```
cd tools
python -m uv run assemble_routes.py --pilot --only r26,r34 --force
python -m uv run validate_routes.py ../web/data/routes.json      # PASS
node test_model.mjs ../web/data/routes.json                      # PASS
```
- The seeds hold 35 + 6 routes in total, each with a non-empty `description`.
