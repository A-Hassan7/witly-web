# Witly fork — PATCHES

This is a **fork of [element-hq/element-web](https://github.com/element-hq/element-web)**. Witly is built as an
**additive, thin-seams layer** on top of Element (see `docs/witly/architecture.md` in the parent AGChat repo).

**The rule:** ~95% of Witly lives in **new files/modules**. Element's own source is touched **only** at the small,
documented set of seams listed below — each just enough to mount a Witly surface. This file is the single source of
truth for those seams, so they can be **re-applied after every upstream merge**.

## Branch model

| Branch | Role |
|---|---|
| `develop` | Clean mirror of `upstream/develop` (element-hq/element-web). **Never** commit Witly code here. |
| `witly` | Our working branch. All Witly code + the seams below live here. |

Remotes: `origin` → `A-Hassan7/witly-web` · `upstream` → `element-hq/element-web`.

## Upstream-merge workflow

```bash
# from client/witly-web
git fetch upstream
git checkout develop && git merge --ff-only upstream/develop   # keep mirror clean
git checkout witly && git merge develop                        # bring updates into Witly
# re-check each seam below still applies; run the app; update this file if line refs moved
```

## Seams (Element core files we modify)

> Keep this table exhaustive. Each row: the file, what we changed, and why. Prefer Element's module API /
> extension points over editing core; only add a row here when no additive seam exists.

| # | Element file | Change | Why | Status |
|---|---|---|---|---|
| 1 | `apps/web/src/vector/init.tsx` (`loadPlugins`) | Create the `ModuleLoader` unconditionally and `await moduleLoader.load(await import("../witly"))` before the config-driven module loop. | The new plugin loader only imports modules from runtime config URLs; our Witly plugin is compiled into the app, so it must be handed to the loader directly. Also removes the early `return` when no config modules exist. | active |
| 2 | `apps/web/src/components/views/rooms/RoomListPanel/RoomListPanel.tsx` | Render `<WitlyConnectCta/>` between `RoomListHeaderView` and `RoomListView`. | The persistent "finish setup — connect a chat app" prompt must sit at the top of the room list, which is reachable even with an empty inbox. Element's empty-state placeholder lives inside the shared `RoomListView` (`@element-hq/web-shared-components`) with no module-API slot, so this is the minimal host. Additive JSX only — the component self-hides once a platform is connected or the user dismisses it. | active |

<!--
Template for a new seam:
| 2 | src/components/views/rooms/MessageComposer.tsx | Mount <WitlyComposerBar/> above the composer input | No module-API slot reaches the composer footer | active |
-->

## New (additive) Witly modules

Additive code that does **not** count as a seam (no upstream conflict risk). Recorded for orientation.

| Area | Location (in fork) | Notes |
|---|---|---|
| Module entry | `apps/web/src/witly/index.ts` | Default-exported `Module`; loaded via seam #1. |
| Element API boundary | `apps/web/src/witly/element/moduleApi.ts` | Holds the `Api`; all `@alpha`-hook adapters funnel through here. |
| Brand tokens | `apps/web/src/witly/brand/witly-tokens.pcss` | `--witly-*` layer over Compound (light + dark). |
| Runtime config | `apps/web/src/witly/config.ts` | Reads `witly.*` from Element `config.json`. |
| Session | `apps/web/src/witly/services/session.ts` | Supabase token holder + refresh. |
| Supabase auth | `apps/web/src/witly/services/supabaseAuth.ts` | Google + magic link + phone OTP. |
| AGChat API client | `apps/web/src/witly/services/agchatApi.ts` | Ported from web-client; provisioning, bridges, AI, SSE. |
| Device-verify skip | `apps/web/src/witly/onboarding/skipDeviceVerification.ts` | Auto-skips Element's post-login `COMPLETE_SECURITY` prompt during onboarding via the **public** `SetupEncryptionStore` API (`.on("update")` + `.skip()`/`.skipConfirm()`). No core edit. Couples to the `Phase` enum + store API — if either moves upstream, fix this one file. Replace with a Witly-branded verification step later. |
| Login progress trace | `apps/web/src/witly/onboarding/loginProgress.ts` | Diagnostic: subscribes to Element's dispatcher (`OnLoggedIn`/`WillStartClient`/`ClientStarted`/`ClientNotViable`) + client `Sync` event to log each login milestone with `[Witly]` timestamps. The onboarding view stays on the provisioning screen until Element's first sync completes (`onLoggedIn()` only shows the splash from `LOADING`/`SOFT_LOGOUT`, not our custom `LOGIN` view), so this pinpoints a stalled client-start / crypto / first-sync. Read-only; no core edit. |
| Connect flow (P3) | `apps/web/src/witly/connect/*` | "Connect a chat app" wizard: `ConnectDialog` (state machine picker→preparing→phone→pairing→connected), `connectController.ts` (bridge deploy/ready polling + connected check), dependency-free `PhoneInput`, `WitlyConnectCta` (room-list prompt), `platforms.ts` (WhatsApp live + coming-soon cards), `connect.pcss`. Additive. |
| Connect launchers (P3) | `apps/web/src/witly/element/registerConnect.tsx` | Adapter for `extras.setSpacePanelItem` (@alpha) + `openDialog` (@public). Space-panel "Connect" button + `openConnectDialog()`. The ONLY place these two hooks are called for connect. |

## Module API dependency notes

Witly attaches primarily via `@element-hq/element-web-module-api` (the NEW, non-deprecated module system — the old
`build_config.yaml` + `@matrix-org/react-sdk-module-api` path is deprecated). Verified officially maintained
(Element `vector-im`, v1.14.0, signed, actively developed) and semver-governed (major = breaking).

**Stability discipline** — the API is self-described "early development"; several hooks are `@alpha`:
- Prefer `@public` hooks: `overwriteAccountAuth`, `client.accountData`, `i18n.register`, `dialog.openDialog`,
  `config`, `navigation`.
- `@alpha` hooks we use (`composer.insertPlaintextIntoComposer`, `customComponents.registerLoginComponent`,
  `extras.addRoomHeaderButtonCallback`, `extras.setSpacePanelItem`) MUST each be wrapped behind a thin internal
  adapter in `src/witly/element/` so an upstream signature change is a single-file fix. Note each such usage as a row
  in the seams table above if it ever requires a core edit (portals/DOM-mount fallbacks for the carousel +
  bottom-sheet may).
