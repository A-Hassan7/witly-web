/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * WitLibraryDialog — thin dialog wrapper around the embeddable {@link WitLibrary}.
 *
 * The Wit Library surface itself lives in `WitLibrary.tsx` so it can be shared
 * between the standalone space-panel launcher (this dialog) and the Witly panel
 * "Wits" tab (P5). This file only adapts it to the Element module `openDialog`
 * contract.
 */

import React, { type JSX } from "react";

import type { DialogProps } from "@element-hq/element-web-module-api";

import { WitLibrary } from "./WitLibrary";

export function WitLibraryDialog(_props: DialogProps<Record<string, never>>): JSX.Element {
    return <WitLibrary />;
}
