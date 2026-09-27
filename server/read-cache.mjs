/** Coalesce concurrent reads per key; failed reads are never cached. */
export function createReadCache(ttl, now = Date.now) {
  const entries = new Map();
  return async (key, read) => {
    const previous = entries.get(key);
    if (previous && (previous.pending || previous.expires > now()))
      return previous.promise;
    const entry = { pending: true, expires: 0, promise: null };
    entry.promise = Promise.resolve()
      .then(read)
      .then(
        (value) => {
          entry.pending = false;
          entry.expires = now() + ttl;
          return value;
        },
        (error) => {
          if (entries.get(key) === entry) entries.delete(key);
          throw error;
        },
      );
    entries.set(key, entry);
    return entry.promise;
  };
}
