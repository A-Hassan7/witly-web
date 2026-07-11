/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * timing — the Smart/Manual suggestion-timing controller (P4).
 *
 *   • Manual  — never auto-fires; the user taps the Witly button. (Default.)
 *   • Smart   — auto-fires ~5s after a genuine INBOUND message settles.
 *
 * Guardrails on Smart mode:
 *   • Inbound-only     — never triggers on the user's OWN sends.
 *   • Debounce         — a burst of incoming messages resets the 5s timer, so
 *                        we generate once after the conversation pauses.
 *   • Suppress-on-send — the user sending a message cancels any pending fire
 *                        (they're actively engaged; a proxy for "typing").
 *   • Frequency cap    — at most one auto-fire per cooldown window per room.
 *
 * The controller only OBSERVES (via the read-only roomTimeline seam) and calls
 * back to the engine. It never generates directly.
 */

import { subscribeToRoom } from "../element/roomTimeline";
import { witlyLog } from "../logger";

/** Delay after the last inbound message before Smart mode fires. */
export const SMART_DELAY_MS = 5000;
/** Minimum gap between two Smart auto-fires in the same room. */
export const SMART_COOLDOWN_MS = 30000;

/**
 * Attach a Smart-timing watcher to a room. Returns a disposer that cancels the
 * pending timer and unsubscribes from the timeline.
 *
 * `onFire` is invoked when an auto-generation should run. Callers only attach
 * this when the room's effective timing mode is "smart"; Manual mode attaches
 * nothing.
 */
export function attachSmartTiming(roomId: string, onFire: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastFiredAt = 0;

    const clear = (): void => {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
    };

    const unsubscribe = subscribeToRoom(roomId, (msg) => {
        if (msg.is_own) {
            // The user is actively participating — cancel any pending auto-fire.
            clear();
            return;
        }
        // Debounce: reset the timer on each new inbound message.
        clear();
        timer = setTimeout(() => {
            timer = undefined;
            const now = Date.now();
            if (now - lastFiredAt < SMART_COOLDOWN_MS) {
                witlyLog.debug("smart timing: within cooldown, skipping");
                return;
            }
            lastFiredAt = now;
            try {
                onFire();
            } catch (err) {
                witlyLog.warn("smart timing: onFire threw", err);
            }
        }, SMART_DELAY_MS);
    });

    return () => {
        clear();
        unsubscribe();
    };
}
