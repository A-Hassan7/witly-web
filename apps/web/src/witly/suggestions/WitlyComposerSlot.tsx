/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * WitlyComposerSlot — the single, defensive entry point mounted by the Element
 * composer seam (see PATCHES.md seam #3).
 *
 * Element's `MessageComposer` renders exactly ONE Witly element:
 * `<WitlyComposerSlot roomId={…} />`. Everything else lives under `witly/`.
 * This wrapper's job is to make that seam TOTALLY SAFE:
 *
 *   • It renders nothing until the Witly module has loaded and the user is
 *     authenticated with the AGChat backend (no auth → no AI surface).
 *   • It wraps the suggestion UI in an error boundary, so any failure inside
 *     Witly renders null instead of breaking Element's composer.
 *
 * Keeping all this in the Witly layer means the Element-side edit stays a
 * single, trivial, side-effect-free JSX line.
 */

import React from "react";

import { hasWitlyApi } from "../element/moduleApi";
import { witlySession } from "../services/session";
import { witlyLog } from "../logger";
import { WitlyComposerSuggestions } from "./WitlyComposerSuggestions";

interface SlotProps {
    roomId: string;
}

interface BoundaryState {
    failed: boolean;
}

/** Contains any render/runtime error inside Witly so Element's composer survives. */
class WitlyBoundary extends React.Component<React.PropsWithChildren, BoundaryState> {
    public state: BoundaryState = { failed: false };

    public static getDerivedStateFromError(): BoundaryState {
        return { failed: true };
    }

    public componentDidCatch(error: unknown): void {
        witlyLog.warn("WitlyComposerSlot boundary caught an error", error);
    }

    public render(): React.ReactNode {
        if (this.state.failed) return null;
        return this.props.children;
    }
}

export function WitlyComposerSlot({ roomId }: SlotProps): React.JSX.Element | null {
    // Guard the seam: nothing renders unless Witly is ready and signed in.
    if (!roomId || !hasWitlyApi() || !witlySession.isAuthenticated()) return null;

    return (
        <WitlyBoundary>
            <WitlyComposerSuggestions roomId={roomId} />
        </WitlyBoundary>
    );
}
