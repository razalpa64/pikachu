# Pikachu Arcade — where it actually stands

A report on the retrofit, written to be checked rather than admired. Every number
below is produced by a file in this repository or by a command named beside it;
nothing here is an estimate dressed up as a statistic.

Last updated with commit `b3076f2` (phase 6, merged as `dc96dde`).

## The two shelves

| | GBA | DOS |
|---|---|---|
| Games a visitor can play | **22** (committed homebrew) | **1** (`pikachu-calibration`, CC0) |
| Where the files live | `public/retro/roms/` (95 MB, in the repo) | `public/retro/dos/bundles/` (899 B, in the repo) + storage for uploads |
| Emulator | EmulatorJS 4.2.3 (MIT), mGBA core, lazy | js-dos 8.5.3 (GPL-2.0), DOSBox core, lazy |
| Document | `/retro/player.html` | `/retro/dos.html` |
| Page | `/retro/:id` | `/retro/dos/:id` |
| Licence evidence | per-cartridge, in `roms.json` and `NOTICE.txt` | per-title, in `site_content` key `dos.perm.<id>` |

Both players speak the same `pikachu-retro` postMessage contract, so the chrome
around them — pause, mute, fullscreen, error copy — behaves the same way in both.

## The discovery pipeline, in numbers

`npm run dos:import` reads the file tree of `YAL-PJ/dos-freeware-games-library`
and writes `public/retro/dos/catalog.json`. It downloads no game. The record of
that run:

| Stage | Count | Meaning |
|---|---|---|
| discovered | **1 499** | titles the source repository lists |
| metadata-only | **13** | listed, but the source has no bundle for them |
| pending-rights-review | **1 486** | a bundle exists at the source; **nobody has recorded a right to host it** |
| permission-approved | **0** | no evidence has been recorded for any title |
| downloaded with authorisation | **0** | no bundle was fetched, because nobody is authorised yet |
| ready-for-testing | **0** | — |
| playable | **0** | — |

Source labels, quoted rather than interpreted: **759 “Freeware”, 740 “Shareware”**.
Neither is a redistribution grant, which is why the pipeline stops at
`pending-rights-review` and why the importer can never promote a record on its
own. Five bundles were inspected structurally as a sample (`npm run
dos:import -- --inspect 5`); all five were valid ZIPs with a `.jsdos/dosbox.conf`.
That is a statement about the *format*, not about the right to host them.

The only playable DOS title is therefore the one this project owns outright:

```
public/retro/dos/bundles/pikachu-calibration.jsdos   899 B  (CC0-1.0)
  .jsdos/dosbox.conf   244 B   svga_s3 · 16 MB · cycles 8000 · autoexec mounts and runs CALIB.COM
  GAME/CALIB.COM       179 B   text banner → VGA mode 13h → four colour bands on A000:0 → keypress → back to text
  GAME/README.TXT      132 B
```

## What is verified, and by what

| Claim | Proof | Ran here? |
|---|---|---|
| The shelf pages render and never show a pending title | `src/screens/__tests__/retro-dos.test.ts` (jsdom, real components) | **yes** |
| A `.jsdos` bundle is a ZIP with `dosbox.conf`, no traversal, no bomb | `src/lib/__tests__/dos.test.ts` | **yes** |
| A “Freeware”/“Shareware” label is never treated as permission | same file, `judgeRedistribution` | **yes** |
| A DOS row cannot carry a GBA path (and vice versa) | `src/lib/__tests__/supabase-schema.test.ts` + PGlite | **yes** |
| The player document, the 1.4 MB core, the bundle and both manifests are served correctly | `npm run smoke:dos` | **yes, green** |
| js-dos draws a frame and the calibration bars are in it | `npm run e2e:retro:dos` (Playwright) | **no — no Chromium in this sandbox** |

`npm test` → 814 tests in 54 files. `tsc -b` clean. `npm run lint` → 0 errors.

The one claim this report will not make is “the DOS shelf plays”. The HTTP and
structural layers are proven; the framebuffer is not. On a machine with a browser,
`npm run e2e:retro:dos` is the check that turns that claim honest — it asserts on
canvas pixels, on pause holding the picture still, and on fullscreen taking the
viewport.

## What the admin desk can do

`/admin` → **DOS desk**:

- **Discovery queue** — search and filter 1 499 records by title, genre, year and
  decision. Approve or refuse writes a dated evidence string to `site_content`
  (`dos.perm.<id>`, ≤60 characters of key, ≤1 200 of value) and an audit row
  (`dos.approved` / `dos.blocked`). Approval records a right; it publishes
  nothing.
- **Upload** a `.jsdos` bundle — checked in the browser (ZIP, config present, no
  path escape, no size bomb), validated again by the shelf’s own validator before
  a byte is sent, stored as `<id>/game.jsdos` with a generated cover, inserted as
  `platform = 'dos'`, audited as `dos.upload`.
- **Manage** — publish, unpublish, delete, and test the player, drafts included.
  A draft preview is reachable only by an account the database calls an admin,
  because `listAllGames` is gated by row-level security.

`/admin` → **GBA shelf** is unchanged from phase 5 and still lists only
`platform = 'gba'` rows.

## Security and copyright posture

- Every publishing decision is server-refereed: RLS on `retro_games` and
  `site_content`, `is_admin()`, storage writes admin-only.
- Metadata and archives are treated as untrusted: allowlisted URLs only
  (`.jsdos` over https, or a path inside `/retro/dos/`), no absolute paths, no
  `..`, no `javascript:`, no protocol-relative sources, entry counts and claimed
  sizes bounded, bundle capped at 48 MB.
- Freeware/shareware labels are recorded and labelled as labels.
- Nothing was copied from a commercial ROM site; the RetroBrews collection was
  used for discovery only and nothing from it is mirrored.
- Unpublishing and deleting are buttons, and both drop the storage objects.

## Gaps, stated plainly

1. **No browser test of the DOS player in this environment.** See the table above.
2. **Migration `0006_dos.sql` has been rehearsed in PGlite only.** It has not been
   applied to a live Supabase project; the deploy order is `0001` → `0006`.
3. **Phase 5’s commit (`89e7958`) is not on `main`.** This branch was cut from
   `fcb1142`, so the migration runner and `admin:doctor --apply` that phase 5
   added are not part of this tree.
4. **No visitor-facing “add your own DOS game”.** A `.jsdos` bundle is a whole
   installation and cannot be verified the way a 156-byte cartridge header can,
   so DOS uploads stay behind the admin desk. The GBA “drop your own cartridge”
   path is unchanged.
5. **Recently-played and favourites are not on the retro shelf.** They exist for
   the arcade’s own games; wiring them to the retro library is not done, and this
   report would rather say so than have a row of empty carousels.
6. **The DOS discovery job is a maintainer script, not a scheduled job.** There is
   no GitHub Action yet; the admin desk says so and shows the last run’s source
   commit and date.
