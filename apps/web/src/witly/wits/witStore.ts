/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * witStore — the user's Wit mix and custom Wits, persisted to Matrix account
 * data via the Element module API.
 *
 * Account data lives on the user's own homeserver (their Tuwunel pod), so both
 * the mix and any custom Wits sync across devices and survive a reinstall or a
 * localStorage wipe — unlike browser storage. Two event types are used (under
 * the existing `witly.` namespace):
 *
 *   witly.wit_mix      → { order: string[] }               // active wit_ids, ordered
 *   witly.custom_wits  → { wits: CustomWit[] }              // user-defined personas
 *   witly.room_settings→ { rooms: { [roomId]: RoomOverride } } // per-chat overrides
 *
 * The mix is global by default; a room may override the active mix and/or the
 * suggestion-timing mode (P4). Per-room overrides layer on top of the global
 * mix — a room with no override inherits the global one.
 *
 * All homeserver access is funnelled through the module API (`api.client
 * .accountData`) so the Witly layer never reaches into Element internals
 * directly (see PATCHES.md stability notes).
 */

import { getWitlyApi } from "../element/moduleApi";
import { witlyLog } from "../logger";

export const WIT_MIX_EVENT_TYPE = "witly.wit_mix";
export const CUSTOM_WITS_EVENT_TYPE = "witly.custom_wits";
export const ROOM_SETTINGS_EVENT_TYPE = "witly.room_settings";

/** Suggestion-timing mode. Manual = button only; Smart = auto ~5s after inbound. */
export type TimingMode = "manual" | "smart";

/** The global default timing mode when a room has no override. */
export const DEFAULT_TIMING_MODE: TimingMode = "manual";

/** Fallback mix-size cap used until the backend catalog value is loaded. */
export const DEFAULT_MAX_MIX_SIZE = 8;

/** Per-room override of the global mix and/or timing. Absent fields inherit. */
export interface RoomOverride {
    /** Ordered wit_ids active in this room. If unset, the global mix applies. */
    mix?: string[];
    /** Timing mode for this room. If unset, the global default applies. */
    timing?: TimingMode;
}

/** A user-defined custom Wit. Stored on the client (account data) for now. */
export interface CustomWit {
    /** Stable client-generated id, e.g. "custom-1720000000000". */
    id: string;
    name: string;
    emoji: string;
    /** The persona/tone description sent to the backend as `wit_prompt`. */
    prompt: string;
    /** Optional canned example replies, same shape as preset Wits. */
    examples?: { incoming: string; reply: string }[];
}

interface WitMixContent {
    order?: string[];
}

interface CustomWitsContent {
    wits?: CustomWit[];
}

interface RoomSettingsContent {
    rooms?: Record<string, RoomOverride>;
}

type Listener = () => void;

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isTimingMode(value: unknown): value is TimingMode {
    return value === "manual" || value === "smart";
}

function sanitizeRoomOverride(value: unknown): RoomOverride | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    const override: RoomOverride = {};
    if (isStringArray(v.mix)) override.mix = v.mix;
    if (isTimingMode(v.timing)) override.timing = v.timing;
    return Object.keys(override).length ? override : null;
}

function sanitizeCustomWit(value: unknown): CustomWit | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    if (typeof v.id !== "string" || typeof v.name !== "string" || typeof v.prompt !== "string") {
        return null;
    }
    const examples = Array.isArray(v.examples)
        ? v.examples.filter(
            (e): e is { incoming: string; reply: string } =>
                typeof e === "object" &&
                e !== null &&
                typeof (e as Record<string, unknown>).incoming === "string" &&
                typeof (e as Record<string, unknown>).reply === "string",
        )
        : undefined;
    return {
        id: v.id,
        name: v.name,
        emoji: typeof v.emoji === "string" ? v.emoji : "",
        prompt: v.prompt,
        ...(examples && examples.length ? { examples } : {}),
    };
}

/**
 * Reactive store over the two account-data keys. Watches the homeserver so
 * changes on another device are reflected live, and notifies local listeners
 * after a write so the UI updates optimistically.
 */
class WitStore {
    private mixOrder: string[] = [];
    private customWits: CustomWit[] = [];
    private roomSettings: Record<string, RoomOverride> = {};
    private maxMixSize = DEFAULT_MAX_MIX_SIZE;
    private globalTiming: TimingMode = DEFAULT_TIMING_MODE;
    private hydrated = false;
    private readonly listeners = new Set<Listener>();

    /**
     * Read initial state from account data and start watching for remote changes.
     *
     * `hydrate()` can be called before the Matrix client exists — it is warmed
     * from the module's `load()` (via `registerWitlyWits`), which runs during
     * app bootstrap, ahead of client start and the first `/sync`. In that case
     * `accountData.get()` throws (no client). We must NOT mark the store
     * hydrated in that situation, or the `if (this.hydrated) return` guard would
     * permanently pin it to an empty mix — even after the dialog later opens
     * with a live, synced client. So `hydrated` is only set once the read +
     * watch have actually attached; every subsequent `subscribe()`/`hydrate()`
     * call retries until then.
     */
    public hydrate(): void {
        if (this.hydrated) return;
        try {
            const api = getWitlyApi();
            const mix = api.client.accountData.get(WIT_MIX_EVENT_TYPE);
            const custom = api.client.accountData.get(CUSTOM_WITS_EVENT_TYPE);
            const rooms = api.client.accountData.get(ROOM_SETTINGS_EVENT_TYPE);
            this.applyMix(mix.value);
            this.applyCustom(custom.value);
            this.applyRoomSettings(rooms.value);
            // Watches recover the state if account data arrives via `/sync`
            // after this (possibly empty) initial read — the `.watch()` fires on
            // the client's `AccountData` event.
            mix.watch((value: unknown) => {
                this.applyMix(value);
                this.emit();
            });
            custom.watch((value: unknown) => {
                this.applyCustom(value);
                this.emit();
            });
            rooms.watch((value: unknown) => {
                this.applyRoomSettings(value);
                this.emit();
            });
            this.hydrated = true; // only after a successful read + watch attach
            this.emit();
        } catch (err) {
            // Client not ready yet — stay unhydrated so a later call retries.
            witlyLog.debug("witStore.hydrate deferred; client not ready yet", err);
        }
    }

    private applyMix(value: unknown): void {
        const content = (value ?? {}) as WitMixContent;
        this.mixOrder = isStringArray(content.order) ? content.order : [];
    }

    private applyCustom(value: unknown): void {
        const content = (value ?? {}) as CustomWitsContent;
        const list = Array.isArray(content.wits) ? content.wits : [];
        this.customWits = list.map(sanitizeCustomWit).filter((w): w is CustomWit => w !== null);
    }

    private applyRoomSettings(value: unknown): void {
        const content = (value ?? {}) as RoomSettingsContent;
        const rooms = content.rooms;
        const out: Record<string, RoomOverride> = {};
        if (rooms && typeof rooms === "object") {
            for (const [roomId, raw] of Object.entries(rooms)) {
                const sane = sanitizeRoomOverride(raw);
                if (sane) out[roomId] = sane;
            }
        }
        this.roomSettings = out;
    }

    public subscribe(listener: Listener): () => void {
        this.hydrate();
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        for (const l of this.listeners) l();
    }

    // ── Mix ───────────────────────────────────────────────────────────────────

    public getMix(): string[] {
        return [...this.mixOrder];
    }

    public isInMix(witId: string): boolean {
        return this.mixOrder.includes(witId);
    }

    /** The max number of Wits allowed in the mix (admin-configured; see catalog). */
    public getMaxMixSize(): number {
        return this.maxMixSize;
    }

    /**
     * Set the mix-size cap from the backend catalog (`max_wit_mix_size`).
     * Ignores non-positive values so a bad catalog read can't lock the mix.
     */
    public setMaxMixSize(size: number): void {
        if (Number.isFinite(size) && size > 0 && size !== this.maxMixSize) {
            this.maxMixSize = Math.floor(size);
            this.emit();
        }
    }

    /** True when the global mix is at the configured cap. */
    public isMixFull(): boolean {
        return this.mixOrder.length >= this.maxMixSize;
    }

    public async addToMix(witId: string): Promise<void> {
        if (this.mixOrder.includes(witId)) return;
        if (this.mixOrder.length >= this.maxMixSize) {
            throw new Error(`Your mix is full (max ${this.maxMixSize} Wits). Remove one to add another.`);
        }
        this.mixOrder = [...this.mixOrder, witId];
        await this.persistMix();
    }

    public async removeFromMix(witId: string): Promise<void> {
        if (!this.mixOrder.includes(witId)) return;
        this.mixOrder = this.mixOrder.filter((id) => id !== witId);
        await this.persistMix();
    }

    private async persistMix(): Promise<void> {
        this.emit(); // optimistic local update
        try {
            const api = getWitlyApi();
            await api.client.accountData.set(WIT_MIX_EVENT_TYPE, { order: this.mixOrder });
        } catch (err) {
            witlyLog.warn("witStore.persistMix failed", err);
            throw err;
        }
    }

    // ── Custom Wits ────────────────────────────────────────────────────────────

    public getCustomWits(): CustomWit[] {
        return [...this.customWits];
    }

    public async saveCustomWit(wit: CustomWit): Promise<void> {
        const idx = this.customWits.findIndex((w) => w.id === wit.id);
        if (idx >= 0) {
            this.customWits = this.customWits.map((w) => (w.id === wit.id ? wit : w));
        } else {
            this.customWits = [...this.customWits, wit];
        }
        await this.persistCustom();
    }

    public async deleteCustomWit(id: string): Promise<void> {
        if (!this.customWits.some((w) => w.id === id)) return;
        this.customWits = this.customWits.filter((w) => w.id !== id);
        // Also drop it from the mix if present.
        if (this.mixOrder.includes(id)) {
            this.mixOrder = this.mixOrder.filter((m) => m !== id);
            await this.persistMix();
        }
        await this.persistCustom();
    }

    private async persistCustom(): Promise<void> {
        this.emit(); // optimistic local update
        try {
            const api = getWitlyApi();
            await api.client.accountData.set(CUSTOM_WITS_EVENT_TYPE, { wits: this.customWits });
        } catch (err) {
            witlyLog.warn("witStore.persistCustom failed", err);
            throw err;
        }
    }

    // ── Per-room overrides & timing ────────────────────────────────────────────

    /**
     * The effective mix for a room: its per-room override if set, else the
     * global mix. Pass no roomId to get the global mix.
     */
    public getEffectiveMix(roomId?: string): string[] {
        if (roomId) {
            const override = this.roomSettings[roomId];
            if (override?.mix) return [...override.mix];
        }
        return [...this.mixOrder];
    }

    /** True if the room has an explicit mix override (vs inheriting the global mix). */
    public hasRoomMixOverride(roomId: string): boolean {
        return this.roomSettings[roomId]?.mix !== undefined;
    }

    /** The effective timing mode for a room: its override if set, else the global default. */
    public getTimingMode(roomId?: string): TimingMode {
        if (roomId) {
            const override = this.roomSettings[roomId];
            if (override?.timing) return override.timing;
        }
        return this.globalTiming;
    }

    /** Set (or clear) a room's mix override. Pass null to inherit the global mix. */
    public async setRoomMix(roomId: string, mix: string[] | null): Promise<void> {
        const capped = mix ? mix.slice(0, this.maxMixSize) : null;
        await this.updateRoomOverride(roomId, (o) => {
            if (capped === null) delete o.mix;
            else o.mix = capped;
        });
    }

    /** Set a room's timing override. Pass null to inherit the global default. */
    public async setRoomTiming(roomId: string, timing: TimingMode | null): Promise<void> {
        await this.updateRoomOverride(roomId, (o) => {
            if (timing === null) delete o.timing;
            else o.timing = timing;
        });
    }

    private async updateRoomOverride(roomId: string, mutate: (o: RoomOverride) => void): Promise<void> {
        const next = { ...this.roomSettings };
        const current: RoomOverride = { ...(next[roomId] ?? {}) };
        mutate(current);
        if (Object.keys(current).length === 0) delete next[roomId];
        else next[roomId] = current;
        this.roomSettings = next;
        this.emit(); // optimistic local update
        try {
            const api = getWitlyApi();
            await api.client.accountData.set(ROOM_SETTINGS_EVENT_TYPE, { rooms: this.roomSettings });
        } catch (err) {
            witlyLog.warn("witStore.updateRoomOverride failed", err);
            throw err;
        }
    }
}

export const witStore = new WitStore();
