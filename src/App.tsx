import { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { StoreProvider, useStore } from './lib/store';
import { RoomProvider } from './lib/useRoom';
import { ToastStack } from './components/ui';
import { ElectricLoader } from './mascot';
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

function RouteFallback() {
  return <div className="min-h-[58vh] grid place-items-center"><ElectricLoader status="Just a moment" detail="Loading this part of the arcade for the first time." /></div>;
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, [pathname]);
  return null;
}

function Shell() {
  const { introSeen, setIntroSeen } = useStore();
  const [booted, setBooted] = useState(introSeen);

  /* Warm the route + game chunks in the background once the hub is interactive,
     so the first click into a game is instant instead of a cold network fetch. */
  useEffect(() => { if (booted) idlePrefetch(); }, [booted]);

  if (!booted) return <Intro onDone={() => { setIntroSeen(true); setBooted(true); }} />;

  return (
    <RoomProvider>
      <ScrollTop />
      <AppShell>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/library" element={<Library />} />
            <Route path="/together" element={<PlayTogether />} />
            <Route path="/room/:code" element={<Room />} />
            <Route path="/solo" element={<SoloHub />} />
            <Route path="/solo/:slug" element={<Solo />} />
            <Route path="/challenges" element={<Challenges />} />
            <Route path="/music" element={<Music />} />
            <Route path="/achievements" element={<Achievements />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/feedback" element={<Feedback />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
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
