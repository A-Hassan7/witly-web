/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Adapter for the Wit Library launcher.
 *
 * Like `registerConnect`, this is the single place the `@alpha`
 * `extras.setSpacePanelItem` hook and the stable `openDialog` API are called
 * for the Wit Library. If either signature changes upstream, this one file is
 * the fix (see PATCHES.md stability notes).
 */

import React from "react";

import { witlyLog } from "../logger";
import { WitLibraryDialog } from "../wits/WitLibraryDialog";
import { witStore } from "../wits/witStore";
import { getWitlyApi } from "./moduleApi";

/** Simple sparkle glyph for the space-panel launcher tile. */
function WitsIcon(): React.JSX.Element {
    return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <text
                x="12"
                y="13"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="15"
                fontWeight="700"
                fill="currentColor"
            >
                W
            </text>
        </svg>
    );
}

/** Open the Wit Library in an Element module dialog. */
export function openWitLibraryDialog(): void {
    const api = getWitlyApi();
    const handle = api.openDialog<Record<string, never>, object>(
        { title: "Wit Library" },
        WitLibraryDialog,
        {},
    );
    void handle.finished.then(() => {
        witlyLog.info("wit library dialog closed");
    });
}

/** Register the persistent space-panel launcher. Called once from `load()`. */
export function registerWitlyWits(): void {
    // Warm the store so the mix + custom Wits are ready when the dialog opens.
    witStore.hydrate();

    const api = getWitlyApi();
    api.extras.setSpacePanelItem("witly-wits", {
        className: "witly_WitsSpaceButton",
        icon: <WitsIcon />,
        label: "Wits",
        tooltip: "Browse and build your Wit mix",
        onSelected: openWitLibraryDialog,
    });
    witlyLog.info("wit library space-panel launcher registered");
}
