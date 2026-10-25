import { Suspense, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { gameBySlug } from '../games/registry';
import { SOLO_VIEWS } from '../games/views';
import type { GameMeta } from '../games/types';
import { ElectricLoader } from '../mascot';
import { Button, EmptyState, Icon } from '../components/ui';
import { useStore } from '../lib/store';

export default function Solo() {
  const { slug = '' } = useParams();
  const nav = useNavigate();
  const { visit } = useStore();
  const game = useMemo(() => gameBySlug(slug), [slug]);

  useEffect(() => { if (game) visit(game.id, 'solo'); }, [game?.id]);
  useEffect(() => { if (game) document.title = `${game.title} — PIKACHU`; return () => { document.title = 'PIKACHU'; }; }, [game?.id]);

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
    <Suspense fallback={
      <div className="min-h-[70vh] grid place-items-center">
        <ElectricLoader status={`Loading ${game.title}`} detail="Fetching the engine for this game." />
      </div>
    }>
      <View game={game} />
    </Suspense>
  );
}
