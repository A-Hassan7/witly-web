/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Persistent "finish setup — connect a chat app" prompt shown at the top of the
 * room list until the user has connected at least one platform. This is the soft
 * onboarding nudge (see docs/witly plan): non-blocking, dismissible for the
 * session, and it disappears automatically once a bridge reports CONNECTED.
 *
 * Rendered from the (documented) `RoomListPanel` seam — see PATCHES.md #2.
 */

import React, { type JSX, useCallback, useEffect, useState } from "react";

import { witlyLog } from "../logger";
import { anyPlatformConnected } from "./connectController";
import { openConnectDialog, WITLY_CONNECT_CHANGED } from "../element/registerConnect";

/** Session-scoped dismissal so it doesn't nag after the user hides it once. */
const DISMISS_KEY = "witly.connect-cta.dismissed";

export function WitlyConnectCta(): JSX.Element | null {
    const [connected, setConnected] = useState<boolean | null>(null);
    const [dismissed, setDismissed] = useState<boolean>(
        () => sessionStorage.getItem(DISMISS_KEY) === "1",
    );

    const refresh = useCallback(() => {
        let alive = true;
        void anyPlatformConnected().then((isConnected) => {
            if (alive) setConnected(isConnected);
        });
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => refresh(), [refresh]);

    // Re-check whenever the connect dialog closes.
    useEffect(() => {
        const onChanged = (): void => void refresh();
        window.addEventListener(WITLY_CONNECT_CHANGED, onChanged);
        return () => window.removeEventListener(WITLY_CONNECT_CHANGED, onChanged);
    }, [refresh]);

    const onDismiss = useCallback(() => {
        sessionStorage.setItem(DISMISS_KEY, "1");
        setDismissed(true);
        witlyLog.info("connect CTA dismissed for session");
    }, []);

    // Hide while unknown, once connected, or if dismissed this session.
    if (connected !== false || dismissed) return null;

    return (
        <div className="witly_ConnectCta" role="region" aria-label="Connect a chat app">
            <button
                type="button"
                className="witly_ConnectCta_close"
                aria-label="Dismiss"
                onClick={onDismiss}
            >
                ×
            </button>
            <span className="witly_ConnectCta_glyph" aria-hidden="true">
                ✨
            </span>
            <div className="witly_ConnectCta_body">
                <span className="witly_ConnectCta_title">Finish setting up Witly</span>
                <span className="witly_ConnectCta_text">
                    Connect WhatsApp to bring your chats in.
                </span>
            </div>
            <button type="button" className="witly_ConnectCta_action" onClick={openConnectDialog}>
                Connect
            </button>
        </div>
    );
}
