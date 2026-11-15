// Returns a version of fn that runs at most once per `ms`. Calls that arrive too soon are
// collapsed: when the wait is over, fn runs once with the LAST arguments received, so the
// final state is never lost. Time and timers are injectable for testing.
export function throttle(
  fn,
  ms,
  { now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  let lastRun = -Infinity;
  let timer = null;
  let pendingArgs = null;

  function flush() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    if (!pendingArgs) return;
    const args = pendingArgs;
    pendingArgs = null;
    lastRun = now();
    fn(...args);
  }

  return (...args) => {
    pendingArgs = args;
    const wait = ms - (now() - lastRun);
    if (wait <= 0) flush();
    else if (!timer) timer = setTimer(flush, wait);
  };
}