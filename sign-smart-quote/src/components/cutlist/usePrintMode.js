import { useEffect, useRef } from 'react';

/**
 * Scopes print behavior to this page via a `print-cutlist` class on <body>,
 * so the existing bare `window.print()` in QuoteDocument.jsx (which has no
 * print CSS of its own) is never affected by rules gated on that class.
 */
export function usePrintMode() {
  const mqlRef = useRef(null);

  useEffect(() => {
    const off = () => document.body.classList.remove('print-cutlist');
    window.addEventListener('afterprint', off);

    // Safari doesn't reliably fire `afterprint`; matchMedia is the fallback.
    if (window.matchMedia) {
      const mql = window.matchMedia('print');
      const handler = (e) => {
        if (!e.matches) off();
      };
      mql.addEventListener ? mql.addEventListener('change', handler) : mql.addListener(handler);
      mqlRef.current = { mql, handler };
    }

    return () => {
      window.removeEventListener('afterprint', off);
      if (mqlRef.current) {
        const { mql, handler } = mqlRef.current;
        mql.removeEventListener ? mql.removeEventListener('change', handler) : mql.removeListener(handler);
      }
      off();
    };
  }, []);

  const print = () => {
    document.body.classList.add('print-cutlist');
    // Let the class commit and layout settle before the print dialog blocks the thread.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  return { print };
}
