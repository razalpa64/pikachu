import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  adConsent, adUnitFor, adsConfigured, loadAdScript, setAdConsent, type AdPlacement,
} from '../lib/ads';
import { Button, Icon } from './ui';

/**
 * AdSlot — reserved space for one advertisement, or nothing at all.
 *
 * With no publisher id configured (the state of this deployment) the component
 * renders `null`: no empty box, no dashed "your ad here", no layout shift. With
 * an id configured and no decision yet, it asks once, in place, in the site's own
 * language — and either answer is remembered. With consent, it renders the unit
 * inside a box whose height is already reserved.
 *
 * It is deliberately *not* a floating or sticky unit: it can never cover a
 * board, a control, or an answer button, because it is only ever placed in the
 * page flow below real content.
 */
export function AdSlot({ placement, className = '' }: { placement: AdPlacement; className?: string }) {
  const [consent, setConsent] = useState(() => adConsent());
  const [ready, setReady] = useState(false);
  const insRef = useRef<HTMLModElement>(null);
  const unit = adUnitFor(placement);

  useEffect(() => {
    const onChange = () => setConsent(adConsent());
    window.addEventListener('pikachu:consent', onChange);
    return () => window.removeEventListener('pikachu:consent', onChange);
  }, []);

  useEffect(() => {
    if (!unit || consent !== 'granted') return;
    let cancelled = false;
    void loadAdScript(unit.client).then(() => {
      if (cancelled) return;
      setReady(true);
      try {
        const w = window as unknown as { adsbygoogle?: unknown[] };
        (w.adsbygoogle = w.adsbygoogle || []).push({});
      } catch {
        // An ad blocker or a rejected request is a normal visitor state.
      }
    });
    return () => { cancelled = true; };
  }, [unit, consent]);

  if (!adsConfigured() || !unit) return null;

  if (consent === null) {
    return (
      <aside className={`panel notch-sm p-3.5 flex flex-wrap items-center gap-3 ${className}`} aria-label="Advertising choices">
        <div className="flex-1 min-w-[220px]">
          <p className="text-[12.5px] font-extrabold text-cream-100">Support the arcade with an ad?</p>
          <p className="text-[11.5px] text-cream-500 leading-snug mt-0.5">
            Ads are off until you say so, they never appear inside a game, and you can change this
            in <Link to="/privacy" className="font-bold text-blush-600 hover:underline">privacy</Link>.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="ghost" onClick={() => { setAdConsent('denied'); setConsent('denied'); }}>Keep them off</Button>
          <Button size="sm" variant="primary" onClick={() => { setAdConsent('granted'); setConsent('granted'); }}>Allow ads</Button>
        </div>
      </aside>
    );
  }

  if (consent === 'denied') return null;

  return (
    <aside className={`${className}`} aria-label="Advertisement">
      <p className="eyebrow text-[9px] mb-1 flex items-center gap-1.5"><Icon name="external" size={10} />Advertisement</p>
      {/* min-height is reserved up front so the ad can never push the page down */}
      <div className="relative panel notch-sm overflow-hidden grid place-items-center" style={{ minHeight: 112 }}>
        <ins
          ref={insRef}
          className="adsbygoogle block w-full"
          style={{ display: 'block' }}
          data-ad-client={unit.client}
          data-ad-slot={unit.slot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
        {!ready && <span className="text-[10.5px] text-cream-400 absolute">Loading…</span>}
      </div>
    </aside>
  );
}

export default AdSlot;
