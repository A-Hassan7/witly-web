/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * roomVisibility — Witly helper for the room-list filter seam.
 *
 * Ask AI conversations are stored in dedicated Matrix rooms tagged
 * `witly.ask_ai` (see `askRoom.ts`). Those rooms are an implementation detail
 * and must not clutter the user's chat list, so Element's `isRoomVisible`
 * consults this helper (a single additive line — see PATCHES.md room-list seam).
 *
 * Kept in the Witly layer so the Element-side edit stays trivial and the whole
 * feature remains removable by reverting one line + deleting `witly/`.
 */

import { type Room } from "matrix-js-sdk/src/matrix";

import { ASK_AI_ROOM_TAG } from "./askRoom";

/** True if the room is a Witly Ask AI history room (tagged `witly.ask_ai`). */
export function isWitlyAskRoom(room: Room): boolean {
    try {
        return Boolean(room.tags?.[ASK_AI_ROOM_TAG]);
    } catch {
        return false;
    }
}
