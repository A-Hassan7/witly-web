/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Adapter for the `@alpha` `customComponents.registerLoginComponent` hook.
 *
 * This is the ONLY place we call that hook. If its signature changes in a
 * future Element release, this single file is the fix (see PATCHES.md stability
 * notes). It swaps Element's login form for the Witly onboarding wizard and
 * feeds the resolved Matrix credentials back through the provided `onLoggedIn`.
 */

import React from "react";

import { witlyLog } from "../logger";
import { captureAuthRedirect } from "../onboarding/authRedirect";
import { OnboardingFlow } from "../onboarding/OnboardingFlow";
import { getWitlyApi } from "./moduleApi";

export function registerWitlyOnboarding(): void {
    // Capture OAuth / magic-link redirect tokens from the URL fragment now,
    // before Element's hash router reacts to them.
    captureAuthRedirect();

    const api = getWitlyApi();
    api.customComponents.registerLoginComponent((props) => <OnboardingFlow onLoggedIn={props.onLoggedIn} />);

    witlyLog.info("onboarding login component registered");
}
