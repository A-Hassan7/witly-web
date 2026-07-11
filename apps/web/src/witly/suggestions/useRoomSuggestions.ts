/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * useRoomSuggestions — React binding for the in-room suggestion engine.
 *
 * Wires the (non-React) suggestionStore + witStore + Smart-timing controller to
 * a component for one room. Keeps all state management outside React so the
 * engine can run independently of mount/unmount churn.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { suggestionStore, carouselPicks } from "./suggestionStore";
import { attachSmartTiming } from "./timing";
import { type RoomSuggestionState, type SuggestionSource } from "./types";
import { witStore, type TimingMode } from "../wits/witStore";
import { getAiCatalog } from "../services/agchatApi";
import { witlyLog } from "../logger";

export interface UseRoomSuggestions {
    state: RoomSuggestionState;
    picks: Array<{ source: SuggestionSource; text: string }>;
    timingMode: TimingMode;
    /** Number of Wits in the room's effective mix (excludes the Wildcard). */
    mixCount: number;
    generate: () => void;
    regenerate: (key: string) => void;
    cancel: () => void;
}

export function useRoomSuggestions(roomId: string): UseRoomSuggestions {
    const state = useSyncExternalStore(
        (cb) => suggestionStore.subscribe(roomId, cb),
        () => suggestionStore.getState(roomId),
    );

    // Re-render on witStore changes (mix / timing / cap edits on any device).
    const [, force] = useState(0);
    useEffect(() => witStore.subscribe(() => force((n) => n + 1)), []);

    // Load the admin mix cap once (also used to bound the mix in the Library).
    useEffect(() => {
        void getAiCatalog()
            .then((c) => {
                if (typeof c.max_wit_mix_size === "number") witStore.setMaxMixSize(c.max_wit_mix_size);
            })
            .catch((err) => witlyLog.warn("getAiCatalog (mix cap) failed", err));
    }, []);

    const timingMode = witStore.getTimingMode(roomId);
    const mixCount = witStore.getEffectiveMix(roomId).length;

    const generate = useCallback(() => {
        void suggestionStore.generate(roomId);
    }, [roomId]);

    const regenerate = useCallback(
        (key: string) => {
            void suggestionStore.regenerate(roomId, key);
        },
        [roomId],
    );

    const cancel = useCallback(() => suggestionStore.cancel(roomId), [roomId]);

    // Smart timing: only attach when the room is in Smart mode and has a mix.
    useEffect(() => {
        if (timingMode !== "smart" || mixCount === 0) return;
        return attachSmartTiming(roomId, () => {
            void suggestionStore.generate(roomId);
        });
    }, [roomId, timingMode, mixCount]);

    return { state, picks: carouselPicks(state), timingMode, mixCount, generate, regenerate, cancel };
}
