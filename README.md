# PFx Responsive

A **local-first, live responsive website preview workspace**, driven by the independently developed [PFx Preview Core](https://github.com/pfxamd/PFx-Preview-Core). It is not a screenshot mockup or a remote screenshot API. The website is opened in Core's isolated Chromium browser; preview frames, mouse and keyboard input, viewport resizing and PNG captures are real Core operations.

**Release:** `0.2.0-alpha.1` — local interactive UI; **not approved for public Internet deployment**.

## Features

- Dark/light studio interface, responsive controls, and an intentional no-scroll desktop workspace.
- Up to four simultaneous mobile/tablet/desktop viewports; editable dimensions (240–3840 CSS pixels).
- Shared website address, independent viewport navigation and refresh, real live image streams, click/scroll/keyboard forwarding, and full-resolution PNG screenshots.
- Local gateway `src/local-server.js` serves the interface and forwards only documented API actions to Core. **No Core bearer credential enters browser JavaScript, HTML, storage, or public build assets.**
- Per-browser workspace ownership: a random in-memory key separates tabs. Sessions and streams are cleaned up on explicit close, pagehide and idle expiry.
- Clear **disconnected** state if Core is missing or authentication fails; never substitutes fake previews.
- No third-party dependencies for the application itself. The *Core* has its own runtime requirements.

## Local use

Prerequisites: **Node.js 22+** and PFx Preview Core running on Linux with its required Chromium and OS isolation features. Core currently **does not support native Windows browser isolation**. On Windows, use an appropriately secured Linux environment instead; do not expose Core over the public network.

In the Core repository, start the real engine with a strong secret:

```sh
PFX_PREVIEW_TOKEN='replace-with-a-long-private-secret' npm start
```

Then, in this application repository, configure the **same secret** only in the local server environment:

```sh
PFX_RESPONSIVE_CORE_TOKEN='replace-with-a-long-private-secret' npm start
```

Open <http://127.0.0.1:4188/> on the same machine. Enter a public HTTP(S) URL, select **Open previews**, then choose, resize, interact with or download any live viewport. Core's default loopback address is `http://127.0.0.1:4177`; the app's local web server is `http://127.0.0.1:4188`.

If the local Core cannot start because the host does not support its filesystem/PID/user/network namespace isolation, the interface stays disconnected. Do not disable the security checks to force it to work.

## Development and checks

```sh
npm run check
npm test
```

`src/preview-client.js` is an independent local copy of Core's v1 protocol adapter. `src/browser-client.js` is the same-origin client for the local gateway; `src/workspace.js` owns view/session lifecycles; `public/` holds the complete interface. No runtime files or fonts are fetched from the Core or branding repositories. The untouched `public/logo.svg` asset comes from `pfxamd/pfx-brand-assets` (`logos/logo.svg`).

GitHub Actions verifies source syntax and deterministic API, authorization, streaming, resource-cleanup and concurrency tests. The real-app integration matrix exercises the **UI** in Chromium, Firefox and Linux WebKit against an actual isolated Chromium Core, checking live frames, viewport resizing, PNG downloads and session cleanup. Linux WebKit is **not** a substitute for a Safari/macOS or iOS device test; the actual deployment environment must be validated separately before a general release.

## Security and limitations

- The service binds to IPv4 loopback only. A restricted Host check, custom same-origin request header, workspace key, Content Security Policy, no CORS, and disabled redirects protect the local gateway. These do **not** make it safe to open as a public website.
- The gateway holds the Core secret **only in process memory**. The browser stores only an ephemeral local tab key, not the Core token; no authentication secret is hardcoded or written to localStorage.
- Server-to-Core communication is loopback only. The client must not be published as a standalone static GitHub Pages site and misrepresented as a working cloud application.
- Up to 4 views share Core's overall session capacity. Cross-tab owner access is blocked at the gateway. Per-tenant kernel CPU/RAM/process isolation and independent security review for public multi-user hosting have **not** been completed.
- Website-specific security challenges, anti-bot controls, unsupported features, and JavaScript/network failures may prevent a correct preview. Core never bypasses website protections.
- For the detailed wire contract and remaining release blockers see [Core API contract](https://github.com/pfxamd/PFx-Preview-Core/blob/main/docs/API-CONTRACT-v1.md) and [Core security model](https://github.com/pfxamd/PFx-Preview-Core/blob/main/SECURITY.md).
