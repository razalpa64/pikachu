import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The mascot is the one part of this project that arrived as finished artwork
 * rather than something generated, so its failure mode is quiet: a clip stops
 * being referenced, or a file gets renamed, and the site keeps building while a
 * piece of the gift silently disappears. These tests make that loud.
 */

const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** every source gif that was supplied, and the clip(s) it must end up as */
const SOURCES: Record<string, string[]> = {
  '44-pikachu-pixel-usagif.gif': ['run.webp'],
  '60-pikachu-usagif.gif': ['shy.webp'],
  '61-pikachu-game-usagif.gif': ['hello.webp'],
  '70-pikachu-pixel-usagif.gif': ['cap.webp', 'materialise.webp'],
  '74-pikachu-christmas-usagif.gif': ['gift.webp'],
  '75-pikachu-usagif.gif': ['crowd.webp'],
  '78-pikachu-usagif.gif': ['curious.webp'],
};

const ALL_CLIPS = Object.values(SOURCES).flat();

/** the supplied PNGs: five became pickable avatars, three became framed scenes */
const PNG_AVATARS = ['pika-classic', 'pika-cheer', 'pika-cool', 'pika-vector', 'pika-side'];
const PNG_SCENES: Record<string, string> = {
  'image-1.png': 'meadow.webp',
  'image-3.png': 'goldenhour.webp',
  'image-6.png': 'storm.webp',
};

describe('the supplied artwork', () => {
  const pipeline = read('scripts/gifs.py');
  const mascot = read('src/mascot/PikachuMascot.tsx');

  it('converts every single source gif — none is left on the floor', () => {
    for (const [src, clips] of Object.entries(SOURCES)) {
      expect(pipeline, `${src} is never read by the pipeline`).toContain(src);
      for (const clip of clips) {
        expect(pipeline, `${src} never produces ${clip}`).toContain(clip);
      }
    }
  });

  it('ships every produced clip as a real file', () => {
    for (const clip of ALL_CLIPS) {
      const p = join(ROOT, 'public/art/pika', clip);
      expect(existsSync(p), `public/art/pika/${clip} is missing`).toBe(true);
      expect(readFileSync(p).length, `${clip} is suspiciously small`).toBeGreaterThan(4000);
    }
  });

  it('every clip is genuinely animated, not a still frame', () => {
    // RIFF/WEBP: an animated file carries an ANMF chunk, a static one does not
    for (const clip of ALL_CLIPS) {
      const buf = readFileSync(join(ROOT, 'public/art/pika', clip));
      expect(buf.subarray(0, 4).toString('latin1'), `${clip} is not a WebP`).toBe('RIFF');
      expect(buf.includes(Buffer.from('ANMF')), `${clip} is a STILL — the animation was lost`).toBe(true);
    }
  });

  it('references every clip from the mascot component', () => {
    for (const clip of ALL_CLIPS) {
      expect(mascot, `${clip} exists but nothing renders it`).toContain(clip);
    }
  });

  it('reaches the screen: every cut-out clip is mapped to a mascot state', () => {
    for (const clip of ['shy', 'hello', 'run', 'cap', 'materialise']) {
      expect(mascot, `${clip} is never used by any mascot state`).toMatch(new RegExp(`clip: '${clip}'`));
    }
  });

  it('reaches the screen: every framed scene is placed on a real screen', () => {
    const screens = readdirSync(join(ROOT, 'src/screens'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => read(join('src/screens', f)))
      .join('\n');
    for (const scene of ['gift', 'crowd', 'curious']) {
      expect(screens, `the ${scene} scene is never placed on a screen`).toContain(`clip="${scene}"`);
    }
  });

  it('covers all ten mascot states, with none falling back to nothing', () => {
    const states = ['idle', 'excited', 'thinking', 'competitive', 'victory',
      'defeated', 'waiting', 'sleeping', 'loading', 'error'];
    for (const s of states) {
      expect(mascot, `the ${s} state has no entry in LOOK`).toMatch(new RegExp(`^\\s*${s}:\\s*\\{`, 'm'));
    }
  });

  it('does not ship the raw gifs — 3.2 MB the browser never asks for', () => {
    expect(existsSync(join(ROOT, 'public/art/gif')),
      'the unconverted gifs are back in public/ and will be served to every visitor').toBe(false);
    expect(existsSync(join(ROOT, 'art-src/gif')),
      'the originals should be kept out of public/, not deleted').toBe(true);
  });

  it('turns every supplied PNG into something on the screen', () => {
    const identity = read('src/lib/identity.ts');
    for (const a of PNG_AVATARS) {
      expect(existsSync(join(ROOT, `public/art/mascot/${a}.webp`)), `${a}.webp is missing`).toBe(true);
      expect(identity, `${a} is shipped but never offered as an avatar`).toContain(a);
    }
    const pipeline2 = read('scripts/scenes.py');
    for (const [src, out] of Object.entries(PNG_SCENES)) {
      expect(pipeline2, `${src} is never converted`).toContain(src);
      expect(existsSync(join(ROOT, 'public/art/pika', out)), `${out} is missing`).toBe(true);
      expect(mascot, `${out} exists but nothing renders it`).toContain(out);
    }
  });

  it('places every framed PNG scene on a real screen', () => {
    const screens = readdirSync(join(ROOT, 'src/screens'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => read(join('src/screens', f)))
      .join('\n');
    for (const scene of ['meadow', 'goldenhour', 'storm']) {
      expect(screens, `the ${scene} scene is never placed on a screen`).toContain(`clip="${scene}"`);
    }
  });

  it('does not ship the png intermediates next to the webp the site loads', () => {
    const pngs = readdirSync(join(ROOT, 'public/art/mascot')).filter((f) => f.endsWith('.png'));
    expect(pngs, `${pngs.length} unreferenced png(s) are being served`).toEqual([]);
  });

  it('ships every painted board piece and runner sprite', () => {
    const files = [
      'public/art/piece/volt.webp', 'public/art/piece/spark.webp',
      'public/art/piece/checker-gold.webp', 'public/art/piece/checker-blush.webp',
      'public/art/run/runner.png', 'public/art/run/charge.webp',
      'public/art/run/drone.webp', 'public/art/run/tree.webp', 'public/art/run/wall.webp',
    ];
    for (const f of files) {
      expect(existsSync(join(ROOT, f)), `${f} is missing`).toBe(true);
      expect(readFileSync(join(ROOT, f)).length, `${f} is empty`).toBeGreaterThan(2000);
    }
  });

  it('actually renders those pieces instead of the old vector paths', () => {
    const ttt = read('src/components/boards/TicTacToeBoard.tsx');
    expect(ttt, 'the tic-tac-toe marks are still hand-drawn SVG').toContain('/art/piece/volt.webp');
    const c4 = read('src/components/boards/ConnectFourBoard.tsx');
    expect(c4, 'the Four in a Row discs are still a CSS gradient').toContain('/art/piece/');
    const chk = read('src/components/boards/CheckersBoard.tsx');
    expect(chk, 'the checkers pieces are still a CSS gradient').toContain('/art/piece/checker-');
  });

  it('ships a painted face for every memory card it claims to have painted', () => {
    const board = read('src/components/boards/MemoryBoard.tsx');
    const declared = board.match(/PAINTED_CARDS = new Set<CardId>\(\[([\s\S]*?)\]\)/);
    expect(declared, 'PAINTED_CARDS could not be found').toBeTruthy();
    const ids = [...declared![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(ids.length, 'no cards are declared as painted').toBeGreaterThan(0);
    for (const id of ids) {
      const f = `public/art/mem/${id}.webp`;
      expect(existsSync(join(ROOT, f)), `${id} is listed as painted but ${f} is missing`).toBe(true);
      expect(readFileSync(join(ROOT, f)).length, `${f} is empty`).toBeGreaterThan(2000);
    }
    expect(board, 'the painted faces are declared but never rendered').toContain('/art/mem/');
  });

  it('declares every memory card that has artwork on disk', () => {
    // guards the other direction: art generated but never switched on
    const board = read('src/components/boards/MemoryBoard.tsx');
    const onDisk = existsSync(join(ROOT, 'public/art/mem'))
      ? readdirSync(join(ROOT, 'public/art/mem')).filter((f) => f.endsWith('.webp')).map((f) => f.replace('.webp', ''))
      : [];
    const declared = board.match(/PAINTED_CARDS = new Set<CardId>\(\[([\s\S]*?)\]\)/)![1];
    for (const id of onDisk) {
      expect(declared, `public/art/mem/${id}.webp exists but ${id} is not in PAINTED_CARDS`).toContain(`'${id}'`);
    }
  });

  it('ships the truth-or-dare bottle and actually spins it', () => {
    const f = 'public/art/dare/bottle.webp';
    expect(existsSync(join(ROOT, f)), `${f} is missing`).toBe(true);
    expect(readFileSync(join(ROOT, f)).length, `${f} is empty`).toBeGreaterThan(2000);
    const bottle = read('src/games/dare/Bottle.tsx');
    expect(bottle, 'the bottle art is not used').toContain('/art/dare/bottle.webp');
    expect(bottle, 'the bottle never rotates').toContain('rotate(');
    const view = read('src/games/dare/SoloView.tsx');
    expect(view, 'truth or dare never shows the bottle').toContain('<Bottle');
  });

  it('uses no emoji in place of the artwork', () => {
    expect(mascot).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
