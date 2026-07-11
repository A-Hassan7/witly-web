/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Element module-API boundary.
 *
 * This is the ONLY place the Witly layer reaches into Element's module API
 * (`@element-hq/element-web-module-api`). The rest of Witly imports the small,
 * stable helpers from here rather than touching `Api` directly.
 *
 * Why: several module-API hooks we depend on are marked `@alpha` and may change
 * signature across upstream Element versions. Funnelling every call through this
 * one adapter file means an upstream change is a single-file fix — our stability
 * mitigation for building on an evolving API (see PATCHES.md).
 *
 * Phase-specific adapters (insert-into-composer, room-header button, onboarding
 * login component, session hydration) are added here as each phase needs them.
 */

import type { Api } from "@element-hq/element-web-module-api";

import { witlyLog } from "../logger";

let api: Api | undefined;

/** Called once from the module entry point with the injected {@link Api}. */
export function setWitlyApi(injected: Api): void {
    api = injected;
}

/** Access the Element module API. Throws if called before the module loaded. */
export function getWitlyApi(): Api {
    if (!api) throw new Error("Witly module API accessed before load()");
    return api;
}

export function hasWitlyApi(): boolean {
    return api !== undefined;
}

/**
 * Read a `witly.*` config value from Element's config.json via the module API.
 * Returns undefined (and warns) if the API isn't ready or the key is unset.
 * Typed loosely on purpose — config is dynamic and must be validated at runtime.
 */
export function readWitlyConfigValue(key: string): string | undefined {
    if (!api) return undefined;
    try {
        // `config.get` is typed against a declared Config interface; Witly keys
        // are dynamic, so we read through an untyped view and validate here.
        const value = (api.config as unknown as { get(k: string): unknown }).get(key);
        return typeof value === "string" && value.length > 0 ? value : undefined;
    } catch (err) {
        witlyLog.warn(`could not read config "${key}"`, err);
        return undefined;
    }
}

/**
 * Insert a suggestion into the active room composer as an EDITABLE draft.
 *
 * P4 seam. Wraps the `@alpha` `composer.insertPlaintextIntoComposer` hook so an
 * upstream signature change is a single-file fix (stability discipline, see
 * PATCHES.md). Text-only and non-destructive: it inserts at the cursor and
 * NEVER sends — the user always reviews/edits before hitting send.
 *
 * Returns false (and warns) if the API isn't ready or the hook throws, so the
 * caller can surface a soft failure instead of crashing the composer.
 */
export function insertSuggestionIntoComposer(text: string, view: "room" | "thread" = "room"): boolean {
    if (!api) {
        witlyLog.warn("insertSuggestionIntoComposer called before module load");
        return false;
    }
    try {
        api.composer.insertPlaintextIntoComposer(text, { view });
        return true;
    } catch (err) {
        witlyLog.warn("insertSuggestionIntoComposer failed", err);
        return false;
    }
}
