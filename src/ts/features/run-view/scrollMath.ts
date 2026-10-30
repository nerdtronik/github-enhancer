/**
 * Largest scrollLeft worth offering. The end of scrolling is the last visible stage's right edge
 * plus its trailing padding (`contentRight`), capped by the browser's real limit so we never
 * promise more than the canvas can scroll. `null` means no visible stage (0); `Infinity` means the
 * stage is not laid out yet, so only the browser limit applies.
 */
export function computeMax(input: {
  scrollWidth: number;
  clientWidth: number;
  contentRight: number | null;
}): number {
  const { scrollWidth, clientWidth, contentRight } = input;
  if (contentRight === null) return 0;
  const limit = Math.max(0, scrollWidth - clientWidth);
  return Math.min(limit, Math.max(0, contentRight - clientWidth));
}

/**
 * Scrollbar thumb width in px. The divisor `clientWidth + max * 1.5` exaggerates the scrollable
 * distance so the thumb is shorter than the exact viewport ratio; never below 64px and never
 * wider than the track.
 */
export function thumbWidth(input: {
  trackWidth: number;
  clientWidth: number;
  max: number;
}): number {
  const { trackWidth, clientWidth, max } = input;
  return Math.min(
    trackWidth,
    Math.max(
      64,
      Math.round((trackWidth * clientWidth) / (clientWidth + max * 1.5)),
    ),
  );
}

/**
 * Scroll position for an arrow click: the nearest stage start in `direction` past `current`, else
 * that end (`max` or 0).
 */
export function nextArrowTarget(input: {
  direction: -1 | 1;
  current: number;
  max: number;
  positions: number[];
}): number {
  const { direction, current, max, positions } = input;
  let target = direction > 0 ? max : 0;
  for (const position of positions) {
    if (direction > 0 && position > current + 1) {
      target = position;
      break;
    }
    if (direction < 0 && position < current - 1) target = position;
  }
  return Math.min(max, target);
}

/** Maps thumb movement (`deltaX` over `travel` px of track) to a scrollLeft in [0, max]. */
export function dragScroll(input: {
  startScroll: number;
  deltaX: number;
  travel: number;
  max: number;
}): number {
  const { startScroll, deltaX, travel, max } = input;
  return Math.round(
    Math.max(0, Math.min(max, startScroll + (deltaX * max) / travel)),
  );
}

/** Scroll position for a canvas drag: content follows the pointer, so scroll moves opposite. */
export function panTarget(input: {
  start: number;
  pointerStart: number;
  pointer: number;
  max: number;
}): number {
  const { start, pointerStart, pointer, max } = input;
  return Math.max(0, Math.min(max, start - (pointer - pointerStart)));
}

/** Pointer speed in px/ms over the last `windowMs`; 0 when fewer than two recent samples. */
export function releaseVelocity(
  samples: { t: number; x: number }[],
  now: number,
  windowMs = 100,
): number {
  const recent = samples.filter((sample) => now - sample.t <= windowMs);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const span = last.t - first.t;
  return span > 0 ? (last.x - first.x) / span : 0;
}

// Below this speed (px/ms) the glide is imperceptible, so it ends.
const INERTIA_STOP_SPEED = 0.02;

/**
 * One frame of exponential-decay glide (time constant `tau` ms). The position is the exact
 * integral of the decaying velocity over `dt`, so results do not depend on frame rate. Hitting an
 * edge ends the glide.
 */
export function inertiaStep(input: {
  position: number;
  velocity: number;
  dt: number;
  max: number;
  tau: number;
}): { position: number; velocity: number; done: boolean } {
  const { position, velocity, dt, max, tau } = input;
  const decay = Math.exp(-dt / tau);
  const next = position + velocity * tau * (1 - decay);
  if (next <= 0 || next >= max)
    return { position: Math.max(0, Math.min(max, next)), velocity: 0, done: true };
  const slowed = velocity * decay;
  return { position: next, velocity: slowed, done: Math.abs(slowed) < INERTIA_STOP_SPEED };
}
