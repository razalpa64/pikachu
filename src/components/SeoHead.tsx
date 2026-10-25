import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applySeo, seoForPath } from '../lib/seo';

/**
 * SeoHead — one place that knows what every route is *about*.
 *
 * Mounted above the shell (not inside it) so the title, canonical and
 * description are correct even while the first-run intro is on screen.
 */
export function SeoHead() {
  const { pathname } = useLocation();
  useEffect(() => {
    applySeo(seoForPath(pathname));
  }, [pathname]);
  return null;
}

export default SeoHead;
