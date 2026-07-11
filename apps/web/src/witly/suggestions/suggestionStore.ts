/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * suggestionStore — the in-room suggestion engine (P4).
 *
 * Per active Wit (plus one house Wildcard) it fires ONE `POST /suggestions`
 * call and opens ONE SSE stream, in parallel. Each source's first suggestion is
 * the carousel "top pick"; the rest land in the overflow panel. State is keyed
 * by roomId and exposed reactively so React surfaces can subscribe.
 *
 * Data sources it depends on (all already built):
 *   • witStore            → the effective mix + custom Wit personas + timing
 *   • getWits()           → preset Wit catalog (wit_id → feature, name, emoji)
 *   • roomTimeline        → recent messages for context (read-only Matrix seam)
 *   • agchatApi           → postSuggestions / openSuggestionsStream / getAiCredits
 *
 * This module holds NO Element-internal imports — it consumes the roomTimeline
 * adapter, keeping the SDK coupling quarantined to that one file.
 */

import {
    getWits,
    postSuggestions,
    openSuggestionsStream,
    getAiCredits,
    type WitCatalogEntry,
} from "../services/agchatApi";
import { getRecentMessages } from "../element/roomTimeline";
import { witStore } from "../wits/witStore";
import { witlyLog } from "../logger";
import {
    type RoomSuggestionState,
    type SourceState,
    type SuggestionSource,
} from "./types";

/** Fraction of the credit allowance at which we surface the "near limit" banner. */
const NEAR_LIMIT_FRACTION = 0.9;
/** The Wildcard source key (reserved; a custom Wit can never collide — those are "custom-…"). */
const WILDCARD_KEY = "wildcard";

type Listener = () => void;

function emptyState(): RoomSuggestionState {
    return { status: "idle", order: [], bySource: {}, creditsExhausted: false, nearLimit: false };
}

/** Cached preset catalog promise (loaded once, reused across rooms). */
let presetCatalogPromise: Promise<WitCatalogEntry[]> | undefined;

function loadPresetCatalog(): Promise<WitCatalogEntry[]> {
    if (!presetCatalogPromise) {
        presetCatalogPromise = getWits()
            .then((r) => r.wits)
            .catch((err) => {
                witlyLog.warn("suggestionStore: failed to load preset catalog", err);
                presetCatalogPromise = undefined; // allow a retry next round
                return [];
            });
    }
    return presetCatalogPromise;
}

/** Per-room live engine: state + active stream cleanups + listeners. */
class RoomEngine {
    public state: RoomSuggestionState = emptyState();
    private readonly listeners = new Set<Listener>();
    /** Cleanup fns for the SSE streams of the CURRENT round, keyed by source key. */
    private cleanups = new Map<string, () => void>();

    public subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        for (const l of this.listeners) l();
    }

    /** Replace state (immutably) and notify. */
    private set(next: Partial<RoomSuggestionState>): void {
        this.state = { ...this.state, ...next };
        this.emit();
    }

    private setSource(key: string, next: Partial<SourceState>): void {
        const prev = this.state.bySource[key];
        if (!prev) return;
        this.state = {
            ...this.state,
            bySource: { ...this.state.bySource, [key]: { ...prev, ...next } },
        };
        this.emit();
    }

    /** Cancel all in-flight streams from the current round. */
    public cancel(): void {
        for (const c of this.cleanups.values()) {
            try {
                c();
            } catch {
                /* ignore */
            }
        }
        this.cleanups.clear();
    }

    /**
     * Run a full generation round for the room: resolve sources, then fan out
     * one call + stream per source in parallel.
     */
    public async generate(roomId: string): Promise<void> {
        this.cancel();
        const sources = await resolveSources(roomId);
        if (sources.length === 0) {
            this.set({ status: "idle", order: [], bySource: {} });
            return;
        }

        const bySource: Record<string, SourceState> = {};
        for (const s of sources) {
            bySource[s.key] = { source: s, status: "loading", suggestions: [] };
        }
        this.set({
            status: "generating",
            order: sources.map((s) => s.key),
            bySource,
            creditsExhausted: false,
        });

        // Fire-and-forget credit check to drive the "near limit" banner.
        void this.refreshNearLimit();

        const context = buildContext(roomId);
        await Promise.all(sources.map((s) => this.runSource(s, context)));

        // Round is done when no source is still loading.
        const stillLoading = Object.values(this.state.bySource).some((s) => s.status === "loading");
        if (!stillLoading) this.set({ status: this.state.creditsExhausted ? "error" : "done" });
    }

    /** Re-run a single source (per-card "regenerate"). */
    public async regenerate(roomId: string, key: string): Promise<void> {
        const existing = this.state.bySource[key];
        if (!existing) return;
        // Cancel just this source's previous stream.
        this.cleanups.get(key)?.();
        this.cleanups.delete(key);
        this.setSource(key, { status: "loading", suggestions: [], error: undefined });
        this.set({ status: "generating" });
        await this.runSource(existing.source, buildContext(roomId));
        const stillLoading = Object.values(this.state.bySource).some((s) => s.status === "loading");
        if (!stillLoading) this.set({ status: this.state.creditsExhausted ? "error" : "done" });
    }

    /** Kick off one backend call + SSE stream for a single source. */
    private async runSource(source: SuggestionSource, context: RequestContext): Promise<void> {
        try {
            const variables = { ...context.variables, ...source.extraVariables };
            const { stream_key } = await postSuggestions(source.feature, variables, undefined, context.roomId);
            const cleanup = openSuggestionsStream(stream_key, {
                onSuggestion: (ev) => {
                    const cur = this.state.bySource[source.key];
                    if (!cur) return;
                    this.setSource(source.key, { suggestions: [...cur.suggestions, ev.text] });
                },
                onDone: () => {
                    this.cleanups.delete(source.key);
                    this.setSource(source.key, { status: "done" });
                    void this.refreshNearLimit();
                },
                onError: (ev) => {
                    this.cleanups.delete(source.key);
                    this.setSource(source.key, { status: "error", error: ev.message || "Generation failed" });
                },
            });
            this.cleanups.set(source.key, cleanup);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // The AGChat client throws "402: …" when the user is out of credits.
            if (message.startsWith("402")) {
                this.set({ creditsExhausted: true });
                this.setSource(source.key, { status: "error", error: "Out of credits" });
            } else {
                this.setSource(source.key, { status: "error", error: message });
            }
        }
    }

    private async refreshNearLimit(): Promise<void> {
        try {
            const credits = await getAiCredits();
            if (credits.tokens_allocated > 0) {
                const used = credits.tokens_used / credits.tokens_allocated;
                this.set({ nearLimit: used >= NEAR_LIMIT_FRACTION });
            }
        } catch {
            /* non-fatal */
        }
    }
}

interface RequestContext {
    roomId: string;
    variables: Record<string, unknown>;
}

/** Build the shared request context (messages + draft) once per round. */
function buildContext(roomId: string): RequestContext {
    const messages = getRecentMessages(roomId);
    const draft = readComposerDraft(roomId);
    return {
        roomId,
        variables: {
            messages,
            ...(draft ? { draft_text: draft } : {}),
        },
    };
}

/**
 * The current composer draft is not readable through the module API, and the
 * roomTimeline seam is intentionally read-only for events. For P4 we omit the
 * live draft (returns undefined) — inserting a suggestion always creates an
 * editable draft anyway. Kept as a seam so a future thin composer-read adapter
 * can supply it without touching the engine.
 */
function readComposerDraft(_roomId: string): string | undefined {
    return undefined;
}

/**
 * Resolve the effective mix for a room into concrete suggestion sources, and
 * append the mix-aware Wildcard (which is told the active Wit names to avoid).
 */
async function resolveSources(roomId: string): Promise<SuggestionSource[]> {
    const mix = witStore.getEffectiveMix(roomId);
    if (mix.length === 0) return [];

    const [preset, customWits] = [await loadPresetCatalog(), witStore.getCustomWits()];
    const presetById = new Map(preset.map((p) => [p.wit_id, p]));
    const customById = new Map(customWits.map((c) => [c.id, c]));

    const sources: SuggestionSource[] = [];
    const activeNames: string[] = [];

    for (const witId of mix) {
        const p = presetById.get(witId);
        if (p) {
            activeNames.push(p.name);
            sources.push({
                key: witId,
                kind: "wit",
                label: p.name,
                emoji: p.emoji,
                feature: p.feature,
                extraVariables: {},
            });
            continue;
        }
        const c = customById.get(witId);
        if (c) {
            activeNames.push(c.name);
            sources.push({
                key: witId,
                kind: "custom",
                label: c.name,
                emoji: c.emoji || "✨",
                feature: "custom_wit",
                extraVariables: { wit_prompt: c.prompt, wit_name: c.name },
            });
        }
        // Unknown ids (stale mix entries) are silently skipped.
    }

    if (sources.length === 0) return [];

    // House Wildcard — always last, always present, mix-aware.
    sources.push({
        key: WILDCARD_KEY,
        kind: "wildcard",
        label: "Wildcard",
        emoji: "🎲",
        feature: "wildcard",
        extraVariables: { avoid_wits: activeNames },
    });

    return sources;
}

/** Reactive multi-room store facade. */
class SuggestionStore {
    private readonly engines = new Map<string, RoomEngine>();

    private engine(roomId: string): RoomEngine {
        let e = this.engines.get(roomId);
        if (!e) {
            e = new RoomEngine();
            this.engines.set(roomId, e);
        }
        return e;
    }

    public getState(roomId: string): RoomSuggestionState {
        return this.engines.get(roomId)?.state ?? emptyState();
    }

    public subscribe(roomId: string, listener: Listener): () => void {
        return this.engine(roomId).subscribe(listener);
    }

    public generate(roomId: string): Promise<void> {
        return this.engine(roomId).generate(roomId);
    }

    public regenerate(roomId: string, key: string): Promise<void> {
        return this.engine(roomId).regenerate(roomId, key);
    }

    public cancel(roomId: string): void {
        this.engines.get(roomId)?.cancel();
    }
}

export const suggestionStore = new SuggestionStore();

/** Extract the carousel top-picks (one per source, in order) from room state. */
export function carouselPicks(state: RoomSuggestionState): Array<{ source: SuggestionSource; text: string }> {
    const picks: Array<{ source: SuggestionSource; text: string }> = [];
    for (const key of state.order) {
        const s = state.bySource[key];
        if (s && s.suggestions.length > 0) picks.push({ source: s.source, text: s.suggestions[0] });
    }
    return picks;
}
