export function createRefreshCoordinator() {
  let revision = 0;
  let inFlight = null;

  function start(load, apply) {
    const startedRevision = revision;
    let loaded;
    try {
      loaded = load();
    } catch (error) {
      loaded = Promise.reject(error);
    }
    let request;
    request = Promise.resolve(loaded)
      .then((value) => {
        if (startedRevision === revision) apply(value);
        return value;
      })
      .finally(() => {
        if (inFlight === request) inFlight = null;
      });
    inFlight = request;
    return request;
  }

  async function refresh(load, apply, options = {}) {
    if (inFlight) {
      if (options.fresh !== true) return inFlight;
      try {
        await inFlight;
      } catch {
        // A fresh request still needs to run after an older request fails.
      }
    }
    return start(load, apply);
  }

  function invalidate() {
    revision += 1;
  }

  return { invalidate, refresh };
}
