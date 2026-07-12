/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * askRoom — Witly's write-capable bridge into Element's Matrix client, used to
 * persist Ask AI conversations as real Matrix rooms.
 *
 * ⚠️  SEAM / STABILITY BOUNDARY — read before editing.
 *
 * Unlike `roomTimeline.ts` (which is strictly READ-ONLY), this module CREATES a
 * room, SENDS events, sets a room tag, and paginates history. That is a deeper
 * coupling, so it is quarantined here alongside `roomTimeline.ts`:
 *
 *   • This and `roomTimeline.ts` are the ONLY Witly files allowed to import
 *     `MatrixClientPeg` / touch the raw `matrix-js-sdk`.
 *   • The Ask AI history for a source chat lives in its OWN Matrix room on the
 *     user's homeserver — durable, paginated, and synced across devices with no
 *     control-plane storage. Each Ask AI room is tagged `witly.ask_ai` so the
 *     room-list filter seam can hide it from the normal chat list.
 *   • The map { sourceRoomId → askRoomId } is stored in account data
 *     (`witly.ask_ai_rooms`) via the module API, same as `witStore`.
 *   • Turns are standard `m.room.message` events carrying a `witly.role`
 *     content field ("user" | "assistant") so both sides render distinctly.
 *   • Recorded in PATCHES.md under "Direct-internal-import seams".
 */

import { MatrixClientPeg } from "../../MatrixClientPeg";
import {
    type MatrixClient,
    type Room,
    EventType,
    MsgType,
    Preset,
    Visibility,
} from "matrix-js-sdk/src/matrix";

import { getWitlyApi } from "./moduleApi";
import { witlyLog } from "../logger";

/** Account-data event mapping each source room to its Ask AI room. */
export const ASK_AI_ROOMS_EVENT_TYPE = "witly.ask_ai_rooms";
/** Room tag applied to Ask AI rooms so the room-list filter can hide them. */
export const ASK_AI_ROOM_TAG = "witly.ask_ai";
/** Content field on turn events marking who "spoke". */
export const ASK_AI_ROLE_FIELD = "witly.role";

export type AskRole = "user" | "assistant";

/** A single Ask AI turn read back from the room timeline. */
export interface AskTurn {
    role: AskRole;
    content: string;
    timestamp: number;
    eventId: string;
}

interface AskRoomsContent {
    rooms?: Record<string, string>;
}

/** Resolve the live Matrix client, or null if it isn't ready yet. */
function getClient(): MatrixClient | null {
    try {
        return MatrixClientPeg.get();
    } catch (err) {
        witlyLog.warn("askRoom: MatrixClientPeg.get() failed", err);
        return null;
    }
}

/** Read the source→ask room map from account data. */
function readMap(): Record<string, string> {
    try {
        const api = getWitlyApi();
        const data = api.client.accountData.get(ASK_AI_ROOMS_EVENT_TYPE);
        const content = (data?.value ?? {}) as AskRoomsContent;
        const rooms = content.rooms;
        if (rooms && typeof rooms === "object") {
            const out: Record<string, string> = {};
            for (const [k, v] of Object.entries(rooms)) {
                if (typeof v === "string") out[k] = v;
            }
            return out;
        }
    } catch (err) {
        witlyLog.debug("askRoom.readMap deferred; client not ready", err);
    }
    return {};
}

/** Persist the source→ask room map to account data. */
async function writeMap(map: Record<string, string>): Promise<void> {
    const api = getWitlyApi();
    await api.client.accountData.set(ASK_AI_ROOMS_EVENT_TYPE, { rooms: map });
}

/** True if the referenced ask room still exists and is joined. */
function askRoomIsUsable(client: MatrixClient, askRoomId: string): boolean {
    const room = client.getRoom(askRoomId);
    return !!room && room.getMyMembership() === "join";
}

/**
 * Return the Ask AI room id for a source chat, creating (and tagging) one on
 * first use. Returns null if the client isn't ready.
 */
export async function getOrCreateAskRoom(sourceRoomId: string): Promise<string | null> {
    const client = getClient();
    if (!client) return null;

    const map = readMap();
    const existing = map[sourceRoomId];
    if (existing && askRoomIsUsable(client, existing)) return existing;

    const sourceRoom = client.getRoom(sourceRoomId);
    const sourceName = sourceRoom?.name ?? "this chat";

    try {
        const { room_id: askRoomId } = await client.createRoom({
            preset: Preset.PrivateChat,
            visibility: Visibility.Private,
            name: `Witly · Ask AI — ${sourceName}`,
            topic: `Witly Ask AI history for ${sourceName}. Managed by Witly; safe to ignore.`,
        });

        // Tag it so the room-list filter seam hides it from the chat list.
        try {
            await client.setRoomTag(askRoomId, ASK_AI_ROOM_TAG, {});
        } catch (err) {
            witlyLog.warn("askRoom: setRoomTag failed (room still usable)", err);
        }

        const next = { ...readMap(), [sourceRoomId]: askRoomId };
        await writeMap(next);
        return askRoomId;
    } catch (err) {
        witlyLog.error("askRoom: createRoom failed", err);
        return null;
    }
}

/** Append a turn to the Ask AI room as an `m.room.message` with a role field. */
export async function appendTurn(askRoomId: string, role: AskRole, content: string): Promise<void> {
    const client = getClient();
    if (!client) return;
    try {
        // Standard text message plus a custom role field so both sides render
        // distinctly. The extra field isn't in the SDK content type, so build
        // it untyped and cast at the call boundary.
        const eventContent = {
            msgtype: MsgType.Text,
            body: content,
            [ASK_AI_ROLE_FIELD]: role,
        };
        await client.sendEvent(askRoomId, EventType.RoomMessage, eventContent as never);
    } catch (err) {
        witlyLog.warn("askRoom.appendTurn failed", err);
    }
}

/** Map a room's loaded timeline to Ask AI turns (oldest → newest). */
function readTurns(room: Room): AskTurn[] {
    const events = room.getLiveTimeline().getEvents();
    const out: AskTurn[] = [];
    for (const ev of events) {
        if (ev.getType() !== EventType.RoomMessage || ev.isRedacted()) continue;
        const c = ev.getContent();
        const role = c[ASK_AI_ROLE_FIELD];
        if (role !== "user" && role !== "assistant") continue;
        const body = typeof c.body === "string" ? c.body : "";
        if (!body) continue;
        out.push({
            role,
            content: body,
            timestamp: ev.getTs(),
            eventId: ev.getId() ?? "",
        });
    }
    return out;
}

/**
 * Load the Ask AI conversation for a source chat (oldest → newest). Paginates
 * up to *limit* events of history. Returns [] if there is no room yet.
 */
export async function loadTurns(sourceRoomId: string, limit = 200): Promise<AskTurn[]> {
    const client = getClient();
    if (!client) return [];
    const askRoomId = readMap()[sourceRoomId];
    if (!askRoomId) return [];
    const room = client.getRoom(askRoomId);
    if (!room) return [];

    try {
        // Back-fill older history so reopening the panel shows the full thread.
        await client.scrollback(room, limit);
    } catch (err) {
        witlyLog.debug("askRoom.loadTurns scrollback failed (using loaded timeline)", err);
    }
    return readTurns(room);
}

/** True if a source chat already has an Ask AI room provisioned. */
export function hasAskRoom(sourceRoomId: string): boolean {
    return !!readMap()[sourceRoomId];
}
