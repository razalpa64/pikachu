/**
 * DOS shelf smoke test — what can be proved without a browser.
 *
 *   npx tsx scripts/smoke-dos.ts        (BASE defaults to http://127.0.0.1:5173)
 *
 * What this checks, over HTTP against a running dev server:
 *
 *   1. The player document, the vendored emulator and its core are actually
 *      served, and the core is a real WebAssembly module (magic bytes, not a 404
 *      page that happens to be 200 because of SPA fallback).
 *   2. The bundle the shelf advertises is served as a ZIP, opens as a ZIP, and
 *      contains the two files js-dos needs — the same check the admin form and
 *      the importer run.
 *   3. The shelf and index parse through the *shipped* parsers, and no record in
 *      the index claims to be playable.
 *
 * What it cannot check — and does not pretend to: that js-dos draws a frame.
 * That needs a real browser with WebAssembly, an AudioContext and a canvas; this
 * sandbox has no Chromium it can download, so "the game runs" is asserted by
 * `scripts/e2e/retro-dos.mjs` on a machine that has one, and nowhere else.
 */
import {
  MAX_BUNDLE_BYTES,
  inspectBundle,
  parseDosCatalog,
  parseDosShelf,
  validateDosGame,
} from '../src/lib/dos';
import { readZipDirectory, readZipEntry } from '../src/lib/zip';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const log = (...a: unknown[]) => console.log('  ', ...a);

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const get = (path: string) => fetch(new URL(path, BASE), { headers: { accept: '*/*' } });

const bytes = async (path: string) => {
  const res = await get(path);
  return { res, body: new Uint8Array(await res.arrayBuffer()) };
};

const json = async (path: string) => {
  const res = await get(path);
  const text = await res.text();
  try {
    return { res, data: JSON.parse(text) as unknown };
  } catch {
    return { res, data: undefined };
  }
};

async function main() {
  console.log(`\nDOS shelf smoke — ${BASE}\n`);

  /* ------------------------------------------------------- the documents */
  {
    const { res, body } = await bytes('/retro/dos.html');
    const html = new TextDecoder().decode(body);
    check('player document is served', res.ok, `${res.status} ${res.headers.get('content-type') ?? ''}`);
    check('it loads js-dos from our own folder', html.includes('/retro/jsdos/js-dos.js'));
    check('it pins the core path', html.includes('pathPrefix: "/retro/jsdos/"'));
    check('it asks for the small DOSBox backend', html.includes('backend: "dosbox"'));
    /* The allowlist is the thing that stops a crafted message booting anything
       else; assert it is in the document that shipped. */
    check('it refuses anything but a .jsdos URL', html.includes('.jsdos') && html.includes('safeUrl'));
  }

  /* --------------------------------------------------------- the emulator */
  {
    const js = await bytes('/retro/jsdos/js-dos.js');
    check('js-dos bundle is served', js.res.ok, `${js.res.status} · ${(js.body.length / 1024).toFixed(0)} KB`);
    check('it is JavaScript, not an SPA fallback page', !new TextDecoder().decode(js.body.slice(0, 200)).includes('<!doctype html'));

    const wasm = await bytes('/retro/jsdos/emulators/wdosbox.wasm');
    const magic = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
    const isWasm = magic.every((b, i) => wasm.body[i] === b);
    check('the DOSBox core is served', wasm.res.ok, `${wasm.res.status} · ${(wasm.body.length / 1024).toFixed(0)} KB`);
    check('the core is really WebAssembly', isWasm, `first bytes ${[...wasm.body.slice(0, 4)].join(' ')}`);

    for (const path of ['/retro/jsdos/js-dos.css', '/retro/jsdos/emulators/wdosbox.js', '/retro/jsdos/emulators/wlibzip.wasm']) {
      const res = await get(path);
      check(`served: ${path.replace('/retro/jsdos/', '')}`, res.ok, String(res.status));
    }
  }

  /* ------------------------------------------------------------ the shelf */
  const shelfFile = await json('/retro/dos/shelf.json');
  check('shelf manifest is JSON', !!shelfFile.data, String(shelfFile.res.status));
  const shelf = parseDosShelf(shelfFile.data);
  check('the shelf parses through the shipped validator', shelf.games.length > 0, `${shelf.games.length} game(s)`);
  check(
    'every shelf record validates',
    (shelfFile.data as { games?: unknown[] })?.games?.length === shelf.games.length,
    'no record was silently dropped',
  );

  /* ----------------------------------------------------------- the bundle */
  for (const game of shelf.games) {
    if (/^https:\/\//i.test(game.bundle)) {
      log(`${game.id}: bundle lives in storage — not fetched by this script`);
      continue;
    }
    const { res, body } = await bytes(`/retro/dos/${game.bundle}`);
    check(`${game.id}: bundle is served`, res.ok, `${res.status} · ${body.length} bytes`);
    check(`${game.id}: it is a ZIP`, body[0] === 0x50 && body[1] === 0x4b);
    check(`${game.id}: size matches the manifest`, body.length === game.bytes, `${body.length} vs ${game.bytes}`);
    check(`${game.id}: under the bundle cap`, body.length <= MAX_BUNDLE_BYTES);

    const entries = readZipDirectory(body);
    const conf = await readZipEntry(body, '.jsdos/dosbox.conf');
    const report = inspectBundle({ bytes: body, entries, conf: conf ? new TextDecoder().decode(conf) : null });
    check(`${game.id}: passes the structural check`, report.ok, report.problems.join(', '));
    /* The bundle is unpacked into C:\, so the program the [autoexec] starts has
       to be at the archive root. A name that only exists in a subdirectory is a
       black screen with no error — the exact failure this check exists for. */
    const program = (report.autoexec ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith(';'))
      .filter((line) => /\.(exe|com|bat)$/i.test(line))
      .pop();
    check(`${game.id}: has an [autoexec]`, !!report.autoexec, program ?? 'no program line');
    check(
      `${game.id}: the [autoexec] starts a file that is at the bundle root`,
      !!program && !!entries?.some((e) => e.name.toLowerCase() === program.toLowerCase()),
      program ?? 'no program line',
    );
  }

  /* ------------------------------------------------------------ the index */
  {
    const indexFile = await json('/retro/dos/catalog.json');
    check('discovery index is JSON', !!indexFile.data, String(indexFile.res.status));
    const index = parseDosCatalog(indexFile.data);
    check('the index parses', index.entries.length > 0, `${index.entries.length} records`);
    const playable = index.entries.filter((e) => e.stage === 'playable' || e.permission.status === 'approved');
    check('nothing in the index is playable or approved', playable.length === 0, playable.slice(0, 3).map((e) => e.id).join(', '));
    const noSource = index.entries.filter((e) => !e.sourceUrl.startsWith('https://'));
    check('every record keeps its original source', noSource.length === 0, `${noSource.length} without one`);

    /* A visitor must never be able to reach a pending record as a game: the
       shelf and the index are different files, and nothing bridges them. */
    const indexedIds = new Set(index.entries.map((e) => e.id));
    const leaked = shelf.games.filter((g) => indexedIds.has(g.id));
    check('no shelf game is a pending index record', leaked.length === 0, leaked.map((g) => g.id).join(', '));
    for (const game of shelf.games) {
      check(`shelf record validates on its own: ${game.id}`, validateDosGame(game) !== null);
    }
  }

  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
