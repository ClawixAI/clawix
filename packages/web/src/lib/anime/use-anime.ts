'use client';

import { useCallback, useEffect, useRef } from 'react';
import anime from 'animejs';
import type { AnimeParams } from 'animejs';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useAnimeOnMount(
  params: AnimeParams & { targets: string | HTMLElement | HTMLElement[] | null },
) {
  const instanceRef = useRef<anime.AnimeInstance | null>(null);

  useEffect(() => {
    if (!params.targets) return;

    if (prefersReducedMotion()) {
      const targets = params.targets;
      if (typeof targets === 'string') {
        document.querySelectorAll(targets).forEach((el) => {
          (el as HTMLElement).style.opacity = '1';
          (el as HTMLElement).style.transform = 'none';
        });
      }
      return;
    }

    instanceRef.current = anime({
      ...params,
      autoplay: true,
    });

    return () => {
      instanceRef.current?.pause();
    };
  }, []);
}

export function useAnimate() {
  const instanceRef = useRef<anime.AnimeInstance | null>(null);

  const animate = useCallback((params: AnimeParams) => {
    instanceRef.current?.pause();
    if (prefersReducedMotion()) return;
    instanceRef.current = anime(params);
    return instanceRef.current;
  }, []);

  useEffect(() => {
    return () => {
      instanceRef.current?.pause();
    };
  }, []);

  return animate;
}

export function useCountUp(
  target: number,
  duration: number,
  onUpdate: (value: number) => void,
  deps: unknown[] = [],
) {
  useEffect(() => {
    if (prefersReducedMotion()) {
      onUpdate(target);
      return;
    }

    const obj = { val: 0 };
    const instance = anime({
      targets: obj,
      val: target,
      duration,
      easing: 'cubicBezier(0.4, 0, 0.2, 1)',
      round: 1,
      update: () => {
        onUpdate(Math.round(obj.val));
      },
    });

    return () => {
      instance.pause();
    };
  }, deps);
}
