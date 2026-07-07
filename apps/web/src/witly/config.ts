/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Witly runtime configuration.
 *
 * The Witly layer needs three things the host Element build doesn't provide:
 *   - the AGChat control-plane API base URL
 *   - the Supabase project URL
 *   - the Supabase anon/publishable key
 *
 * These are read from Element's `config.json` (via the module API's
 * `api.config`) at module load, so deployments configure Witly the same way
 * they configure Element — no rebuild required. `setWitlyConfig()` is called
 * once from the module entry point (`index.ts`); everything else reads the
 * frozen values through the getters below.
 *
 * The config keys are namespaced under `witly.*` in `config.json`:
 *
 *   {
 *     "witly.api_base": "https://api.witly.app",
 *     "witly.supabase_url": "https://xxxx.supabase.co",
 *     "witly.supabase_key": "eyJ..."
 *   }
 */

import { witlyLog } from "./logger";

export interface WitlyConfig {
    /** AGChat control-plane base URL (no trailing slash). */
    apiBase: string;
    /** Supabase project URL. */
    supabaseUrl: string;
    /** Supabase anon/publishable key (public by design; RLS controls access). */
    supabaseKey: string;
}

// Sensible dev default: same-origin `/api` proxy, matching the old web-client.
const DEFAULTS: WitlyConfig = {
    apiBase: "/api",
    supabaseUrl: "",
    supabaseKey: "",
};

let current: WitlyConfig = { ...DEFAULTS };
let configured = false;

/**
 * Populate the Witly config. Called once during module `load()`. Missing keys
 * fall back to defaults and are warned about (Witly features that need them
 * will degrade gracefully rather than crash the host app).
 */
export function setWitlyConfig(partial: Partial<WitlyConfig>): void {
    current = {
        apiBase: partial.apiBase?.replace(/\/$/, "") || DEFAULTS.apiBase,
        supabaseUrl: partial.supabaseUrl?.replace(/\/$/, "") || DEFAULTS.supabaseUrl,
        supabaseKey: partial.supabaseKey || DEFAULTS.supabaseKey,
    };
    configured = true;

    if (!current.supabaseUrl || !current.supabaseKey) {
        witlyLog.warn(
            "Supabase config missing (witly.supabase_url / witly.supabase_key). " +
            "Auth-dependent Witly features will be unavailable until configured.",
        );
    }
}

export function getWitlyConfig(): WitlyConfig {
    if (!configured) {
        witlyLog.warn("getWitlyConfig() called before setWitlyConfig(); using defaults.");
    }
    return current;
}

export const getApiBase = (): string => current.apiBase;
export const getSupabaseUrl = (): string => current.supabaseUrl;
export const getSupabaseKey = (): string => current.supabaseKey;
