# PFx Responsive — application/engine boundary

- **Core repository:** isolated browser sessions, network security, screenshots and CDP streams.
- **Application repository:** local user workspace, viewport presets, controls, session lifecycle and visual rendering.
- **Transport:** Core's versioned v1 JSON/PNG/SSE contract via `src/preview-client.js`, copied into this project with no runtime repository fetch or dependency.
- **Workspace model:** `PreviewWorkspace` owns session IDs, capacity, per-viewport operation ordering and close/dispose cleanup. View layout and state management subscribe to immutable snapshots; no DOM or styling dependencies in the coordinator.
- **Disconnection:** real errors propagate to the UI. Never substitute a static image or fabricated browser rendering.
- **Security:** a trusted local service/gateway must protect tokens. No public direct access to Core while the Core is restricted to Linux loopback.

## UI phase acceptance requirements (not implemented yet)

- Valid URL input, progress and understandable failure states.
- One to four independently resizable live viewports, including phone/tablet/desktop presets.
- Live input forwarding and real screenshot capture via Core; frames are streamed, not reconstructed.
- Cleanup on close, navigate, disconnect and tab teardown; no residual sessions.
- Keyboard accessibility, meaningful focus behavior, compact readable controls, no obligatory scroll for desktop workspace.
- Intentional visual art direction; do not inflate UI elements to fill empty space.
- Direct Firefox desktop checks before release, then additional WebKit/Safari compatibility where available.
