// A deterministic clock. Timer callbacks scheduled by callbacks also run on advance.
export function createFakeClock() {
  let time = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout(fn, ms) {
      const id = ++sequence;
      timers.set(id, { at: time + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    advance(ms) {
      if (ms < 0) throw new Error('Clock cannot travel backwards');
      const end = time + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next || next[1].at > end) break;
        time = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      time = end;
    },
    get pendingTimers() {
      return timers.size;
    },
  };
}
