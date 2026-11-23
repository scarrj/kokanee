# Orchestrator guide

The orchestrator is an **Opus** session. It launches each workstream (WS) as a sub-agent in a **nested session** or worktree, merges the results, runs the gates and keeps `STATUS.md` up to date. It does not write feature code itself; WS0 is the one exception.

## Mechanics
- **Launching a card.**
  - Preferred: a new session per card (Claude Code desktop `start_session`, or `claude` in a new worktree), with `use_worktree: true` and branch `wsN-<slug>` (pilot runs use `wsN-<slug>-pilot`).
  - Alternative: the `Agent` tool with `isolation: "worktree"` and the card's `model`.
- **Nested sessions.** Only WS8 nests. The WS8 lead launches one child per zone with the same mechanism and the zone card section. It must pass `model: opus`.
- **Model and effort.** Use what the card header says. Never upgrade a card's model unless a re-run failed twice.
- **One writer per file.** Within a phase, *Own* lists never overlap. Check this before launching in parallel.
- **Merging.** The orchestrator merges branches into `main` locally in dependency order, then runs the acceptance commands of everything merged so far. The orchestrator never pushes until the deploy gate.

### Shared-checkout mode (used for the pilot)
The source data, `build/`, `tools/cache/` and `tools/.venv` are git-ignored, so a fresh worktree doesn't have them. While Own lists don't overlap, cards may therefore run as parallel sub-agents in the **main checkout**, with these rules:
- Agents **do not commit**. After reviewing each card's report, the orchestrator commits that card's Own files (`git add <own paths>`, message `WSn: …`).
- Agents must not run `uv add`/`uv sync` or edit `tools/pyproject.toml`. If they need an extra package, use `python -m uv run --with <pkg> …` for one-off tools, or ask in ISSUES.
- If a card does run in a worktree, set the env var `KOKANEE_ROOT` to the main checkout's absolute path. Tools resolve the source data, `build/` and `tools/cache/` through `terrain_common.root()`, which honours `KOKANEE_ROOT`.

## Launch template
Use this exact text, filling in the `<>` parts:
```
You are a build agent for the Kokanee 3D topo. Read, in order: CLAUDE.md, docs/build/CONTEXT.md,
docs/build/tasks/<CARD>.md (only the sections it names in CONTRACTS.md). Scope: <PILOT|FULL>.
Only edit files in your card's Own list. Run the Acceptance commands until they pass.
Shared-checkout mode: do NOT commit (the orchestrator commits your Own files). Worktree mode: commit on your branch with message "<CARD>: <summary>". Reply ONLY with the report format.
```

## report
Agents reply with this, 10 lines max:
```
CARD: WSn <slug> | SCOPE: pilot|full | STATUS: done|blocked|partial
BRANCH: wsN-... @ <short sha>
FILES: <changed paths, comma-separated>
ACCEPTANCE: <command> -> pass|fail (<key numbers>)
DECISIONS: <anything chosen that others must know, or "none">
ISSUES: <open problems / requests for other cards, or "none">
```
The orchestrator appends each report to `STATUS.md`, unchanged.

## Phases, dependencies and gates
```
Phase 0  WS0 (orchestrator)                                          -> GATE A: user approves DEM source + downloads
Phase 1  PILOT (scope = pilot area, routes r26 + r34, 1 closure polygon)
  wave 1 (parallel): WS1 terrain · WS2 basemap · WS3 viewer · WS5 text · WS7 pwa
  wave 2 (parallel): WS4 metrics (needs WS1 tiles.json + pilot tiles)
                     WS6 store+editor (needs WS3 + WS5 merged)
                     WS8 geometry, pilot routes only, no fan-out (needs WS1 + WS5)
  wave 3: integrate -> WS9 QA -> fix loop (route bugs to owner cards) -> pilot measurements
         -> write docs/decisions/zoom-limits.md                       -> GATE B: user reviews pilot on PC + phone
Phase 2  FULL (scope = full bbox, all zones)
  wave 1: WS1 full · WS2 full (WS3/WS5/WS7 only if pilot feedback needs changes)
  wave 2: WS8 lead fans out 8 nested zone agents (Opus) · WS4 re-run parity on full tiles
  wave 3: assemble_routes.py (ONCE, orchestrator) -> WS9 QA -> fixes -> orchestrator final review
                                                                       -> GATE C: user approves first push (deploys Pages)
```

**Gate rules.** At a gate, stop and ask the user with a short summary and the evidence files. Never assume a gate is approved.
- **Gate A:** includes the HRDEM window, MRDEM window, BC Freshwater Atlas and glacier-outline downloads.
- **Gate C:** commits must use the git identity the user chooses.

## Model routing
| Card | Model | Effort | Why |
|---|---|---|---|
| WS1 terrain, WS4 metrics, WS6 store+editor | Sonnet | high | correctness-critical numeric/data logic |
| WS2 basemap, WS3 viewer, WS7 pwa, WS9 QA | Sonnet | medium | standard engineering |
| WS5 text | Haiku | low | mechanical transcription |
| WS8 lead | Sonnet | medium | fan-out, merge and checks only |
| WS8 zone agents | Opus | high | spatial interpretation of prose against terrain |

## Re-run procedure
1. If a card reports `blocked` or `fail`, read only its report and the failing acceptance output.
2. Fix the cause: a contract gap → edit `CONTRACTS.md` and notify the dependants; missing input → re-run the upstream card.
3. Re-launch the same card on a fresh branch, `wsN-<slug>-r2`, adding one line to the prompt: `Previous attempt failed: <reason>. Avoid: <x>.`
4. After two failures, escalate the model one tier, or ask the user.

## Merge order and integration checks
- **Merge order:** WS5 → WS1 → WS2 → WS3 → WS4 → WS6 → WS7 → WS8.
- After each merge, run:
  ```
  cd tools && python -m uv run check_all.py --quick
  ```
  (`check_all.py` is owned by WS9. Before it exists, run each merged card's acceptance commands.)
- **Pilot assembly.** The pilot builds `routes.json` with `assemble_routes.py --pilot` (writes `content_rev: 0`, `"pilot": true`). Before Phase 2:
  1. Ask the user to "Export" any edits they made while reviewing the pilot.
  2. Fold those edits back into `content/seed/` (WS8 lead).
  3. Then do the one real assembly with `--force`, which backs up the pilot file first.
- **Assembly happens once**, in Phase 2 wave 3:
  ```
  python -m uv run assemble_routes.py
  ```
  After that, `web/data/routes.json` is canonical and the seed files live in `content/archive/`.
