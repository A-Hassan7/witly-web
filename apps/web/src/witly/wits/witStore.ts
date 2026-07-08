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
 *
 * The mix is global for v1 (per-room overrides are a later addition).
 *
 * All homeserver access is funnelled through the module API (`api.client
 * .accountData`) so the Witly layer never reaches into Element internals
 * directly (see PATCHES.md stability notes).
 */

import { getWitlyApi } from "../element/moduleApi";
import { witlyLog } from "../logger";

export const WIT_MIX_EVENT_TYPE = "witly.wit_mix";
export const CUSTOM_WITS_EVENT_TYPE = "witly.custom_wits";

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

type Listener = () => void;

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((v) => typeof v === "string");
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
    private hydrated = false;
    private readonly listeners = new Set<Listener>();
    private watching = false;

    /** Read initial state from account data and start watching for remote changes. */
    public hydrate(): void {
        if (this.hydrated) return;
        this.hydrated = true;
        try {
            const api = getWitlyApi();
            const mix = api.client.accountData.get(WIT_MIX_EVENT_TYPE);
            const custom = api.client.accountData.get(CUSTOM_WITS_EVENT_TYPE);
            this.applyMix(mix.value);
            this.applyCustom(custom.value);
            if (!this.watching) {
                mix.watch((value: unknown) => {
                    this.applyMix(value);
                    this.emit();
                });
                custom.watch((value: unknown) => {
                    this.applyCustom(value);
                    this.emit();
                });
                this.watching = true;
            }
        } catch (err) {
            witlyLog.warn("witStore.hydrate failed; starting empty", err);
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

    public async addToMix(witId: string): Promise<void> {
        if (this.mixOrder.includes(witId)) return;
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
}

export const witStore = new WitStore();
