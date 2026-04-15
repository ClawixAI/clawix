import anime from 'animejs';
import type { AnimeParams } from 'animejs';
import { EASING, DURATION, STAGGER } from './config';

/** AnimeParams with targets guaranteed to be a string (CSS selector) */
export type AnimePreset = AnimeParams & { targets: string };

export function fadeUp(
  selector: string,
  options?: { distance?: number; duration?: number; delay?: number },
): AnimePreset {
  return {
    targets: selector,
    opacity: [0, 1],
    translateY: [options?.distance ?? 12, 0],
    duration: options?.duration ?? DURATION.normal,
    easing: EASING,
    delay: options?.delay ?? 0,
  };
}

export function staggerFadeUp(
  selector: string,
  options?: { stagger?: number; distance?: number; duration?: number },
): AnimePreset {
  return {
    targets: selector,
    opacity: [0, 1],
    translateY: [options?.distance ?? 10, 0],
    duration: options?.duration ?? DURATION.normal,
    delay: anime.stagger(options?.stagger ?? STAGGER.normal),
    easing: EASING,
  };
}

export function drawPath(
  selector: string,
  options?: { duration?: number; delay?: number },
): AnimePreset {
  return {
    targets: selector,
    strokeDashoffset: [anime.setDashoffset, 0],
    duration: options?.duration ?? DURATION.chart,
    easing: EASING,
    delay: options?.delay ?? 0,
  };
}

export function fillWidth(
  selector: string,
  to: string,
  options?: { duration?: number },
): AnimePreset {
  return {
    targets: selector,
    width: ['0%', to],
    duration: options?.duration ?? DURATION.medium,
    easing: EASING,
  };
}

export function scalePress(
  selector: string,
  options?: { scale?: number; duration?: number },
): AnimePreset {
  return {
    targets: selector,
    scale: options?.scale ?? 0.98,
    duration: options?.duration ?? DURATION.fast,
    easing: EASING,
  };
}

export function scalePop(
  selector: string,
  options?: { scale?: number; duration?: number },
): AnimePreset {
  return {
    targets: selector,
    scale: [1, options?.scale ?? 1.15, 1],
    duration: options?.duration ?? 300,
    easing: EASING,
  };
}

export function slideOut(
  selector: string,
  options?: { direction?: 'left' | 'right'; duration?: number },
): AnimePreset {
  const x = options?.direction === 'left' ? -100 : 100;
  return {
    targets: selector,
    translateX: [0, x],
    opacity: [1, 0],
    duration: options?.duration ?? 300,
    easing: EASING,
  };
}
