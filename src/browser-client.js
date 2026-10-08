// Same-origin local gateway client. The Core bearer token never enters the DOM
// or browser JavaScript. The workspace key lives in memory for this tab only.
export class LocalGatewayClient {
  constructor({ fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
    this.fetchImpl = fetchImpl;
    this.key = null;
  }
  async request(path, { method = 'GET', json, signal } = {}) {
    const response = await this.fetchImpl(`/api${path}`, {
      method, mode: 'same-origin', cache: 'no-store', redirect: 'error', signal,
      headers: { 'x-pfx-app': '1', ...(this.key ? { 'x-pfx-workspace': this.key } : {}),
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {})
    });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try { message = (await response.json()).error || message; } catch {}
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return response;
  }
  async bootstrap() {
    const data = await (await this.request('/bootstrap')).json();
    this.key = data.workspaceKey;
    return data;
  }
  async status() { return (await this.request('/status')).json(); }
  async create(payload) { return (await this.request('/sessions', { method: 'POST', json: payload })).json(); }
  async resize(id, payload) { return (await this.request(`/sessions/${id}/resize`, { method: 'POST', json: payload })).json(); }
  async navigate(id, url) { return (await this.request(`/sessions/${id}/navigate`, { method: 'POST', json: { url } })).json(); }
  async input(id, event) { return (await this.request(`/sessions/${id}/input`, { method: 'POST', json: event })).json(); }
  async screenshot(id) { return new Uint8Array(await (await this.request(`/sessions/${id}/screenshot`)).arrayBuffer()); }
  async close(id) { return (await this.request(`/sessions/${id}`, { method: 'DELETE' })).json(); }
  async end() { if (!this.key) return; await this.request('/workspace/close', { method: 'POST', json: {} }); this.key = null; }
  async *stream(id, { signal } = {}) {
    const response = await this.request(`/sessions/${id}/stream`, { signal });
    if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('Invalid stream response');
    const reader = response.body.getReader();
    const decode = new TextDecoder();
    let buffer = '';
    let type = '';
    let data = [];
    const LIMIT = 16 * 1024 * 1024;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decode.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf('\n')) !== -1) {
          if (i > LIMIT) throw new Error('Stream data too large');
          const line = buffer.slice(0, i).replace(/\r$/, '');
          buffer = buffer.slice(i + 1);
          if (!line) {
            if (type === 'error') { let message='Stream disconnected'; try { message=JSON.parse(data.join('\n')).error || message; } catch {} throw new Error(message); }
            if (type === 'frame' && data.length) {
              let frame; try { frame = JSON.parse(data.join('\n')); } catch { throw new Error('Invalid stream JSON'); }
              if (frame?.mime !== 'image/jpeg' || typeof frame.data !== 'string' || frame.data.length > LIMIT) throw new Error('Invalid stream frame');
              yield frame;
            }
            type = ''; data = [];
          } else if (line.startsWith('event:')) type = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
          if (data.reduce((n, x) => n + x.length, 0) > LIMIT) throw new Error('Stream event too large');
        }
        if (buffer.length > LIMIT) throw new Error('Stream line too large');
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
