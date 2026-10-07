import { MainLoopWatchdog } from '../api/main-loop-watchdog';

function watchdog(clock: { now: number }) {
  const stalls: number[] = [];
  const exits: number[] = [];
  const subject = new MainLoopWatchdog({
    stallAfterMs: 1000,
    exitAfterMs: 3000,
    now: () => clock.now,
    onStall: (elapsed) => stalls.push(elapsed),
    onExit: (elapsed) => exits.push(elapsed),
  });
  return { subject, stalls, exits };
}

describe('main loop watchdog', () => {
  it('is idle between runs and running inside one', () => {
    const clock = { now: 0 };
    const { subject, stalls, exits } = watchdog(clock);
    expect(subject.check()).toBe('idle');
    subject.begin();
    clock.now = 500;
    expect(subject.check()).toBe('running');
    subject.end();
    clock.now = 10_000;
    expect(subject.check()).toBe('idle');
    expect(stalls).toEqual([]);
    expect(exits).toEqual([]);
  });

  it('reports a stuck run once, then asks for an exit past the longer limit', () => {
    const clock = { now: 0 };
    const { subject, stalls, exits } = watchdog(clock);
    subject.begin();
    clock.now = 1000;
    expect(subject.check()).toBe('stalled');
    clock.now = 2000;
    expect(subject.check()).toBe('stalled');
    expect(stalls).toEqual([1000]);
    clock.now = 3000;
    expect(subject.check()).toBe('exit');
    clock.now = 4000;
    expect(subject.check()).toBe('exit');
    expect(exits).toEqual([3000]);
  });

  it('starts every run with a clean stall record', () => {
    const clock = { now: 0 };
    const { subject, stalls } = watchdog(clock);
    subject.begin();
    clock.now = 1500;
    expect(subject.check()).toBe('stalled');
    subject.end();
    clock.now = 1600;
    subject.begin();
    clock.now = 1700;
    expect(subject.check()).toBe('running');
    clock.now = 2700;
    expect(subject.check()).toBe('stalled');
    expect(stalls).toEqual([1500, 1100]);
  });

  it('never kills a run that keeps making progress', () => {
    const clock = { now: 0 };
    const { subject, stalls, exits } = watchdog(clock);
    subject.begin();
    for (let t = 900; t <= 9000; t += 900) {
      clock.now = t;
      subject.progress();
      expect(subject.check()).toBe('running');
    }
    expect(stalls).toEqual([]);
    expect(exits).toEqual([]);
  });

  it('measures stall and exit from the last progress, then clears the stall record', () => {
    const clock = { now: 0 };
    const { subject, stalls, exits } = watchdog(clock);
    subject.begin();
    clock.now = 1200;
    expect(subject.check()).toBe('stalled');
    subject.progress();
    clock.now = 2000;
    expect(subject.check()).toBe('running');
    clock.now = 2200;
    expect(subject.check()).toBe('stalled');
    clock.now = 4200;
    expect(subject.check()).toBe('exit');
    expect(stalls).toEqual([1200, 1000]);
    expect(exits).toEqual([3000]);
  });

  it('ignores progress outside a run', () => {
    const clock = { now: 0 };
    const { subject } = watchdog(clock);
    subject.progress();
    expect(subject.check()).toBe('idle');
  });

  it('refuses limits that could never report anything', () => {
    expect(() => new MainLoopWatchdog({
      stallAfterMs: 0, exitAfterMs: 10, onStall: () => undefined, onExit: () => undefined,
    })).toThrow();
    expect(() => new MainLoopWatchdog({
      stallAfterMs: 10, exitAfterMs: 10, onStall: () => undefined, onExit: () => undefined,
    })).toThrow();
  });
});
