/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * roomTimeline — Witly's ONLY direct, read-only bridge into Element's Matrix
 * client internals.
 *
 * ⚠️  SEAM / STABILITY BOUNDARY — read before editing.
 *
 * The Element module API (`@element-hq/element-web-module-api`) deliberately
 * does NOT expose room history or a live incoming-message stream. In-room
 * suggestions need both, so this file reaches directly into Element's own
 * `MatrixClientPeg` and the `matrix-js-sdk`. That is a DEEPER coupling than the
 * module-API adapter in `moduleApi.ts`, so it is quarantined here:
 *
 *   • This is the ONLY Witly file allowed to import `MatrixClientPeg` or read
 *     the raw `matrix-js-sdk` timeline. Everything else in `witly/` consumes the
 *     small, typed helpers below — never the SDK directly.
 *   • READ-ONLY. This module never sends, edits, redacts, or mutates any Matrix
 *     state. It only reads recent events and subscribes to new ones.
 *   • If an upstream change moves `MatrixClientPeg` or changes the timeline API,
 *     this single file is the fix. It is recorded in PATCHES.md under
 *     "Direct-internal-import seams".
 *
 * It touches NO Element source file (purely additive import), so it is not a
 * core-edit seam — but it is the highest-coupling Witly module and is treated
 * with the same care.
 */

import { MatrixClientPeg } from "../../MatrixClientPeg";
import {
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type IRoomTimelineData,
    RoomEvent,
    MsgType,
    EventType,
} from "matrix-js-sdk/src/matrix";

import { witlyLog } from "../logger";

/**
 * A single conversation message, flattened to exactly what the suggestion
 * backend needs. Matches the `WitsHandler` contract on the control plane:
 * `{ sender_id, is_own, body }` plus a `timestamp` for richer context.
 */
export interface TimelineMessage {
    /** Human display name of the sender (NOT the raw MXID). "Me" is left to the prompt. */
    sender_id: string;
    /** True when the current user sent this message. */
    is_own: boolean;
    /** Plain-text body. Non-text messages are mapped to a short placeholder for P4. */
    body: string;
    /** Epoch milliseconds the event was sent. */
    timestamp: number;
}

/** Resolve the live Matrix client, or null if it isn't ready yet. */
function getClient(): MatrixClient | null {
    try {
        return MatrixClientPeg.get();
    } catch (err) {
        witlyLog.warn("roomTimeline: MatrixClientPeg.get() failed", err);
        return null;
    }
}

/** Resolve a sender's display name, falling back to the MXID. */
function displayNameFor(room: Room, userId: string | undefined): string {
    if (!userId) return "Someone";
    const member = room.getMember(userId);
    return member?.rawDisplayName || member?.name || userId;
}

/**
 * Map a raw Matrix event to a {@link TimelineMessage}, or null if it should be
 * skipped (not a message, or an empty/unsupported body).
 *
 * P4 is TEXT-ONLY: images, audio (voice notes), video and files are collapsed
 * to a short `[type]` placeholder so they still provide positional context
 * without media understanding. Real captioning/transcription is a later stage.
 */
function toMessage(client: MatrixClient, room: Room, ev: MatrixEvent): TimelineMessage | null {
    if (ev.getType() !== EventType.RoomMessage) return null;
    if (ev.isRedacted()) return null;

    const content = ev.getContent();
    const msgtype = content.msgtype;
    const sender = ev.getSender() ?? undefined;

    let body: string;
    switch (msgtype) {
        case MsgType.Text:
        case MsgType.Notice:
        case MsgType.Emote:
            body = typeof content.body === "string" ? content.body.trim() : "";
            break;
        case MsgType.Image:
            body = "[image]";
            break;
        case MsgType.Audio:
            body = "[voice note]";
            break;
        case MsgType.Video:
            body = "[video]";
            break;
        case MsgType.File:
            body = "[file]";
            break;
        default:
            body = typeof content.body === "string" ? content.body.trim() : "";
    }

    if (!body) return null;

    return {
        sender_id: displayNameFor(room, sender),
        is_own: sender === client.getUserId(),
        body,
        timestamp: ev.getTs(),
    };
}

/**
 * Read up to *limit* recent messages from a room (oldest → newest), flattened
 * for the suggestion backend. Returns [] if the client/room isn't available.
 *
 * Only reads what is already loaded in the live timeline — it does NOT
 * paginate/back-fill, to keep this cheap and side-effect-free. The live
 * timeline is normally well-populated for a room the user is viewing.
 */
export function getRecentMessages(roomId: string, limit = 40): TimelineMessage[] {
    const client = getClient();
    if (!client) return [];
    const room = client.getRoom(roomId);
    if (!room) return [];

    const events = room.getLiveTimeline().getEvents();
    const out: TimelineMessage[] = [];
    // Walk newest→oldest so we can stop early once we have `limit` text messages.
    for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
        const msg = toMessage(client, room, events[i]);
        if (msg) out.push(msg);
    }
    out.reverse();
    return out;
}

/** True if the most recent message in the room was sent by someone else. */
export function lastMessageIsInbound(roomId: string): boolean {
    const client = getClient();
    if (!client) return false;
    const room = client.getRoom(roomId);
    if (!room) return false;
    const events = room.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= 0; i--) {
        const msg = toMessage(client, room, events[i]);
        if (msg) return !msg.is_own;
    }
    return false;
}

/**
 * Subscribe to NEW live messages in a specific room. The callback fires once
 * per genuine incoming/outgoing live event (never on pagination/back-fill).
 *
 * Returns an unsubscribe function. Safe to call before the client is ready —
 * it will simply no-op and return a cleanup that does nothing.
 */
export function subscribeToRoom(
    roomId: string,
    onMessage: (msg: TimelineMessage) => void,
): () => void {
    const client = getClient();
    if (!client) return () => { };

    const handler = (
        ev: MatrixEvent,
        room: Room | undefined,
        toStartOfTimeline: boolean | undefined,
        removed: boolean,
        data: IRoomTimelineData,
    ): void => {
        if (removed || !room || room.roomId !== roomId) return;
        // Ignore pagination/history back-fill — only react to genuine live events.
        if (toStartOfTimeline || !data?.liveEvent) return;
        const msg = toMessage(client, room, ev);
        if (msg) onMessage(msg);
    };

    client.on(RoomEvent.Timeline, handler);
    return () => {
        try {
            client.removeListener(RoomEvent.Timeline, handler);
        } catch (err) {
            witlyLog.warn("roomTimeline: unsubscribe failed", err);
        }
    };
}
