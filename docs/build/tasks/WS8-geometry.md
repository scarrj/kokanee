# WS8 Geometry: place descent and skin lines (lead + nested zone agents)
**Lead:** Sonnet, medium · **Zone agents:** **Opus, high** · **Depends:** WS1 (`terrain_probe.py` + merged DEM), WS5 (seeds)
**Scope:**
- pilot: no fan-out. The lead (or a single Opus agent) does r26, r34, one closure polygon, and the cabin/heli-pad POIs.
- full: one nested agent per zone.

## Goal
For each route, author `descent` and `skin` coordinates and the zone `info_point`, interpreting the guide text against real terrain. Record confidence and reasoning honestly.

## Read (zone agents)
- **Only** your zone's section of `docs/source/topo.md`, plus `#hut`
- `docs/source/geo_reference.md`
- `CONTRACTS.md#app-json` (routes, areas)
- your seed file `content/seed/<zone>.json`.

## Own
- Zone agent: **only** `content/seed/<zone>.json`, plus a notes file `build/geometry/<zone>.md` (not committed).
- Lead: `tools/check_routes.py` and the fan-out bookkeeping.
- Pilot only: `content/seed/z-longer-tours.json` (r34), `content/seed/z-john-carter.json` (r26), and a new `content/seed/z-pilot-areas.json` (`{zone: null, routes: [], pois: [cabin heli-pad], areas: [closure]}`)

## Do not read
Other zones' seeds, the PDF, lidar files, `web/js/*`.

## Method (zone agent)
1. **List each route's anchors from the text:** start (summit, saddle, "2100 m on the S ridge", etc.), end (lake, valley floor, pass), aspect, stated vertical, and approach waypoints.
2. **Resolve the anchors to coordinates:**
   - `terrain_probe.py summit|saddle|lakes`, near the named features in geo_reference
   - elevation constraints with `profile`
   - aspect with `aspect`.
3. **Descent:**
   - Start at the anchor and follow `fall-line`, then adjust the line to honour the text: the aspect, "stay in the trees", "skier's left of the drainage", the end point.
   - 15–60 vertices. Avoid crossing cliffs where the slope is over 50° unless the text implies it.
4. **Skin:**
   - From the cabin (or from the previous route's end, where the text says "same approach"), along the described approach.
   - Reuse shared approach geometry: copy identical coordinates for the common stretch, e.g. Kaslo Lake → Griffin Creek for the Nansen routes.
   - Keep skin tracks to sensible angles (mostly under 25° terrain).
5. **Checks:** run `terrain_probe.py profile` on each line. The descent must lose elevation overall, and its vertical should be within ±30% of the guide's.
6. **Write results** to the seed: `descent`, `skin`, `confidence` (high/medium/low), `approx: true`, and `notes` (append "Placement: <one or two sentences on the anchors used and any doubt>").
7. **`info_point`** at a visible spot near the zone's centre (not on top of a line).

## Pilot specifics
- **r26 Cat Fish Comes Home.** Riddles Knob (2160 m) is on the treed rib between Commission and Outlook creeks, S of Kaslo Lake. Skin from the cabin to the S end of Kaslo Lake, then up the rib. Descend about 260 m back to the lake shore.
- **r34 The Keyhole.** The guide text is wrong (it duplicates Mark's Slot). Use the zone intro ("up Kokanee Glacier … between the Battleship and Mt Kitchener … 2,700 m") and the ATES "Keyhole" landmark. Set `confidence: "low"` and explain in `notes`.
- **Closure polygon:** `areas[0]` with `kind: "closure"`. If the user has supplied an extent, use it. Otherwise draw a test polygon named "TEST closure (replace)", `source: "test"`.
- **POIs:** the cabin and the heli-pad (just N/NW of the cabin).

## Lead (full)
1. Launch one nested agent per zone in parallel, each in its own worktree and branch `ws8-<zone>`, using the ORCHESTRATOR launch template plus: `ZONE=<id>. Read only your zone section.`
2. Merge the branches. There are no conflicts because each agent owns one file.
3. Run `check_routes.py`. Re-launch any zone whose routes fail, with the failure lines in the prompt.
4. Fold the user's exported pilot edits into the seeds before the full assembly (see ORCHESTRATOR).

## Acceptance
```
cd tools && python -m uv run check_routes.py --seeds   # every route: descent loses elevation, vertical within ±30% or flagged, % by source printed
```
