// Owns live-stream reconnection for each viewport. No external dependencies.
// A stream may end normally when the Core's finite output budget is exhausted.
// Keep the last rendered frame while reconnecting; never spin indefinitely.
export class StreamSupervisor {
  constructor({ workspace, schedule = setTimeout, unschedule = clearTimeout,
    minDelayMs = 750, maxDelayMs = 15_000, maxFailures = 6 } = {}) {
    if (!workspace || typeof workspace.startStream !== 'function' || typeof workspace.stopStream !== 'function') {
      throw new Error('Preview workspace is required');
    }
    if (!Number.isInteger(minDelayMs) || minDelayMs < 1 || !Number.isInteger(maxDelayMs) ||
      maxDelayMs < minDelayMs || !Number.isInteger(maxFailures) || maxFailures < 1) {
      throw new Error('Invalid stream recovery limits');
    }
    this.workspace = workspace;
    this.schedule = schedule;
    this.unschedule = unschedule;
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.maxFailures = maxFailures;
    this.watchers = new Map();
    this.disposed = false;
  }

  has(id) { return this.watchers.has(id); }

  watch(id, { onFrame, onState } = {}) {
    if (this.disposed) throw new Error('Stream supervisor is disposed');
    if (this.watchers.has(id)) throw new Error('Viewport stream is already watched');
    if (typeof onFrame !== 'function' || typeof onState !== 'function') throw new Error('Stream callbacks are required');
    const watcher = { id, onFrame, onState, closed: false, failures: 0, timer: null, runner: null };
    this.watchers.set(id, watcher);
    this.connect(watcher);
  }

  notify(watcher, state, message = null) {
    if (watcher.closed || this.watchers.get(watcher.id) !== watcher) return;
    try { watcher.onState(state, message); } catch { /* Presentation cannot break cleanup. */ }
  }

  connect(watcher) {
    if (watcher.closed || this.disposed || this.watchers.get(watcher.id) !== watcher) return;
    const current = this.workspace.views.find(v => v.id === watcher.id);
    if (!current || current.status !== 'ready') { void this.stop(watcher.id); return; }
    this.notify(watcher, 'connecting');
    let frames = 0;
    watcher.runner = (async () => {
      try {
        await this.workspace.startStream(watcher.id, frame => {
          if (watcher.closed || this.disposed) return;
          frames++;
          watcher.failures = 0;
          this.notify(watcher, 'live');
          watcher.onFrame(frame);
        });
      } catch (error) {
        this.notify(watcher, 'retrying', error instanceof Error ? error.message : 'Stream connection interrupted');
      }
      if (watcher.closed || this.disposed || this.watchers.get(watcher.id) !== watcher) return;
      const view = this.workspace.views.find(v => v.id === watcher.id);
      if (!view || view.status !== 'ready') { void this.stop(watcher.id); return; }
      if (!frames) watcher.failures++;
      if (watcher.failures >= this.maxFailures) {
        this.notify(watcher, 'paused', view.error || 'Live stream unavailable. Reopen this viewport to retry.');
        return;
      }
      this.notify(watcher, 'retrying', view.error);
      const delay = frames ? this.minDelayMs : Math.min(this.maxDelayMs,
        this.minDelayMs * 2 ** Math.min(watcher.failures - 1, 12));
      watcher.timer = this.schedule(() => {
        watcher.timer = null;
        this.connect(watcher);
      }, delay);
    })();
  }

  async stop(id) {
    const watcher = this.watchers.get(id);
    if (!watcher) return;
    watcher.closed = true;
    this.watchers.delete(id);
    if (watcher.timer !== null) this.unschedule(watcher.timer);
    // Abort the active SSE reader before waiting for its completion.
    await this.workspace.stopStream(id).catch(() => {});
    if (watcher.runner) await watcher.runner.catch(() => {});
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.allSettled([...this.watchers.keys()].map(id => this.stop(id)));
  }
}
