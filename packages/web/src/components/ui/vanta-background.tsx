'use client';

import { useEffect, useRef, useState } from 'react';

interface VantaBackgroundProps {
  effect: 'net' | 'topology';
  children: React.ReactNode;
  className?: string;
}

interface VantaInstance {
  destroy: () => void;
  /** Bound resize handler Vanta registers on `window` itself. */
  resize?: () => void;
}

export function VantaBackground({ effect, children, className }: VantaBackgroundProps) {
  const bgRef = useRef<HTMLDivElement>(null);
  const effectRef = useRef<VantaInstance | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!bgRef.current || typeof window === 'undefined') return;

    let cancelled = false;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;

    function destroyEffect() {
      if (effectRef.current) {
        try {
          effectRef.current.destroy();
        } catch {
          /* ignore */
        }
        effectRef.current = null;
      }
    }

    async function createEffect() {
      // Suppress THREE.js deprecation warnings from vanta.js
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        const msg = args[0];
        if (typeof msg === 'string' && msg.includes('vertexColors')) return;
        originalWarn.apply(console, args);
      };

      try {
        let instance: VantaInstance;

        if (effect === 'net') {
          const THREE = await import('three');
          (window as unknown as Record<string, unknown>)['THREE'] = THREE;
          const mod = await import('vanta/dist/vanta.net.min');

          if (cancelled || !bgRef.current) return;

          instance = mod.default({
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

          instance = mod.default({
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

        // Vanta registers its own `window` resize listener that resizes the
        // canvas in place (p5.resizeCanvas / renderer.setSize). For the
        // topology effect this crashes: its flow-field grid is built once at
        // setup for the initial canvas size and never regenerated, so once the
        // window grows, draw() indexes the grid out of range and throws
        // "Cannot read properties of undefined" — which surfaces as a Next.js
        // dev error overlay. Detach Vanta's in-place handler and drive a full
        // re-init ourselves (debounced, below) so the grid is rebuilt at the
        // new size instead.
        if (instance.resize) {
          window.removeEventListener('resize', instance.resize as EventListener);
        }

        effectRef.current = instance;
        if (!cancelled) setReady(true);
      } catch (e) {
        // Silently degrade — don't let Vanta errors bubble to error overlay
        console.debug('[VantaBackground] init skipped:', e);
      } finally {
        // Restore original console.warn
        console.warn = originalWarn;
      }
    }

    // Debounce so a drag-resize triggers a single rebuild once it settles.
    function handleResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (cancelled) return;
        destroyEffect();
        void createEffect();
      }, 250);
    }

    // Respect reduced-motion: skip the WebGL/p5 background entirely.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Defer the heavy three.js / p5 dynamic import + WebGL init until the
    // browser is idle so this decorative work never competes with first paint,
    // hydration, or the route entrance animation. In dev this also pushes
    // Next's on-demand compile of three/p5 off the critical first-load path.
    let idleHandle: number | undefined;
    let usedIdleCallback = false;
    const scheduleInit = () => void createEffect();
    if (typeof window.requestIdleCallback === 'function') {
      usedIdleCallback = true;
      idleHandle = window.requestIdleCallback(scheduleInit, { timeout: 2000 });
    } else {
      idleHandle = window.setTimeout(scheduleInit, 200);
    }

    window.addEventListener('resize', handleResize);

    return () => {
      cancelled = true;
      if (idleHandle !== undefined) {
        if (usedIdleCallback) window.cancelIdleCallback(idleHandle);
        else clearTimeout(idleHandle);
      }
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
      destroyEffect();
      setReady(false);
    };
  }, [effect]);

  return (
    <div className={`relative ${className ?? ''}`}>
      <div
        ref={bgRef}
        className={`fixed inset-0 -z-10 transition-opacity duration-1000 ${ready ? (effect === 'topology' ? 'opacity-60' : 'opacity-30') : 'opacity-0'}`}
        style={{
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 30%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 30%)',
        }}
      />
      {children}
    </div>
  );
}
