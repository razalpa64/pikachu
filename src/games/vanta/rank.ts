/**
 * VANTA's table rank.
 *
 * The platform stores a per-game `GameStat` (played / wins / losses / draws /
 * best) and nothing else, so the rank has to be a *function of results the app
 * already records* rather than a second database that can disagree with them.
 *
 * The curve is an Elo-flavoured rating: every win is worth 34, every loss costs
 * 26, and experience itself nudges you up by 4 a match so a player who keeps
 * turning up is never stuck below a player who played twice. Tiers are checked
 * from Master down, so a rating can only ever land in one.
 *
 * It is deliberately *not* a claim about skill against the field — there is no
 * field. It is a cosmetic ladder for the profile screen, and the solo card says
 * so in as many words.
 */

export interface VantaStatLike {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  best: number;
}

export type VantaTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond' | 'Master';

export const TIERS: { tier: VantaTier; at: number; blurb: string }[] = [
  { tier: 'Master', at: 1680, blurb: 'Reads the room before it sits down.' },
  { tier: 'Diamond', at: 1500, blurb: 'Holds a relay sweep against the clock.' },
  { tier: 'Platinum', at: 1320, blurb: 'Punishes a repeated plan every time.' },
  { tier: 'Gold', at: 1180, blurb: 'Wins the relay race more often than not.' },
  { tier: 'Silver', at: 1040, blurb: 'Knows the read is worth more than the square.' },
  { tier: 'Bronze', at: 0, blurb: 'Still learning what the fifth action is for.' },
];

export const BASE_RATING = 1000;

export function vantaRating(stat: VantaStatLike | undefined): number {
  if (!stat) return BASE_RATING;
  const wins = stat.wins ?? 0;
  const losses = stat.losses ?? 0;
  const played = stat.played ?? 0;
  const draws = stat.draws ?? 0;
  const raw = BASE_RATING + wins * 34 - losses * 26 + draws * 8 + played * 4;
  return Math.max(400, Math.min(2200, Math.round(raw)));
}

export function rankFor(rating: number): { tier: VantaTier; blurb: string; progress: number; next: number | null } {
  for (let i = 0; i < TIERS.length; i++) {
    const t = TIERS[i];
    if (rating >= t.at) {
      const nextTier = i === 0 ? null : TIERS[i - 1];
      const span = nextTier ? nextTier.at - t.at : 1;
      const progress = nextTier ? Math.max(0, Math.min(1, (rating - t.at) / span)) : 1;
      return { tier: t.tier, blurb: t.blurb, progress, next: nextTier ? nextTier.at : null };
    }
  }
  return { tier: 'Bronze', blurb: TIERS[TIERS.length - 1].blurb, progress: 0, next: TIERS[TIERS.length - 2].at };
}
