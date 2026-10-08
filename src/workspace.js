// PFx Responsive — headless session coordinator for the local Preview Core.
// The UI owns presentation; this module owns session lifetimes and cleanup.
function dimensions(value) {
  if (!value || typeof value !== 'object' || !Number.isInteger(value.width) || !Number.isInteger(value.height)) {
    throw new Error('Viewport dimensions must be integers');
  }
  if (value.width < 240 || value.width > 3840 || value.height < 240 || value.height > 3840) {
    throw new Error('Viewport dimensions out of range');
  }
  return { width: value.width, height: value.height };
}

export class PreviewWorkspace {
  constructor({ client, maxViews = 4 } = {}) {
    if (!client || !['create', 'resize', 'navigate', 'input', 'screenshot', 'stream', 'close'].every(n => typeof client[n] === 'function')) {
      throw new Error('Preview Core client is required');
    }
    if (!Number.isInteger(maxViews) || maxViews < 1 || maxViews > 16) throw new Error('Invalid view capacity');
    this.client = client;
    this.maxViews = maxViews;
    this.entries = new Map();
    this.subscribers = new Set();
    this.sequence = 0;
    this.disposed = false;
  }

  get views() { return Array.from(this.entries.values(), entry => this.publicView(entry)); }

  publicView(e) {
    return Object.freeze({ id: e.id, sessionId: e.sessionId, status: e.status,
      url: e.url, viewport: { ...e.viewport }, error: e.error, streaming: !!e.streamPromise });
  }

  subscribe(fn) {
    if (this.disposed) throw new Error('Workspace disposed');
    if (typeof fn !== 'function') throw new Error('Subscriber must be a function');
    this.subscribers.add(fn);
    fn(this.views);
    return () => this.subscribers.delete(fn);
  }

  notify() {
    const snapshot = this.views;
    for (const fn of this.subscribers) { try { fn(snapshot); } catch { /* consumer errors cannot break cleanup */ } }
  }

  lookup(id) {
    const entry = this.entries.get(id);
    if (!entry || entry.status === 'closed') throw new Error('View not found');
    return entry;
  }

  ready(id) {
    const entry = this.lookup(id);
    if (entry.status !== 'ready') throw new Error('View is not ready');
    return entry;
  }

  add({ url, width = 390, height = 844, deviceScaleFactor = 1 } = {}) {
    if (this.disposed) throw new Error('Workspace disposed');
    if (this.entries.size >= this.maxViews) throw new Error('Workspace capacity reached');
    dimensions({ width, height });
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('HTTP(S) URL required');
    const entry = { id: `view-${++this.sequence}`, sessionId: null, status: 'creating',
      url, viewport: { width, height }, error: null, queue: Promise.resolve(), createPromise: null,
      closePromise: null, streamPromise: null, streamController: null };
    this.entries.set(entry.id, entry);
    this.notify();
    entry.createPromise = (async () => {
      try {
        const created = await this.client.create({ url, width, height, deviceScaleFactor });
        if (!created || typeof created.id !== 'string') throw new Error('Core returned no session ID');
        entry.sessionId = created.id;
        if (entry.status === 'closing' || this.disposed) return;
        entry.status = 'ready';
        entry.url = created.url ?? url;
        entry.viewport = created.viewport ?? { width, height };
        this.notify();
      } catch (error) {
        if (entry.status !== 'closing') {
          entry.status = 'error';
          entry.error = error instanceof Error ? error.message : 'Creation failed';
          this.notify();
        }
      }
    })();
    return entry.id;
  }

  queue(id, fn) {
    const entry = this.ready(id);
    const run = entry.queue.catch(() => {}).then(async () => {
      if (entry.status !== 'ready') throw new Error('View is closing');
      const result = await fn(entry);
      if (entry.status !== 'ready') throw new Error('View is closing');
      return result;
    });
    entry.queue = run;
    return run;
  }

  resize(id, viewport) {
    const valid = dimensions(viewport);
    return this.queue(id, async entry => {
      const result = await this.client.resize(entry.sessionId, valid);
      if (entry.status === 'ready') { entry.viewport = result.viewport ?? valid; this.notify(); }
      return result;
    });
  }

  navigate(id, url) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return Promise.reject(new Error('HTTP(S) URL required'));
    return this.queue(id, async entry => {
      const result = await this.client.navigate(entry.sessionId, url);
      if (entry.status === 'ready') { entry.url = result.url ?? url; this.notify(); }
      return result;
    });
  }

  input(id, event) { return this.queue(id, entry => this.client.input(entry.sessionId, event)); }
  screenshot(id) { return this.queue(id, entry => this.client.screenshot(entry.sessionId)); }

  startStream(id, onFrame) {
    const entry = this.ready(id);
    if (typeof onFrame !== 'function') throw new Error('Frame callback required');
    if (entry.streamPromise) throw new Error('View stream already active');
    const controller = new AbortController();
    entry.streamController = controller;
    // Assign before yielding so a second startStream cannot race this start.
    const streaming = (async () => {
      try {
        for await (const frame of this.client.stream(entry.sessionId, { signal: controller.signal })) {
          if (controller.signal.aborted || entry.status !== 'ready') break;
          if (entry.error !== null) { entry.error = null; this.notify(); }
          onFrame(frame);
        }
      } catch (error) {
        if (!controller.signal.aborted && entry.status === 'ready') {
          entry.error = error instanceof Error ? error.message : 'Stream failed';
        }
      } finally {
        if (entry.streamPromise === streaming) {
          entry.streamController = null;
          entry.streamPromise = null;
          this.notify();
        }
      }
    })();
    entry.streamPromise = streaming;
    this.notify();
    return streaming;
  }

  async stopStream(id) {
    const entry = this.lookup(id);
    entry.streamController?.abort();
    if (entry.streamPromise) await entry.streamPromise;
  }

  close(id) {
    const entry = this.lookup(id);
    if (entry.closePromise) return entry.closePromise;
    entry.status = 'closing';
    entry.streamController?.abort();
    this.notify();
    const operation = (async () => {
      try {
        await entry.createPromise;
        await entry.queue.catch(() => {});
        if (entry.streamPromise) await entry.streamPromise.catch(() => {});
        if (entry.sessionId) await this.client.close(entry.sessionId);
      } finally {
        entry.status = 'closed';
        this.entries.delete(id);
        this.notify();
      }
    })();
    entry.closePromise = operation;
    return operation;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.allSettled([...this.entries.keys()].map(id => this.close(id)));
    this.subscribers.clear();
  }
}
