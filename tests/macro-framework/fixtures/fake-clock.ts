// Fake clock — deterministic clock for timeout / duration assertions.
//
// Justification (INV-MTF-06 (b) non-determinism): wall-clock time isn't
// reproducible across runs; timeout tests need controlled progression.
//
// Surface mirrors the minimal slice the macro engine cares about: a `now()`
// reader returning a monotonic millisecond count, plus `advance(ms)` and
// `set(ms)` for test control. The production engine reads time via an
// injected clock interface; tests substitute this fake at the seam.

export interface Clock {
  now(): number;
}

export class FakeClock implements Clock {
  private millis: number;

  constructor(startMs: number = 0) {
    this.millis = startMs;
  }

  now(): number {
    return this.millis;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new Error('FakeClock.advance: ms must be >= 0');
    }
    this.millis += ms;
  }

  set(ms: number): void {
    this.millis = ms;
  }
}
