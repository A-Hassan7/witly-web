/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { ClientEvent, SyncState } from "matrix-js-sdk/src/matrix";

import defaultDispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { MatrixClientPeg } from "../../MatrixClientPeg";
import { witlyLog } from "../logger";

// The trace must outlive our onboarding component: the interesting milestones
// (first sync, view leaving LOGIN) happen AFTER that component unmounts, so the
// trace self-cleans on the first Prepared/Error sync state (or after a cap)
// rather than relying on a caller to disarm it.
const TRACE_MAX_MS = 120_000;

/**
 * Diagnostics for the post-provisioning login handoff.
 *
 * After we hand Matrix credentials to Element, the onboarding view stays on our
 * provisioning screen until Element's `postLoginSetup` finishes awaiting the
 * FIRST SYNC — only then does the view leave `LOGIN`. If client-start, crypto
 * init, or the first sync stalls, the user is left on the provisioning screen
 * with no feedback. This traces each Element login milestone with `[Witly]`
 * timestamps so a stall is immediately visible in the console.
 *
 * Read-only: subscribes to Element's dispatcher + the Matrix client sync event.
 * No core files are modified. See client/witly-web/PATCHES.md.
 *
 * @returns a cleanup function to detach all listeners.
 */
export function traceLoginProgress(): () => void {
    const t0 = performance.now();
    const since = (): string => `+${Math.round(performance.now() - t0)}ms`;

    const dispatcherRef = defaultDispatcher.register((payload: { action: string }) => {
        switch (payload.action) {
            case Action.OnLoggedIn:
                witlyLog.info(`login step ${since()}: OnLoggedIn (credentials stored)`);
                break;
            case Action.WillStartClient:
                witlyLog.info(`login step ${since()}: WillStartClient (starting Matrix client + crypto)`);
                break;
            case Action.ClientStarted:
                witlyLog.info(`login step ${since()}: ClientStarted (client running; awaiting first sync)`);
                break;
            case Action.ClientNotViable:
                witlyLog.warn(`login step ${since()}: ClientNotViable (soft logout — token likely invalid)`);
                break;
            case Action.OnLoggedOut:
                witlyLog.warn(`login step ${since()}: OnLoggedOut`);
                break;
        }
    });

    // Attach a sync listener as soon as the client exists. It may not exist at
    // arm time (created during setLoggedIn), so poll briefly until it does.
    let syncListenerAttached = false;
    let syncHandler: ((state: SyncState, prev: SyncState | null) => void) | undefined;
    let cleanedUp = false;
    let maxTimer = 0;

    const cleanup = (): void => {
        if (cleanedUp) return;
        cleanedUp = true;
        window.clearInterval(pollForClient);
        window.clearTimeout(maxTimer);
        defaultDispatcher.unregister(dispatcherRef);
        if (syncListenerAttached && syncHandler) {
            MatrixClientPeg.get()?.off(ClientEvent.Sync, syncHandler);
        }
    };

    const attachSyncListener = (): boolean => {
        const client = MatrixClientPeg.get();
        if (!client) return false;
        syncHandler = (state: SyncState, prev: SyncState | null): void => {
            witlyLog.info(`login step ${since()}: sync ${prev ?? "null"} → ${state}`);
            // Prepared = first sync landed (the view can now leave LOGIN); Error =
            // fatal. Either way the interesting part is over, so self-clean.
            if (state === SyncState.Prepared || state === SyncState.Error) {
                cleanup();
            }
        };
        client.on(ClientEvent.Sync, syncHandler);
        syncListenerAttached = true;
        return true;
    };

    let pollCount = 0;
    const pollForClient = window.setInterval(() => {
        pollCount += 1;
        if (attachSyncListener() || pollCount > 100) {
            window.clearInterval(pollForClient);
        }
    }, 100);

    // Hard cap so the trace can never leak if the client/sync never arrives.
    maxTimer = window.setTimeout(cleanup, TRACE_MAX_MS);

    return cleanup;
}
