/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Shared types for the in-room suggestion engine (P4).
 *
 * A "source" is one thing that produces suggestions: a preset Wit, a custom
 * Wit, or the house Wildcard. Each source maps to exactly one backend
 * `POST /suggestions` call + one SSE stream, and contributes one card to the
 * carousel (its top pick) plus the rest to the overflow panel.
 */

/** The kind of a suggestion source, used for styling (Wildcard is distinct). */
export type SourceKind = "wit" | "custom" | "wildcard";

/** A resolved suggestion source: everything needed to make one backend call. */
export interface SuggestionSource {
    /** Stable key: the wit_id, or the literal "wildcard". Unique per round. */
    key: string;
    kind: SourceKind;
    /** Card header label — the Wit's display name, or "Wildcard". */
    label: string;
    emoji: string;
    /** Backend feature, e.g. "wits/rasta", "custom_wit", or "wildcard". */
    feature: string;
    /** Extra `variables` merged into the request (wit_prompt, wit_name, avoid_wits). */
    extraVariables: Record<string, unknown>;
}

/** Per-source generation status. */
export type SourceStatus = "loading" | "done" | "error";

/** Live state for a single source within a round. */
export interface SourceState {
    source: SuggestionSource;
    status: SourceStatus;
    /** Suggestions received so far, in arrival order. */
    suggestions: string[];
    /** Human-readable error message when status === "error". */
    error?: string;
}

/** Overall engine status for a room. */
export type EngineStatus = "idle" | "generating" | "done" | "error";

/** The full reactive state the UI renders for a room. */
export interface RoomSuggestionState {
    status: EngineStatus;
    /** Sources in mix order, Wildcard last. */
    order: string[];
    /** Per-source state keyed by SuggestionSource.key. */
    bySource: Record<string, SourceState>;
    /** True when the backend reported the user is out of credits (HTTP 402). */
    creditsExhausted: boolean;
    /** True when the user has crossed the 90% usage threshold. */
    nearLimit: boolean;
}
