# PFx Responsive

**Foundation only; the UI has not been designed or deployed.**

This repository is the independent application project for live responsive website previews. Its browser engine is **PFx Preview Core** (developed in a separate repository). App and engine have separate responsibilities; no runtime files are fetched from the Core repository.

## Current foundation

- `src/preview-client.js`: a **local copy** of the v1 Core HTTP/PNG/SSE client. No package link or runtime dependency on the Core source repository.
- `src/workspace.js`: headless multi-viewport session lifecycle, event subscriptions, sequential per-view operations, frame streaming, cleanup and disposal.
- `tests/`: deterministic lifecycle, network-contract and concurrency tests.
- `.github/workflows/ci.yml`: syntax and behavior tests in Node 22.

## Security boundary

PFx Preview Core currently operates **on Linux loopback only** and is **not** approved for public deployment. The eventual UI must not bake a Core bearer token into publicly accessible JavaScript or expose the Core on the Internet. For local testing, a trusted local process or secure proxy must own credentials. The Core still requires an independently reviewed production-host sandbox, kernel-enforced resource isolation per tenant and an authenticated TLS gateway before public multi-user use.

The app repository must never silently fall back to fake screenshots or an unrelated screenshot service when the Core is unavailable. It should present a disconnected/error state instead.

## Development

Requirements: Node.js 22 or later. No third-party dependencies are needed for the current foundation.

```sh
npm run check
npm test
```

The user interface, styles and public deployment are **intentionally deferred** until the Core release gate is confirmed and the local integration mode is approved. Documentation of the Core v1 contract: [`PFx-Preview-Core/docs/API-CONTRACT-v1.md`](https://github.com/pfxamd/PFx-Preview-Core/blob/main/docs/API-CONTRACT-v1.md).
