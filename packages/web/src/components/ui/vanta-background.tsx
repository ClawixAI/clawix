'use client';

import { useEffect, useRef, useState } from 'react';

interface VantaBackgroundProps {
  effect: 'net' | 'topology';
  children: React.ReactNode;
  className?: string;
}

export function VantaBackground({ effect, children, className }: VantaBackgroundProps) {
  const bgRef = useRef<HTMLDivElement>(null);
  const effectRef = useRef<{ destroy: () => void } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!bgRef.current || typeof window === 'undefined') return;

    let cancelled = false;

    async function init() {
      try {
        if (effect === 'net') {
          const THREE = await import('three');
          (window as unknown as Record<string, unknown>)['THREE'] = THREE;
          const mod = await import('vanta/dist/vanta.net.min');

          if (cancelled || !bgRef.current) return;

          effectRef.current = mod.default({
            el: bgRef.current,
            THREE,
            mouseControls: false,
            touchControls: false,
            gyroControls: false,
            minHeight: 200,
            minWidth: 200,
            scale: 1.0,
            scaleMobile: 1.0,
            color: 0x888888,
            backgroundColor: 0x0a0a0a,
            points: 12,
            maxDistance: 18,
            spacing: 20,
            showDots: true,
          });
        } else {
          // Topology uses p5.js, not THREE
          const p5Module = await import('p5');
          const p5 = p5Module.default;
          (window as unknown as Record<string, unknown>)['p5'] = p5;
          const mod = await import('vanta/dist/vanta.topology.min');

          if (cancelled || !bgRef.current) return;

          effectRef.current = mod.default({
            el: bgRef.current,
            p5,
            mouseControls: false,
            touchControls: false,
            gyroControls: false,
            minHeight: 200,
            minWidth: 200,
            scale: 0.25,
            scaleMobile: 0.25,
            color: 0x64a0ff,
            backgroundColor: 0x0a0a0a,
          });
        }

        if (!cancelled) setReady(true);
      } catch (e) {
        // Silently degrade — don't let Vanta errors bubble to error overlay
        console.debug('[VantaBackground] init skipped:', e);
      }
    }

    void init();

    return () => {
      cancelled = true;
      if (effectRef.current) {
        try { effectRef.current.destroy(); } catch { /* ignore */ }
        effectRef.current = null;
      }
      setReady(false);
    };
  }, [effect]);

  return (
    <div className={`relative ${className ?? ''}`}>
      <div
        ref={bgRef}
        className={`fixed inset-0 -z-10 transition-opacity duration-1000 ${ready ? (effect === 'topology' ? 'opacity-60' : 'opacity-30') : 'opacity-0'}`}
        style={{ maskImage: 'linear-gradient(to bottom, transparent 0%, black 30%)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 30%)' }}
      />
      {children}
    </div>
  );
}
