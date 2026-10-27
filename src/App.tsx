import { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { StoreProvider, useStore } from './lib/store';
import { RoomProvider } from './lib/useRoom';
import { ToastStack } from './components/ui';
import AppShell from './components/AppShell';
import { SeoHead } from './components/SeoHead';
import { idlePrefetch } from './lib/prefetch';
import Intro from './screens/Intro';
import Home from './screens/Home';

const Library = lazy(() => import('./screens/Library'));
const PlayTogether = lazy(() => import('./screens/PlayTogether'));
const Room = lazy(() => import('./screens/Room'));
const SoloHub = lazy(() => import('./screens/SoloHub'));
const Solo = lazy(() => import('./screens/Solo'));
const Challenges = lazy(() => import('./screens/Challenges'));
const Music = lazy(() => import('./screens/Music'));
const Achievements = lazy(() => import('./screens/Achievements'));
const Profile = lazy(() => import('./screens/Profile'));
const SettingsScreen = lazy(() => import('./screens/Settings'));
const Feedback = lazy(() => import('./screens/Feedback'));
const Privacy = lazy(() => import('./screens/Privacy'));
const Retro = lazy(() => import('./screens/Retro'));
const RetroPlayer = lazy(() => import('./screens/RetroPlayer'));
/* The second platform. Its own document because js-dos and EmulatorJS are
   different machines with different bundles — sharing a page would mean shipping
   both runtimes to everybody. */
const RetroDosPlayer = lazy(() => import('./screens/RetroDos'));
/* Not in the nav, not in the sitemap, noindex — and empty until the server says
   the signed-in account is on the admin roster. */
const Admin = lazy(() => import('./screens/Admin'));

/**
 * What you see while a route's chunk arrives.
 *
 * It used to be a spinner in the middle of 58vh, which on a phone is a blank
 * screen with a dot on it — the least app-like thing on the site. A skeleton of
 * the page's own shape (a title, a search bar, cards) says "this screen exists
 * and is filling in", and it costs nothing when the chunk is already cached
 * because it is replaced in the same frame.
 */
function RouteFallback() {
  return (
    <div className="mx-auto w-full max-w-[1340px] px-[var(--shell-pad)] pt-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading this part of the arcade.</span>
      <div className="skel h-3 w-24 rounded-full" />
      <div className="skel h-8 w-52 rounded-lg mt-3" />
      <div className="skel h-4 w-full max-w-[420px] rounded-md mt-3" />
      <div className="skel h-4 w-2/3 max-w-[300px] rounded-md mt-2" />
      <div className="skel h-11 w-full rounded-full mt-6" />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border-2 border-ink-600 overflow-hidden">
            <div className="skel aspect-[16/10]" />
            <div className="p-3 space-y-2">
              <div className="skel h-4 w-2/3 rounded-md" />
              <div className="skel h-3 w-1/2 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, [pathname]);
  return null;
}

function Shell() {
  const { introSeen, setIntroSeen } = useStore();
  const { pathname } = useLocation();
  /**
   * The intro belongs to the front door only.
   *
   * It used to run on every route, so somebody following a shared link to
   * /solo/chess-arena — or arriving from a search result — waited out a splash
   * before seeing the thing they asked for. Deep links now render immediately;
   * the intro is the welcome you get when you arrive at the arcade itself.
   */
  const [booted, setBooted] = useState(() => introSeen || pathname !== '/');

  /* Warm the route + game chunks in the background once the hub is interactive,
     so the first click into a game is instant instead of a cold network fetch. */
  useEffect(() => { if (booted) idlePrefetch(); }, [booted]);

  if (!booted) return <Intro onDone={() => { setIntroSeen(true); setBooted(true); }} />;

  return (
    <RoomProvider>
      <ScrollTop />
      <AppShell>
        {/* Keyed on the path so each screen enters with the app's fade, and so a
            stale screen can never be left behind by a Suspense boundary. */}
        <Suspense fallback={<RouteFallback />}>
        <div key={pathname} className="screen-enter">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/library" element={<Library />} />
            <Route path="/together" element={<PlayTogether />} />
            <Route path="/room/:code" element={<Room />} />
            <Route path="/solo" element={<SoloHub />} />
            <Route path="/solo/:slug" element={<Solo />} />
            <Route path="/challenges" element={<Challenges />} />
            <Route path="/retro" element={<Retro />} />
            {/* `/retro/dos` is a platform lens on the one shelf, not a second shelf. */}
            <Route path="/retro/dos" element={<Navigate to="/retro?platform=dos" replace />} />
            <Route path="/retro/dos/:id" element={<RetroDosPlayer />} />
            <Route path="/retro/:id" element={<RetroPlayer />} />
            <Route path="/music" element={<Music />} />
            <Route path="/achievements" element={<Achievements />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/feedback" element={<Feedback />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        </Suspense>
      </AppShell>
      <ToastStack />
    </RoomProvider>
  );
}

export default function App() {
  return (
    <StoreProvider>
      {/* Above the shell on purpose: a first-time visitor — or a crawler — sees
          the three-second intro first, and the <head> should already describe the
          page they asked for while that plays. */}
      <SeoHead />
      <Shell />
    </StoreProvider>
  );
}
