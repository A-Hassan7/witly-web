/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * AskAiTab — the free-form "Ask AI" agent over the current chat (P5).
 *
 * A multi-turn conversation grounded in the recent room history. Each turn is
 * persisted to a dedicated (hidden) Matrix room via `askRoom`, so history is
 * durable and syncs across devices. Answers are never auto-sent — the user can
 * insert one as an editable composer draft, copy it, or ask a follow-up.
 *
 * Context depth (how many recent room messages are sent) is admin-configured
 * (`ask_context_depth`) and not exposed here.
 */

import React, { type JSX, useCallback, useEffect, useRef, useState } from "react";

import {
    appendTurn,
    getOrCreateAskRoom,
    loadTurns,
    type AskRole,
} from "../element/askRoom";
import { getRecentMessages } from "../element/roomTimeline";
import { insertSuggestionIntoComposer } from "../element/moduleApi";
import {
    getAiCatalog,
    openSuggestionsStream,
    postAsk,
    postSuggestions,
    type SuggestionsResponse,
} from "../services/agchatApi";
import { witlyLog } from "../logger";
import { witStore } from "../wits/witStore";
import "./ask.pcss";

interface Turn {
    role: AskRole;
    content: string;
    /** True while the assistant answer is still streaming. */
    pending?: boolean;
    /** True if this turn failed to generate. */
    error?: boolean;
}

interface QuickAction {
    key: string;
    label: string;
    /** Text shown as the user turn. */
    question: string;
    /** Build the backend request for this action. */
    run: (
        question: string,
        messages: Array<{ sender_id: string; is_own: boolean; body: string }>,
        roomId: string,
    ) => Promise<SuggestionsResponse>;
}

const QUICK_ACTIONS: QuickAction[] = [
    {
        key: "summarize",
        label: "Summarize",
        question: "Summarize the conversation.",
        run: (_q, messages, roomId) => postSuggestions("suggestions/summary", { messages }, undefined, roomId),
    },
    {
        key: "draft",
        label: "Draft a reply",
        question: "Draft a reply I could send next in this conversation.",
        run: (q, messages, roomId) => postAsk(q, messages, roomId),
    },
    {
        key: "catchup",
        label: "Catch me up",
        question: "Catch me up — what did I miss in this conversation?",
        run: (q, messages, roomId) => postAsk(q, messages, roomId),
    },
];

export interface AskAiTabProps {
    roomId: string;
}

export function AskAiTab({ roomId }: AskAiTabProps): JSX.Element {
    const [turns, setTurns] = useState<Turn[]>([]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [creditsExhausted, setCreditsExhausted] = useState(false);
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const cleanupRef = useRef<(() => void) | null>(null);

    // Load the admin-configured context depth once.
    useEffect(() => {
        void getAiCatalog()
            .then((c) => {
                if (typeof c.ask_context_depth === "number") witStore.setAskContextDepth(c.ask_context_depth);
            })
            .catch((err) => witlyLog.warn("getAiCatalog (ask depth) failed", err));
    }, []);

    // Load persisted history for this chat.
    useEffect(() => {
        let active = true;
        void loadTurns(roomId)
            .then((loaded) => {
                if (active) {
                    setTurns(loaded.map((t) => ({ role: t.role, content: t.content })));
                }
            })
            .catch((err) => witlyLog.warn("askRoom.loadTurns failed", err));
        return () => {
            active = false;
        };
    }, [roomId]);

    // Auto-scroll to the newest turn.
    useEffect(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [turns]);

    // Close any open SSE stream on unmount.
    useEffect(() => () => cleanupRef.current?.(), []);

    const run = useCallback(
        async (displayQuestion: string, build: QuickAction["run"]): Promise<void> => {
            if (busy) return;
            setBusy(true);
            setCreditsExhausted(false);

            // Optimistic user turn + pending assistant placeholder.
            setTurns((prev) => [
                ...prev,
                { role: "user", content: displayQuestion },
                { role: "assistant", content: "", pending: true },
            ]);

            // Persist the user turn (and provision the room on first use).
            const askRoomId = await getOrCreateAskRoom(roomId);
            if (askRoomId) void appendTurn(askRoomId, "user", displayQuestion);

            const depth = witStore.getAskContextDepth();
            const context = getRecentMessages(roomId, depth);

            const finish = (content: string, error = false): void => {
                setTurns((prev) => {
                    const next = [...prev];
                    // The pending assistant turn is always the last item.
                    next[next.length - 1] = { role: "assistant", content, error };
                    return next;
                });
                setBusy(false);
                if (!error && content && askRoomId) void appendTurn(askRoomId, "assistant", content);
            };

            try {
                const { stream_key } = await build(displayQuestion, context, roomId);
                let answer = "";
                cleanupRef.current = openSuggestionsStream(stream_key, {
                    onSuggestion: (e) => {
                        answer = e.text;
                        setTurns((prev) => {
                            const next = [...prev];
                            next[next.length - 1] = { role: "assistant", content: answer, pending: true };
                            return next;
                        });
                    },
                    onDone: () => finish(answer || "…"),
                    onError: (e) => {
                        if (e.code === "credits_exhausted" || e.code === "insufficient_credits") {
                            setCreditsExhausted(true);
                        }
                        finish(e.message || "Something went wrong. Please try again.", true);
                    },
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : "";
                if (msg.startsWith("402")) setCreditsExhausted(true);
                finish(msg.startsWith("402") ? "You're out of AI credits." : "Couldn't reach the AI. Please try again.", true);
            }
        },
        [busy, roomId],
    );

    const onSubmit = useCallback(() => {
        const q = input.trim();
        if (!q) return;
        setInput("");
        void run(q, (question, messages, rid) => postAsk(question, messages, rid));
    }, [input, run]);

    const insert = useCallback((text: string) => {
        insertSuggestionIntoComposer(text);
    }, []);

    const copy = useCallback((text: string, idx: number) => {
        void navigator.clipboard?.writeText(text).then(
            () => {
                setCopiedIdx(idx);
                window.setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1500);
            },
            (err) => witlyLog.warn("clipboard write failed", err),
        );
    }, []);

    const followUp = useCallback((assistantText: string) => {
        setInput((cur) => (cur.length ? cur : `About that: `));
        witlyLog.debug("ask follow-up", { len: assistantText.length });
    }, []);

    return (
        <div className="witly_Ask">
            {creditsExhausted && (
                <div className="witly_Sg_banner witly_Sg_banner--error">
                    You're out of AI credits. Upgrade to keep asking.
                </div>
            )}

            <div className="witly_Ask_chips" role="group" aria-label="Quick actions">
                {QUICK_ACTIONS.map((a) => (
                    <button
                        key={a.key}
                        type="button"
                        className="witly_Btn witly_Ask_chip"
                        onClick={() => void run(a.question, a.run)}
                        disabled={busy}
                    >
                        {a.label}
                    </button>
                ))}
            </div>

            <div className="witly_Ask_thread" ref={listRef}>
                {turns.length === 0 && (
                    <p className="witly_Ask_empty">
                        Ask anything about this chat — summarize it, draft a reply, or catch up on what you missed.
                    </p>
                )}
                {turns.map((t, i) => (
                    <div key={i} className={`witly_Ask_turn witly_Ask_turn--${t.role}${t.error ? " witly_Ask_turn--error" : ""}`}>
                        <div className="witly_Ask_bubble">
                            {t.pending && !t.content ? <span className="witly_Ask_typing">Thinking…</span> : t.content}
                        </div>
                        {t.role === "assistant" && !t.pending && !t.error && t.content && (
                            <div className="witly_Ask_actions">
                                <button type="button" className="witly_Btn witly_Ask_action" onClick={() => insert(t.content)}>
                                    Insert draft
                                </button>
                                <button type="button" className="witly_Btn witly_Ask_action" onClick={() => copy(t.content, i)}>
                                    {copiedIdx === i ? "Copied ✓" : "Copy"}
                                </button>
                                <button type="button" className="witly_Btn witly_Ask_action" onClick={() => followUp(t.content)}>
                                    Ask follow-up
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <form
                className="witly_Ask_composer"
                onSubmit={(e) => {
                    e.preventDefault();
                    onSubmit();
                }}
            >
                <input
                    className="witly_Ask_input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask about this chat…"
                    aria-label="Ask AI a question"
                    disabled={busy}
                />
                <button
                    type="submit"
                    className="witly_Btn witly_Btn--primary witly_Ask_send"
                    disabled={busy || input.trim().length === 0}
                >
                    {busy ? "…" : "Ask"}
                </button>
            </form>
        </div>
    );
}
