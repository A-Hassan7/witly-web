/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * WitlyPanel — the full, tabbed Witly panel (P5).
 *
 * A per-room surface opened from the composer "More" button. Four tabs share
 * one dialog and switch via internal state (no close/reopen):
 *
 *   Suggestions → the P4 overflow grid + per-chat mix + inline Wit creation
 *   Ask AI      → free-form agent over the chat, persisted to a hidden room
 *   Wits        → the shared embeddable Wit Library
 *   Settings    → per-chat suggestion timing
 *
 * Rendered inside Element's module `openDialog` (a centered modal today). The
 * layout is structured so a later bottom-sheet refactor is a CSS-only change:
 * the brand tokens `--witly-z-sheet` / `--witly-shadow-sheet` already exist.
 */

import React, { type JSX, useState } from "react";

import type { DialogProps } from "@element-hq/element-web-module-api";

import { SuggestionsTab } from "./SuggestionsTab";
import { SettingsTab } from "./SettingsTab";
import { AskAiTab } from "../ask/AskAiTab";
import { WitLibrary } from "../wits/WitLibrary";
import { witlyLog } from "../logger";
import "./panel.pcss";

export type WitlyPanelTab = "suggestions" | "ask" | "wits" | "settings";

const TABS: { key: WitlyPanelTab; label: string; emoji: string }[] = [
    { key: "suggestions", label: "Suggestions", emoji: "✨" },
    { key: "ask", label: "Ask AI", emoji: "💬" },
    { key: "wits", label: "Wits", emoji: "🎭" },
    { key: "settings", label: "Settings", emoji: "⚙️" },
];

interface BoundaryState {
    failed: boolean;
}

/** Contains any render error inside the panel so the dialog degrades gracefully. */
class PanelBoundary extends React.Component<React.PropsWithChildren, BoundaryState> {
    public state: BoundaryState = { failed: false };

    public static getDerivedStateFromError(): BoundaryState {
        return { failed: true };
    }

    public componentDidCatch(error: unknown): void {
        witlyLog.warn("WitlyPanel boundary caught an error", error);
    }

    public render(): React.ReactNode {
        if (this.state.failed) {
            return <p className="witly_Panel_error">Something went wrong. Please close and reopen the panel.</p>;
        }
        return this.props.children;
    }
}

export interface WitlyPanelProps {
    roomId: string;
    initialTab?: WitlyPanelTab;
    /** Close the host dialog. */
    onClose?: () => void;
}

export function WitlyPanel({ roomId, initialTab = "suggestions", onClose }: WitlyPanelProps): JSX.Element {
    const [tab, setTab] = useState<WitlyPanelTab>(initialTab);

    return (
        <div className="witly_Panel">
            <nav className="witly_Panel_tabs" role="tablist" aria-label="Witly">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.key}
                        className={`witly_Panel_tab${tab === t.key ? " witly_Panel_tab--on" : ""}`}
                        onClick={() => setTab(t.key)}
                    >
                        <span aria-hidden="true">{t.emoji}</span>
                        <span className="witly_Panel_tabLabel">{t.label}</span>
                    </button>
                ))}
            </nav>

            <div className="witly_Panel_body" role="tabpanel">
                <PanelBoundary>
                    {tab === "suggestions" && (
                        <SuggestionsTab
                            roomId={roomId}
                            onGoToWits={() => setTab("wits")}
                            onInserted={onClose}
                        />
                    )}
                    {tab === "ask" && <AskAiTab roomId={roomId} />}
                    {tab === "wits" && <WitLibrary />}
                    {tab === "settings" && <SettingsTab roomId={roomId} />}
                </PanelBoundary>
            </div>
        </div>
    );
}

/** Extra props injected when opening the panel via the module `openDialog`. */
export interface WitlyPanelDialogProps {
    roomId: string;
    initialTab?: WitlyPanelTab;
}

/** Dialog wrapper so the panel can be opened via the Element module `openDialog`. */
export function WitlyPanelDialog(
    props: WitlyPanelDialogProps & DialogProps<Record<string, never>>,
): JSX.Element {
    return <WitlyPanel roomId={props.roomId} initialTab={props.initialTab} onClose={() => props.onCancel()} />;
}
