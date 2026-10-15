const KEY = 'pikachu.identity.v1';

export interface Identity { playerId: string; name: string; mascot: string; greeting: string; createdAt: number }

const MASCOTS = ['classic', 'cheer', 'cool', 'vector', 'side'] as const;
export type MascotKey = (typeof MASCOTS)[number];
export const MASCOT_KEYS = MASCOTS;
export const MASCOT_ART: Record<string, string> = {
  classic: '/art/mascot/pika-classic.webp',
  cheer: '/art/mascot/pika-cheer.webp',
  cool: '/art/mascot/pika-cool.webp',
  vector: '/art/mascot/pika-vector.webp',
  side: '/art/mascot/pika-side.webp',
};
export const MASCOT_LABEL: Record<string, string> = {
  classic: 'Classic', cheer: 'Cheer', cool: 'Shades', vector: 'Bold', side: 'Profile',
};

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function loadIdentity(): Identity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Identity;
      if (parsed?.playerId) return { ...parsed, greeting: parsed.greeting ?? '' };
    }
  } catch { /* fall through */ }
  const fresh: Identity = { playerId: uuid(), name: '', mascot: 'classic', greeting: '', createdAt: Date.now() };
  saveIdentity(fresh);
  return fresh;
}

export function saveIdentity(id: Identity) {
  try { localStorage.setItem(KEY, JSON.stringify(id)); } catch { /* storage disabled */ }
}
