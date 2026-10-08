# PFx Responsive — architecture

## Independent layers

1. **Isolated browser engine** — PFx Preview Core, loopback Linux process, real Chromium, guarded external egress, stream and screenshot output quotas.
2. **Trusted local gateway** — `src/local-server.js`, Node HTTP bound only to 127.0.0.1:4188. Holds the Core bearer token exclusively in the Node process. Serves a closed, allowlisted static file map, provides short-lived workspace identities, checks host and request origin, proxies only v1 Core operations, aborts streaming on disconnect, and closes owned sessions on exit/expiry.
3. **Transport adapter** — `src/browser-client.js`, same-origin fetch and authenticated SSE transport to the trusted gateway. No actual Core bearer secret can be accessed by the browser.
4. **Workspace domain logic** — `src/workspace.js`, view creation/cancellation, per-view sequential operations, viewport state and event streams; independent from the DOM.
5. **Presentation** — `public/index.html`, `public/styles.css`, `public/app.js`, actual streamed JPEGs, real screenshot downloads and pointer-coordinate scaling to the underlying viewport.

## Rendering and interaction

- One session per active viewport; up to four at once. Each viewport shows **actual CDP frames** only, never fake screenshots.
- Device screen coordinates are transformed from the displayed CSS image bounds back into Core viewport pixel coordinates. Wheel and key events follow the same selected session.
- Changing viewport dimensions calls Core resize; captured PNGs are requested directly from Core and offered as local downloads.
- Closing a tab sends an explicit cleanup request; a 120-second inactive-workspace timeout is the fallback for abruptly terminated tabs. On local gateway shutdown all tracked sessions are closed.
- Core and gateway both enforce separate session limits; Core's own server performs browser isolation.

## Deployment boundary

The current build is **only a trusted local development experience**. There is no public server, Internet-hosted Core endpoint, or third-party screenshot service. A production deployment needs authenticated identity, a TLS intermediary, throttling, resource isolation and independent security review before deployment.

## UI testing

Local visual layout checks have been performed using headless Chromium with a controlled synthetic network fixture. These are **UI interaction tests**, not proof of actual Core rendering compatibility. The node tests prove gateway/workspace behavior under mocked Core responses. Real end-to-end integration requires the Linux Core sandbox and has not been asserted as proven by those tests.
