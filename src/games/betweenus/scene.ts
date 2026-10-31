/**
 * BETWEEN US — the signal room, in three dimensions.
 *
 * One room. Two stations. A listener and an operator, standing at opposite ends
 * of the same bunker, each seeing half of the truth.
 *
 * Everything is built from geometry and generated textures: no imported models,
 * no stock photographs. That is deliberate — the room has to feel like a real
 * place at any camera distance, and a room made of boxes with a concrete shader
 * reads better than a downloaded chair.
 *
 * The scene owns *presentation and input only*. It renders the view the relay
 * gives it and emits moves; it never decides whether the dials are right.
 */
import * as THREE from 'three';
import { GLYPHS, paintGlyph } from './glyphs';
import { SYMBOL_DIGIT, type BeuMove } from './rules';

export type Station = 'listener' | 'operator' | 'spectator';

export interface SceneView {
  station: Station;
  /** glyph indices currently lit — only the listener ever receives these */
  code: number[];
  /** glyph index → digit, the plate the operator reads */
  legend: number[];
  dials: number[];
  strikes: number;
  strikesLeft: number;
  round: number;
  rounds: number;
  solved: boolean;
  over: boolean;
  /** bumped by the relay on every resolved pull, so the room can react once */
  eventKey: string;
}

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ textures */

function textureFrom(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Wet concrete: mottled base, aggregate speckle, a few hairline cracks. */
function concrete(w = 512, h = 512, tint = '#6a6d68'): THREE.CanvasTexture {
  return textureFrom(w, h, (ctx) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
    let seed = 1337;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 900; i++) {
      const x = rnd() * w, y = rnd() * h, r = 8 + rnd() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const shade = rnd() > 0.5 ? 255 : 0;
      g.addColorStop(0, `rgba(${shade},${shade},${shade},${0.02 + rnd() * 0.045})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < 2200; i++) {
      ctx.fillStyle = `rgba(${rnd() > 0.5 ? 210 : 20},${rnd() > 0.5 ? 210 : 20},20,${rnd() * 0.05})`;
      ctx.fillRect(rnd() * w, rnd() * h, 1.4, 1.4);
    }
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = `rgba(20,22,20,${0.1 + rnd() * 0.2})`;
      ctx.lineWidth = 0.7 + rnd();
      ctx.beginPath();
      let x = rnd() * w, y = rnd() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 7; k++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // damp patches near the bottom
    const damp = ctx.createLinearGradient(0, h * 0.55, 0, h);
    damp.addColorStop(0, 'rgba(0,0,0,0)');
    damp.addColorStop(1, 'rgba(24,30,26,.35)');
    ctx.fillStyle = damp;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
  });
}

/** Badly maintained steel: brushed lines and rust blooms. */
function steel(w = 512, h = 512): THREE.CanvasTexture {
  return textureFrom(w, h, (ctx) => {
    ctx.fillStyle = '#4a4f52';
    ctx.fillRect(0, 0, w, h);
    let seed = 99;
    const rnd = () => (seed = (Math.imul(seed, 22695477) + 1) >>> 0) / 4294967296;
    for (let i = 0; i < 2400; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${rnd() * 0.03})`;
      ctx.lineWidth = rnd() * 1.2;
      const y = rnd() * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + (rnd() - 0.5) * 3); ctx.stroke();
    }
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w, y = rnd() * h, r = 10 + rnd() * 70;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${120 + rnd() * 60},${60 + rnd() * 30},20,${0.16 + rnd() * 0.3})`);
      g.addColorStop(1, 'rgba(120,60,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // rivets
    for (let x = 24; x < w; x += 64) for (const y of [24, h - 24]) {
      const g = ctx.createRadialGradient(x - 2, y - 2, 0, x, y, 7);
      g.addColorStop(0, 'rgba(230,235,240,.5)');
      g.addColorStop(0.6, 'rgba(90,95,100,.5)');
      g.addColorStop(1, 'rgba(20,22,24,.6)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    }
  });
}

/** A dial face: numbers 0–7 around the rim, a pointer notch, a knurled centre. */
function dialFace(): THREE.CanvasTexture {
  return textureFrom(512, 512, (ctx) => {
    const s = 512, c = s / 2;
    const body = ctx.createRadialGradient(c - 60, c - 80, 20, c, c, c);
    body.addColorStop(0, '#8d9296');
    body.addColorStop(0.55, '#5b6165');
    body.addColorStop(1, '#2c3033');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(c, c, c - 4, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = 'rgba(230,236,240,.5)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(c, c, c - 22, 0, Math.PI * 2); ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const r = c - 68;
      ctx.save();
      ctx.translate(c + Math.cos(a) * r, c + Math.sin(a) * r);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = 'rgba(240,244,246,.92)';
      ctx.font = '700 54px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(String(i), 0, 0);
      ctx.restore();
      // tick between numbers
      const ta = a + Math.PI / 8;
      ctx.strokeStyle = 'rgba(230,236,240,.35)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(ta) * (c - 30), c + Math.sin(ta) * (c - 30));
      ctx.lineTo(c + Math.cos(ta) * (c - 48), c + Math.sin(ta) * (c - 48));
      ctx.stroke();
    }

    // knurled hub
    ctx.fillStyle = '#23272a';
    ctx.beginPath(); ctx.arc(c, c, 96, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * 78, c + Math.sin(a) * 78);
      ctx.lineTo(c + Math.cos(a) * 96, c + Math.sin(a) * 96);
      ctx.stroke();
    }
    ctx.fillStyle = '#b9c0c4';
    ctx.beginPath(); ctx.arc(c, c, 20, 0, Math.PI * 2); ctx.fill();
  });
}

/* ------------------------------------------------------------------ the room */

interface Dial {
  group: THREE.Group;
  knob: THREE.Mesh;
  angle: number;
  target: number;
  index: number;
}

export interface RoomHandle {
  setView(v: SceneView): void;
  setHover(): void;
  resize(): void;
  dispose(): void;
  /** for tests and for the HUD: what the pointer is currently over */
  hovered(): string | null;
}

export function createRoom(
  canvas: HTMLCanvasElement,
  opts: { station: Station; onMove: (m: BeuMove) => void; reducedMotion?: boolean },
): RoomHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090b);
  scene.fog = new THREE.FogExp2(0x0a0d10, 0.032);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 60);

  /* --- lights --------------------------------------------------------- */
  const ambient = new THREE.AmbientLight(0x46525c, 1.5);
  scene.add(ambient);
  // a cool bounce from the far wall, so the shadows are not black holes
  const fill = new THREE.HemisphereLight(0x59707f, 0x241c14, 1.1);
  scene.add(fill);

  const lamp = new THREE.PointLight(0xffd9a0, 34, 16, 2);
  lamp.position.set(0, 2.75, 0.1);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.bias = -0.0015;
  scene.add(lamp);
  const lampBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xffe6b8 }),
  );
  lampBulb.position.copy(lamp.position);
  scene.add(lampBulb);

  const wallGlow = new THREE.PointLight(0x53a8ff, 6, 8, 2);
  wallGlow.position.set(0, 1.15, -2.75);
  scene.add(wallGlow);

  /* the operator's own light: a gooseneck lamp clipped to the console, which is
     both how you see the dials and why the rest of the room falls away */
  const consoleLamp = new THREE.SpotLight(0xffcf94, 22, 7, 0.85, 0.5, 1.6);
  consoleLamp.position.set(0.2, 2.25, 2.55);
  consoleLamp.target.position.set(0, 1.35, 3.15);
  consoleLamp.castShadow = true;
  consoleLamp.shadow.mapSize.set(1024, 1024);
  scene.add(consoleLamp, consoleLamp.target);

  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 0.3, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide,
      emissive: 0x2a1408, emissiveIntensity: 0.6 }),
  );
  shade.position.set(0.2, 2.3, 2.55);
  scene.add(shade);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffe9c0 }),
  );
  bulb.position.set(0.2, 2.22, 2.55);
  scene.add(bulb);
  const goose = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x2c3236, metalness: 0.8, roughness: 0.4 }),
  );
  goose.position.set(0.2, 2.6, 2.55);
  scene.add(goose);

  /* --- the shell ------------------------------------------------------ */
  const W = 9, H = 3.4, D = 7.4;
  const conc = concrete();
  conc.wrapS = conc.wrapT = THREE.RepeatWrapping;
  conc.repeat.set(3, 1.4);
  const floorTex = concrete(512, 512, '#5c5f5a');
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(4, 3.4);

  const wallMat = new THREE.MeshStandardMaterial({ map: conc, roughness: 0.94, metalness: 0.02 });
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.88, metalness: 0.04 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshStandardMaterial({ color: 0x24282b, roughness: 0.9 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  scene.add(ceiling);

  const wall = (w: number, h: number, x: number, y: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  wall(W, H, 0, H / 2, -D / 2, 0);              // north (signal wall)
  wall(W, H, 0, H / 2, D / 2, Math.PI);         // south (console wall)
  wall(D, H, -W / 2, H / 2, 0, Math.PI / 2);    // west
  wall(D, H, W / 2, H / 2, 0, -Math.PI / 2);    // east

  /* --- pipes and clutter ---------------------------------------------- */
  const steelMat = new THREE.MeshStandardMaterial({ map: steel(), roughness: 0.62, metalness: 0.72 });
  const pipeGeo = new THREE.CylinderGeometry(0.11, 0.11, W - 1.2, 14);
  for (const [y, z, r] of [[2.95, -3.2, 0.02], [2.88, -2.98, -0.03]] as const) {
    const p = new THREE.Mesh(pipeGeo, steelMat);
    p.rotation.z = Math.PI / 2;
    p.position.set(0, y, z);
    p.castShadow = true;
    scene.add(p);
    void r;
  }
  for (let i = 0; i < 5; i++) {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.18), steelMat);
    bracket.position.set(-3.4 + i * 1.7, 2.95, -3.1);
    scene.add(bracket);
  }

  /* cable trays + a dead fluorescent tube, because a bunker is never tidy */
  const tray = new THREE.Mesh(new THREE.BoxGeometry(W - 2, 0.06, 0.34), steelMat);
  tray.position.set(0, 3.16, 1.2);
  scene.add(tray);
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 2.2, 10),
    new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.4, metalness: 0.3, emissive: 0x223033, emissiveIntensity: 0.4 }),
  );
  tube.rotation.z = Math.PI / 2;
  tube.position.set(1.8, 3.0, 1.2);
  scene.add(tube);

  /* --- the signal wall ------------------------------------------------- */
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(3.1, 1.9, 0.09),
    new THREE.MeshStandardMaterial({ map: steel(), color: 0x8f969b, roughness: 0.5, metalness: 0.6 }),
  );
  plate.position.set(0, 1.75, -D / 2 + 0.06);
  plate.castShadow = true;
  scene.add(plate);

  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(2.9, 1.62, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x14181b, roughness: 0.78, metalness: 0.18 }),
  );
  bezel.position.set(0, 1.75, -D / 2 + 0.13);
  scene.add(bezel);

  /* three glyph panels, each its own emissive plane so it can light up alone */
  const glyphTiles: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  const halos: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  const haloTex = textureFrom(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(150,200,255,.55)');
    g.addColorStop(0.45, 'rgba(90,150,230,.18)');
    g.addColorStop(1, 'rgba(60,110,190,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  });
  for (let i = 0; i < 3; i++) {
    const tex = new THREE.CanvasTexture(glyphCanvas(0, false));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.35 });
    const tile = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.78), mat);
    tile.position.set(-0.9 + i * 0.9, 1.75, -D / 2 + 0.17);
    scene.add(tile);
    glyphTiles.push(tile);

    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    halo.position.set(-0.9 + i * 0.9, 1.75, -D / 2 + 0.155);
    scene.add(halo);
    halo.material.map = haloTex;
    halo.material.needsUpdate = true;
    halos.push(halo);
  }

  /* --- the console ----------------------------------------------------- */
  const deskMat = new THREE.MeshStandardMaterial({ map: steel(), color: 0x9aa1a6, roughness: 0.55, metalness: 0.7 });
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.9, 0.8), deskMat);
  desk.position.set(0, 0.62, D / 2 - 0.56);
  desk.castShadow = true;
  desk.receiveShadow = true;
  scene.add(desk);

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(3.05, 0.07, 0.92),
    new THREE.MeshStandardMaterial({ color: 0x2f3437, roughness: 0.42, metalness: 0.55 }),
  );
  top.position.set(0, 1.09, D / 2 - 0.56);
  top.castShadow = true;
  top.receiveShadow = true;
  scene.add(top);

  /* dials */
  const faceTex = dialFace();
  const dials: Dial[] = [];
  for (let i = 0; i < 3; i++) {
    const group = new THREE.Group();
    group.position.set(-0.8 + i * 0.8, 1.24, D / 2 - 0.62);
    /* tilted towards the person at the console, so a dial face is something you
       read rather than something you look at edge-on */
    group.rotation.x = -0.95;

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.28, 0.14, 40),
      new THREE.MeshStandardMaterial({ color: 0x3a4044, roughness: 0.5, metalness: 0.8 }),
    );
    body.castShadow = true;
    group.add(body);

    const knob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.23, 0.1, 48),
      [new THREE.MeshStandardMaterial({ color: 0x22262a, metalness: 0.7, roughness: 0.55 }),
        new THREE.MeshStandardMaterial({ map: faceTex, metalness: 0.45, roughness: 0.42 }),
        new THREE.MeshStandardMaterial({ color: 0x22262a, metalness: 0.7, roughness: 0.55 })],
    );
    knob.position.y = 0.11;
    knob.rotation.y = Math.PI / 3;
    knob.castShadow = true;
    knob.userData.pick = `dial:${i}`;
    group.add(knob);

    // a red index mark on the edge of the knob, so the reading is never ambiguous
    const mark = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.012, 0.11),
      new THREE.MeshBasicMaterial({ color: 0xff3b25 }),
    );
    mark.position.set(0, 0.17, 0.185);
    knob.add(mark);

    scene.add(group);
    dials.push({ group, knob, angle: 0, target: 0, index: i });
  }

  /* the legend plate over the console: glyph, and the number it stands for */
  const legendTex = textureFrom(1024, 256, (ctx) => {
    ctx.fillStyle = '#1b2024';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = 'rgba(200,210,215,.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, 1012, 244);
    for (let i = 0; i < GLYPHS.length; i++) {
      const x = 64 + i * 128;
      ctx.save();
      ctx.translate(x - 30, 40);
      paintGlyph(ctx, 60, i, { lit: true, ink: 'rgba(210,220,230,.85)', glow: 'rgba(120,180,255,.4)' });
      ctx.restore();
      ctx.fillStyle = 'rgba(255,238,196,.95)';
      ctx.font = '700 54px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(SYMBOL_DIGIT[i]), x, 196);
    }
  });
  const legend = new THREE.Mesh(
    new THREE.PlaneGeometry(1.72, 0.44),
    new THREE.MeshBasicMaterial({ map: legendTex, transparent: false }),
  );
  legend.position.set(0, 2.02, D / 2 - 0.90);
  legend.rotation.y = Math.PI;
  scene.add(legend);
  // a steel frame around the plate, so it is bolted to the wall like everything else
  const legendFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.6, 0.05),
    new THREE.MeshStandardMaterial({ map: steel(), color: 0x8b9297, metalness: 0.6, roughness: 0.55 }),
  );
  legendFrame.position.set(0, 2.02, D / 2 - 0.86);
  legendFrame.rotation.y = Math.PI;
  scene.add(legendFrame);

  /* the lever */
  const leverPivot = new THREE.Group();
  leverPivot.position.set(1.42, 1.06, D / 2 - 0.56);
  const leverArm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.045, 0.52, 12),
    new THREE.MeshStandardMaterial({ color: 0xb9c2c8, metalness: 0.9, roughness: 0.28 }),
  );
  leverArm.position.y = 0.26;
  leverArm.castShadow = true;
  leverPivot.add(leverArm);
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.095, 20, 16),
    new THREE.MeshStandardMaterial({ color: 0xc02a1e, roughness: 0.3, metalness: 0.1, emissive: 0x3a0a06, emissiveIntensity: 1 }),
  );
  knob.position.y = 0.52;
  knob.castShadow = true;
  knob.userData.pick = 'lever';
  leverPivot.add(knob);
  leverPivot.rotation.x = -0.28;
  scene.add(leverPivot);

  /* --- the door, with a status lamp ----------------------------------- */
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 2.3, 1.4),
    new THREE.MeshStandardMaterial({ map: steel(), color: 0x777f84, roughness: 0.6, metalness: 0.65 }),
  );
  door.position.set(-W / 2 + 0.06, 1.15, 0.4);
  door.castShadow = true;
  scene.add(door);
  const doorLampMat = new THREE.MeshStandardMaterial({ color: 0x5a1010, emissive: 0xff2a12, emissiveIntensity: 1.4 });
  const doorLamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), doorLampMat);
  doorLamp.position.set(-W / 2 + 0.14, 2.45, 0.4);
  scene.add(doorLamp);

  /* --- the other person ------------------------------------------------- */
  const person = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x8a6f58, roughness: 0.82 });
  const coatMat = new THREE.MeshStandardMaterial({ color: 0x2b3a44, roughness: 0.88 });
  const trouserMat = new THREE.MeshStandardMaterial({ color: 0x1d252b, roughness: 0.92 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.5, 6, 16), coatMat);
  torso.position.y = 1.12;
  torso.castShadow = true;
  person.add(torso);
  // shoulders, so it reads as a person from behind rather than a pill
  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.34, 5, 12), coatMat);
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.y = 1.36;
  shoulders.castShadow = true;
  person.add(shoulders);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.44, 4, 10), coatMat);
    arm.position.set(side * 0.25, 1.06, 0.02);
    arm.rotation.z = side * 0.08;
    arm.castShadow = true;
    person.add(arm);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.42, 4, 10), trouserMat);
    leg.position.set(side * 0.1, 0.42, 0);
    leg.castShadow = true;
    person.add(leg);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10), skinMat);
  neck.position.y = 1.45;
  person.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 22, 18), skinMat);
  head.position.y = 1.56;
  head.castShadow = true;
  person.add(head);
  // a knitted cap, because everybody in a bunker is wearing one
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.142, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: 0x704a2e, roughness: 1 }),
  );
  cap.position.y = 1.575;
  person.add(cap);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffd27a, emissiveIntensity: 2 });
  const headLamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), lampMat);
  headLamp.position.set(0, 1.6, 0.12);
  person.add(headLamp);
  const headTorch = new THREE.SpotLight(0xffd8a0, 6, 5, 0.5, 0.6, 1.5);
  headTorch.position.set(0, 1.6, 0.12);
  headTorch.target.position.set(0, 1.2, 2);
  person.add(headTorch, headTorch.target);
  scene.add(person);

  /* --- dust ------------------------------------------------------------ */
  const dustCount = 220;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * W * 0.9;
    dustPos[i * 3 + 1] = Math.random() * H;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * D * 0.9;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xffe3b0, size: 0.018, transparent: true, opacity: 0.5, depthWrite: false, sizeAttenuation: true,
  }));
  scene.add(dust);

  /* --- the camera: one station, one view ------------------------------- */
  const listener = opts.station === 'listener';
  if (opts.station === 'spectator') {
    camera.position.set(3.2, 2.4, 0);
    person.position.set(1.4, 0, 1.9);
    person.rotation.y = Math.PI;
  } else if (listener) {
    // two and a half metres from the wall, at eye height, slightly off centre
    camera.position.set(-0.45, 1.66, -0.75);
    person.position.set(1.75, 0, 1.4);
    person.rotation.y = Math.PI * 0.92;
  } else {
    camera.position.set(0.5, 1.72, 0.95);
    person.position.set(-1.85, 0, -0.9);
    person.rotation.y = 0.12;
  }
  const lookAt = listener
    ? new THREE.Vector3(0.05, 1.72, -3.4)
    : opts.station === 'spectator' ? new THREE.Vector3(0, 1.4, 0) : new THREE.Vector3(0, 1.5, 3.4);
  camera.lookAt(lookAt);
  camera.fov = listener ? 54 : 58;
  camera.updateProjectionMatrix();

  /* --- state ----------------------------------------------------------- */
  let view: SceneView | null = null;
  let hoveredPick: string | null = null;
  let lastEventKey = '';
  let shake = 0;
  let flash = 0;
  let flashColor = new THREE.Color(0xff3b25);
  let leverPull = 0;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(0, 0);

  function glyphCanvas(index: number, lit: boolean): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);
    paintGlyph(ctx, 256, index, { lit });
    return c;
  }

  function setGlyphTile(tile: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>, index: number | null) {
    if (!tile.material.map) return;
    const src = glyphCanvas(index ?? 0, index !== null);
    const tex = new THREE.CanvasTexture(src);
    tex.colorSpace = THREE.SRGBColorSpace;
    tile.material.map.dispose();
    tile.material.map = tex;
    tile.material.opacity = index === null ? 0.13 : 1;
    tile.material.needsUpdate = true;
    tile.visible = true;
  }

  /* --- interaction ------------------------------------------------------ */
  const pickables: THREE.Object3D[] = [];
  scene.traverse((o) => { if (o.userData.pick) pickables.push(o); });

  function updatePointer(ev: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    const next = hits.length ? (hits[0].object.userData.pick as string) : null;
    if (next !== hoveredPick) {
      hoveredPick = next;
      canvas.style.cursor = next ? 'pointer' : 'default';
      for (const d of dials) ((d.knob.material as THREE.MeshStandardMaterial[])[1]).emissive.setHex(0x000000);
      const k = next?.startsWith('dial') ? dials[Number(next.split(':')[1])] : null;
      if (k) (k.knob.material as THREE.MeshStandardMaterial[])[1].emissive = new THREE.Color(0x223344);
    }
  }

  function onPointerMove(ev: PointerEvent) {
    updatePointer(ev);
    // a little head movement, so the room feels like it is being stood in
    const nx = pointer.x, ny = pointer.y;
    if (opts.station !== 'spectator') {
      camera.position.x = baseCam.x + nx * 0.09;
      camera.position.y = baseCam.y + ny * 0.045;
      camera.lookAt(lookAt);
    }
  }

  function onPointerDown(ev: PointerEvent) {
    updatePointer(ev);
    if (!hoveredPick) return;
    if (hoveredPick === 'lever') {
      leverPull = 1;
      opts.onMove({ t: 'pull' });
      return;
    }
    if (hoveredPick.startsWith('dial')) {
      const index = Number(hoveredPick.split(':')[1]);
      /* the left half of a dial turns it down, the right half up — the same
         gesture on a phone and with a mouse, with no second control to find */
      const r = canvas.getBoundingClientRect();
      const dialScreenX = screenXOf(dials[index].group);
      const delta = ev.clientX - r.left < dialScreenX ? -1 : 1;
      opts.onMove({ t: 'dial', index, delta });
    }
  }

  const baseCam = camera.position.clone();
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);

  function screenXOf(obj: THREE.Object3D): number {
    const v = obj.getWorldPosition(new THREE.Vector3()).project(camera);
    return ((v.x + 1) / 2) * canvas.getBoundingClientRect().width;
  }

  /* --- per-frame -------------------------------------------------------- */
  const clock = new THREE.Clock();
  let raf = 0;
  let reduced = !!opts.reducedMotion;

  function frame() {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    if (!reduced) {
      // lamp flicker: a slow swell with an occasional stutter
      const flicker = 0.9 + Math.sin(t * 1.7) * 0.05 + (Math.sin(t * 11.3) > 0.965 ? -0.28 : 0);
      lamp.intensity = 26 * flicker;
      lampBulb.material.opacity = 1;
      dust.rotation.y = t * 0.01;
      (dust.material as THREE.PointsMaterial).opacity = 0.35 + Math.sin(t * 0.7) * 0.08;
    }

    // dials ease towards the value the relay says they hold
    for (const d of dials) {
      const diff = d.target - d.angle;
      if (Math.abs(diff) > 0.0005) d.angle += diff * Math.min(1, dt * 14);
      d.knob.rotation.y = d.angle;
    }

    // the lever springs back
    if (leverPull > 0) {
      leverPull = Math.max(0, leverPull - dt * 1.6);
      leverPivot.rotation.x = -0.28 - Math.sin(leverPull * Math.PI) * 0.55;
    }

    // a wrong pull shakes the room and reddens it; a right one floods it white-blue
    if (flash > 0) {
      flash = Math.max(0, flash - dt * 1.5);
      scene.background = new THREE.Color(0x07090b).lerp(flashColor, flash * 0.55);
      wallGlow.color.copy(new THREE.Color(0x53a8ff)).lerp(flashColor, flash);
    }
    if (shake > 0) {
      shake = Math.max(0, shake - dt * 2.2);
      camera.position.x = baseCam.x + (Math.random() - 0.5) * shake * 0.05;
      camera.position.y = baseCam.y + (Math.random() - 0.5) * shake * 0.05;
    }

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  resize();
  raf = requestAnimationFrame(frame);

  return {
    setView(v: SceneView) {
      const first = view === null;
      view = v;
      resize();

      // dials
      v.dials.forEach((value, i) => {
        if (dials[i]) dials[i].target = (value / 8) * Math.PI * 2;
      });

      // the wall
      const lit = v.station === 'listener' && !v.over ? v.code : [];
      glyphTiles.forEach((tile, i) => {
        setGlyphTile(tile, lit[i] ?? null);
        tile.material.opacity = lit.length ? 1 : 0.12;
      });
      halos.forEach((halo, i) => {
        halo.material.opacity = lit[i] !== undefined ? 1 : 0;
      });
      wallGlow.intensity = lit.length ? 5.5 : 0.6;
      wallGlow.color.set(lit.length ? 0x53a8ff : 0x2a3238);

      // the door tells you where you are without a word of text
      if (v.over) {
        doorLampMat.emissive.set(v.solved ? 0x2bff88 : 0xff2a12);
        doorLampMat.emissiveIntensity = v.solved ? 2.4 : 1.8;
      } else {
        doorLampMat.emissive.set(v.strikes > 0 ? 0xff7a12 : 0xff2a12);
      }

      // events fire once each
      const key = `${v.round}:${v.strikes}:${v.over}`;
      if (!first && v.eventKey !== lastEventKey && lastEventKey !== '') {
        if (v.strikes > 0) { flash = 1; flashColor = new THREE.Color(0xff2a12); shake = 1; }
        else { flash = 0.5; flashColor = new THREE.Color(0x9fd8ff); }
      }
      lastEventKey = v.eventKey;
    },
    setHover() { /* kept for the HUD; hover is handled by the pointer itself */ },
    resize,
    hovered: () => hoveredPick,
    dispose() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      renderer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      void reduced;
    },
  };
}
