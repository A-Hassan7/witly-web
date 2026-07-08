/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Adapters for the "connect a platform" launchers.
 *
 * This is the ONLY place we call the `@alpha` `extras.setSpacePanelItem` hook
 * and the stable `openDialog` API for the connect flow. If either signature
 * changes upstream, this single file is the fix (see PATCHES.md stability
 * notes). Two launchers share `openConnectDialog`:
 *   1. A persistent button in Element's space panel (always reachable).
 *   2. The empty-inbox call-to-action (see `WitlyConnectCta`).
 */

import React from "react";

import { witlyLog } from "../logger";
import { ConnectDialog, type ConnectResult } from "../connect/ConnectDialog";
import { getWitlyApi } from "./moduleApi";

/** Fired after the connect dialog closes so CTAs can refresh their state. */
export const WITLY_CONNECT_CHANGED = "witly:connect-changed";

/** Witly-tinted "@" glyph for the space-panel launcher. The accent tint on the
 * surrounding rounded tile is applied via the `witly_ConnectSpaceButton` class
 * (see connect.pcss) so it fills the whole icon square, not just an inner box. */
function ConnectIcon(): React.JSX.Element {
    return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <text
                x="12"
                y="13"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="18"
                fontWeight="700"
                fill="currentColor"
            >
                @
            </text>
        </svg>
    );
}

/** Open the guided connect wizard in an Element module dialog. */
export function openConnectDialog(): void {
    const api = getWitlyApi();
    const handle = api.openDialog<ConnectResult, object>(
        { title: "Connect a chat app" },
        ConnectDialog,
        {},
    );
    void handle.finished.then((res) => {
        witlyLog.info(`connect dialog closed: connected=${res.model?.connected ?? false}`);
        window.dispatchEvent(new CustomEvent(WITLY_CONNECT_CHANGED));
    });
}

/** Register the persistent space-panel launcher. Called once from `load()`. */
export function registerWitlyConnect(): void {
    const api = getWitlyApi();
    api.extras.setSpacePanelItem("witly-connect", {
        className: "witly_ConnectSpaceButton",
        icon: <ConnectIcon />,
        label: "Connect",
        tooltip: "Connect a chat app",
        onSelected: openConnectDialog,
    });
    witlyLog.info("connect space-panel launcher registered");
}
