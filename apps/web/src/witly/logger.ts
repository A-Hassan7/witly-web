/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Tiny scoped logger for the Witly layer so its output is easy to filter in the
 * console (`[Witly] …`). Kept deliberately minimal — it wraps `console` rather
 * than pulling in Element's logger, so the Witly module stays self-contained.
 */
const PREFIX = "[Witly]";

export const witlyLog = {
    debug: (...args: unknown[]): void => console.debug(PREFIX, ...args),
    info: (...args: unknown[]): void => console.info(PREFIX, ...args),
    warn: (...args: unknown[]): void => console.warn(PREFIX, ...args),
    error: (...args: unknown[]): void => console.error(PREFIX, ...args),
};
