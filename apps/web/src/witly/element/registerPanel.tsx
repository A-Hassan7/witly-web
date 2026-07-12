/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Adapter for opening the full Witly panel.
 *
 * Like `registerWits`/`registerSuggestions`, this is the single place the
 * stable `openDialog` API is called for the panel. If the signature changes
 * upstream, this one file is the fix (see PATCHES.md stability notes).
 */

import { witlyLog } from "../logger";
import { getWitlyApi } from "./moduleApi";
import { WitlyPanelDialog, type WitlyPanelTab } from "../panel/WitlyPanel";

/** Open the full Witly panel for a room, optionally on a specific tab. */
export function openWitlyPanel(roomId: string, initialTab?: WitlyPanelTab): void {
    const api = getWitlyApi();
    const handle = api.openDialog<Record<string, never>, { roomId: string; initialTab?: WitlyPanelTab }>(
        { title: "Witly" },
        WitlyPanelDialog,
        { roomId, initialTab },
    );
    void handle.finished.then(() => witlyLog.debug("witly panel closed"));
}
