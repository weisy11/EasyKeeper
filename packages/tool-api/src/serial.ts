const queues = new Map<string, Promise<unknown>>();

/**
 * Run `work` after every earlier `serial` call with the same key has settled. Host IPC commands
 * finish on a thread pool, so two unawaited writes to one file or database could otherwise land
 * in either order; keying by path keeps them in program order without blocking other keys.
 * The returned promise settles exactly like `work()` would have.
 */
export function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return run;
}
