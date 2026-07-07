/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Witly module entry point.
 *
 * This is the default export loaded by Element Web's plugin `ModuleLoader`
 * (see the one documented seam in `apps/web/src/vector/init.tsx`, tracked in
 * `PATCHES.md`). It implements the `@element-hq/element-web-module-api` module
 * contract: a class with a static `moduleApiVersion` and an async `load()`.
 *
 * P0 scope: bootstrap only — capture the module API, load runtime config, and
 * pull in the brand-token layer. The onboarding login component (P1), the
 * room-header Witly button (P4) and the suggestion/panel surfaces are
 * registered from here in their respective phases, each via the thin adapters
 * in `element/moduleApi.ts`.
 */

import type { Api, Module, ModuleFactory } from "@element-hq/element-web-module-api";

// Pull the Witly brand-token layer into the bundle. Defines `--witly-*` custom
// properties (light + dark) on top of Compound; imported here so it always
// loads with the module.
import "./brand/witly-tokens.pcss";

import { witlyLog } from "./logger";
import { setWitlyConfig } from "./config";
import { readWitlyConfigValue, setWitlyApi } from "./element/moduleApi";

class WitlyModule implements Module {
    /**
     * Semver range of the module API this module is built against. `^1.14.0`
     * accepts forward 1.x minor bumps (which is where new/@alpha hooks land)
     * but refuses a breaking 2.0 — a deliberate safety signal that forces us to
     * review a major upstream change before it silently ships.
     */
    public static readonly moduleApiVersion = "^1.14.0";

    public constructor(private readonly api: Api) {
        setWitlyApi(api);
    }

    public async load(): Promise<void> {
        witlyLog.info("loading Witly module…");

        setWitlyConfig({
            apiBase: readWitlyConfigValue("witly.api_base"),
            supabaseUrl: readWitlyConfigValue("witly.supabase_url"),
            supabaseKey: readWitlyConfigValue("witly.supabase_key"),
        });

        witlyLog.info("Witly module loaded");
    }
}

export default WitlyModule satisfies ModuleFactory;
