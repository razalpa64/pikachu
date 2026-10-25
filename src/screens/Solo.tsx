import { Suspense, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { gameBySlug } from '../games/registry';
import { SOLO_VIEWS } from '../games/views';
import type { GameMeta } from '../games/types';
import { ElectricLoader } from '../mascot';
import { GameAbout } from '../components/GameAbout';
import { Button, EmptyState, Icon } from '../components/ui';
import { useStore } from '../lib/store';

export default function Solo() {
  const { slug = '' } = useParams();
  const nav = useNavigate();
  const { visit, sfx } = useStore();
  const game = useMemo(() => gameBySlug(slug), [slug]);

  useEffect(() => {
    if (!game) return;
    visit(game.id, 'solo');
    /* A short hello on the way in. It is the same voice as the opening cry, cut
       to half a second, so arriving in a game sounds like the arcade answering
       you rather than like a notification. Silent until a gesture has unlocked
       audio, which by the time you have clicked a game it always has. */
    sfx('open');
  }, [game?.id]);

  if (!game) {
    return (
      <div className="mx-auto max-w-[760px] px-[var(--shell-pad)] py-14">
        <EmptyState mascot="error" title="No such game"
          body={`Nothing in the library matches “${slug}”. It may have been renamed.`}
          action={<Button onClick={() => nav('/library')} icon={<Icon name="back" size={14} />}>Back to the library</Button>} />
      </div>
    );
  }

  const View = SOLO_VIEWS[game.id];
  if (!View) {
    return (
      <div className="mx-auto max-w-[760px] px-[var(--shell-pad)] py-14">
        <EmptyState mascot="waiting" title={`${game.title} has no single-player mode`}
          body="This one is built for two. Start a private room and invite your player two."
          action={<Button onClick={() => nav('/together')} icon={<Icon name="users" size={14} />}>Play together</Button>} />
      </div>
    );
  }

  return (
    <>
      <Suspense fallback={
        <div className="min-h-[70vh] grid place-items-center">
          <ElectricLoader status={`Loading ${game.title}`} detail="Fetching the engine for this game." />
        </div>
      }>
        <View game={game} />
      </Suspense>
      {/* rules, modes and related games as plain prose — below the board, so it
          never delays the first move (see GameAbout for why it also matters
          off-screen: the in-play rulebook is a closed disclosure) */}
      <GameAbout game={game} />
    </>
  );
}
