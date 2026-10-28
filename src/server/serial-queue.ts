/**
 * Runs queued async operations one at a time, in call order, even when
 * callers don't await one another. A rejected operation does not break the
 * chain — `.then(op, op)` reruns `op` as the rejection handler too, so the
 * next call still lands after this one settles.
 */
export function createSerialQueue() {
  let tail: Promise<void> = Promise.resolve();
  return function run<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

/**
 * Same serialization as {@link createSerialQueue}, but keyed: each key gets
 * its own independent chain. A key's entry is dropped once its chain goes
 * idle, so this doesn't leak memory across a growing set of keys.
 */
export function createKeyedSerialQueue() {
  const tails = new Map<string, Promise<void>>();
  return function run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    tails.set(key, tail);
    return result.finally(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
  };
}
