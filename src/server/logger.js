const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// write and now can be replaced in tests.
export function createLogger({
  level = 'info',
  write = (line) => console.log(line),
  now = () => new Date(),
} = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info; // unknown level -> info

  function log(name, message) {
    if (LEVELS[name] < threshold) return;
    const time = now().toLocaleTimeString('en-GB'); // e.g. 14:05:09
    write(`${time} ${name.toUpperCase().padEnd(5)} ${message}`);
  }

  return {
    debug: (message) => log('debug', message),
    info: (message) => log('info', message),
    warn: (message) => log('warn', message),
    error: (message) => log('error', message),
  };
}

// Does nothing. Used by default so tests stay quiet.
export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};