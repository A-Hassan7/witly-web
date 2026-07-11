/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Adapter for opening the in-room Suggestions overflow panel.
 *
 * Like `registerWits`/`registerConnect`, this is the single place the stable
 * `openDialog` API is called for the suggestions panel. If the signature
 * changes upstream, this one file is the fix (see PATCHES.md stability notes).
 */

import { witlyLog } from "../logger";
import { getWitlyApi } from "./moduleApi";
import { SuggestionsPanelDialog } from "../suggestions/SuggestionsPanel";

/** Open the suggestions overflow panel for a room in an Element module dialog. */
export function openSuggestionsPanel(roomId: string): void {
    const api = getWitlyApi();
    const handle = api.openDialog<Record<string, never>, { roomId: string }>(
        { title: "Suggestions" },
        SuggestionsPanelDialog,
        { roomId },
    );
    void handle.finished.then(() => witlyLog.debug("suggestions panel closed"));
}
