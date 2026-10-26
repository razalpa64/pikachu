import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { adConsent, adsConfigured, setAdConsent } from '../lib/ads';
import { Button, Panel, Icon } from '../components/ui';
import { PikaScene, BoltRule } from '../mascot';
import { supabaseEnabled } from '../lib/supabase';
import { useState } from 'react';

/**
 * Privacy — written from what the code actually does, not from a template.
 *
 * Every paragraph here is checkable against the repository: the storage keys are
 * the ones in `store.tsx`/`identity.ts`, the cloud paragraph is true only when
 * Supabase is configured, and the advertising paragraph is true only when a
 * publisher id exists. If any of those change, this page has to change with
 * them — which is why it reads the same modules the app does.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="display text-[20px] sm:text-[23px] text-cream-100 mb-2">{title}</h2>
      <div className="text-[13.5px] text-cream-300 leading-relaxed flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

export default function Privacy() {
  const { settings } = useStore();
  const [consent, setConsent] = useState(() => adConsent());
  const cloud = supabaseEnabled();
  const ads = adsConfigured();

  return (
    <div className="mx-auto max-w-[880px] px-[var(--shell-pad)] py-8">
      <header className="mb-7 flex items-start justify-between gap-6">
        <div>
          <p className="eyebrow text-volt-700 mb-1.5">The short version</p>
          <h1 className="display text-[30px] sm:text-[40px] text-cream-100 leading-none">Privacy</h1>
          <p className="text-[13.5px] text-cream-500 mt-2 max-w-[62ch]">
            No advertising profile, and an account only if you make one. Almost everything this arcade
            knows lives in your own browser — this page says exactly what, and how to erase it.
          </p>
        </div>
        <PikaScene clip="curious" className="hidden md:block w-[220px] shrink-0" rounded={20} tilt={1.2} />
      </header>

      <Panel className="p-5 sm:p-7">
        <Section title="What stays on your device">
          <p>
            Your trainer name, mascot, level, XP, per-game record, favourites, daily challenge progress,
            sound and motion settings, and the list of games you have opened recently are all stored in
            your browser's <strong>localStorage</strong> under keys beginning <code className="font-mono text-[12.5px]">pikachu.</code>.
            A session flag records that you have already seen the intro.
          </p>
          <p>
            None of it is transmitted anywhere to make the site work. Clearing site data for this domain
            deletes all of it at once, and the arcade starts fresh — there is nothing to cancel and
            nothing to request.
          </p>
        </Section>

        <Section title="What a match sends">
          <p>
            Solo and “same device” games never touch the network. An <strong>online room</strong> connects
            to the arcade's own referee server over a WebSocket: it receives your room code, seat, display
            name and the moves you make, and it sends back the authoritative board. The server keeps a
            match only in memory; rooms disappear when everyone leaves and nothing is written to disk.
          </p>
          <p>
            Chat inside a room is relayed to the two people in that room and is not stored. Hidden
            information — the opponent's fleet, their hand, their role in Imposter, the undealt cards — is
            stripped on the server before anything reaches your browser.
          </p>
          <p>
            <strong>Looking for a random opponent</strong> puts you in a queue on the same referee server for
            as long as you keep looking; leaving the page, pressing “Stop looking”, being matched or waiting
            five minutes takes you out of it. While you are connected, the server also publishes an anonymous
            count — how many people are playing each game and how many are waiting — so the lobby can show it.
            That count carries no names, no ids and nothing that survives a restart.
          </p>
        </Section>

        <Section title="Friends, blocks and reports (only if you sign in)">
          <p>
            Playing a stranger needs no account at all. A <strong>friend list</strong> does, because a
            friend is a person on another device rather than a name in this browser — so if this
            deployment has a cloud database and you sign in, the following is stored against your account
            instead of in your browser:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>your <strong>handle</strong>, the short name a friend types to find you — exact match only,
              so nobody can browse a list of players;</li>
            <li><strong>friendships</strong>, which both of you can see, and which a decline simply deletes;</li>
            <li><strong>blocks</strong>, which only you can read. The person you blocked is never told and
              cannot discover it, and your block list is sent to the referee server so it can keep the two
              of you apart;</li>
            <li><strong>reports</strong>, which you file as yourself and which only the maintainer can read —
              they are never posted publicly, unlike a note on the feedback wall.</li>
          </ul>
          <p>
            Signing in means the referee server verifies your session with the same auth service before it
            believes who you are, and it uses your account id for the connection instead of the random id
            your browser made up. It still stores no games, no results and no messages: rooms live in
            memory and disappear with them.
          </p>
          <p>
            <strong>Mute</strong> is the exception to all of this: it is a setting in this browser, it hides
            one person's chat from you, it is never sent anywhere, and they are not told.
          </p>
          <p>
            Deleting your account in the Supabase dashboard removes the profile, friend requests, blocks and
            reports it owns. The site keeps no copy.
          </p>
        </Section>

        <Section title={cloud ? 'Feedback, and the cloud sync that is switched on here' : 'Feedback'}>
          <p>
            Notes you write on the <Link to="/feedback" className="font-bold text-blush-600 hover:underline">feedback page</Link> are
            always saved on your device first.
            {cloud
              ? ' This deployment also has an optional Supabase project configured, so a valid note is additionally stored there so it can actually be read. It holds the note, the kind you picked, an optional rating, an optional first name and contact, and the game it refers to — nothing else, and no account.'
              : ' This deployment has no cloud database configured, so those notes only ever exist in your browser and are never sent anywhere.'}
          </p>
          <p>
            Audio and artwork are served from this domain. There are no analytics scripts, no tracking
            pixels, no third-party fonts fetched at runtime (the two typefaces ship with the site), and no
            cookies at all.
          </p>
        </Section>

        <Section title="Advertising">
          {ads ? (
            <>
              <p>
                Advertising is enabled on this deployment. Ads are served by Google AdSense, only after you
                allow them, and only in fixed slots below the content of a page — never inside a game,
                never over a board, never next to an answer or a card you are about to tap.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[12px] font-bold text-cream-500">
                  Your choice: {consent === 'granted' ? 'ads allowed' : consent === 'denied' ? 'ads off' : 'not decided — ads are off'}
                </span>
                <Button size="sm" variant="ghost" onClick={() => { setAdConsent('denied'); setConsent('denied'); }}>Keep ads off</Button>
                <Button size="sm" variant="ghost" onClick={() => { setAdConsent('granted'); setConsent('granted'); }}>Allow ads</Button>
              </div>
              <p>
                Google may use cookies for ad personalisation once you allow it; withdrawing consent in the
                button above stops the ad units rendering. See Google's own explanation of how it uses
                data from partner sites.
              </p>
            </>
          ) : (
            <p>
              There are no advertisements on this deployment. The codebase has a single, inert ad slot
              that renders nothing unless a real publisher id is configured <em>and</em> you explicitly
              allow ads — so today the page loads no advertising script at all, and no placeholder
              rectangle is pretending to be one.
            </p>
          )}
        </Section>

        <Section title="Children, and what this is">
          <p>
            The arcade is a personal, non-commercial project made as a gift. It collects nothing about you
            and has no login, so there is no profile to share or delete. Games are suitable for a general
            audience; the truth-or-dare deck can be filtered to “cosy” prompts from inside that game.
          </p>
        </Section>

        <Section title="Your controls">
          <p>
            Sound is off by default and is remembered in your settings; motion follows your system's
            reduced-motion preference and can be forced off in{' '}
            <Link to="/settings" className="font-bold text-blush-600 hover:underline">settings</Link>
            {' '}(currently {settings.motion === 'off' ? 'motion is off' : 'motion follows your device'}).
            Everything else is cleared with your browser's site-data controls. If something here is wrong
            or unclear, the <Link to="/feedback" className="font-bold text-blush-600 hover:underline">feedback page</Link> reaches
            the person who built it.
          </p>
        </Section>

        <p className="text-[11.5px] text-cream-400 border-t-2 border-ink-600 pt-4 flex items-center gap-1.5">
          <Icon name="shield" size={13} /> Last reviewed against the code in this repository, October 2026.
        </p>
      </Panel>

      <BoltRule className="mt-8" />
      <p className="text-center text-[11.5px] text-cream-400 mt-4">
        Pikachu is a trademark of Nintendo / Creatures Inc. / GAME FREAK. This is a personal,
        non-commercial project made for two people.
      </p>
    </div>
  );
}
