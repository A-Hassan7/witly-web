/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { Phase, SetupEncryptionStore } from "../../stores/SetupEncryptionStore";
import { witlyLog } from "../logger";

// Safety net: stop listening if the verification screen never appears, so we
// don't leave a dangling store listener attached after onboarding. This must be
// long enough to outlast provisioning + the first Matrix sync, because the
// verification screen (Phase.Intro) only mounts AFTER the first sync completes
// and the app view leaves LOGIN — which is also when our ProvisioningStep
// unmounts. The skip therefore cannot be tied to that component's lifetime.
const ARM_TIMEOUT_MS = 120_000;

/**
 * Auto-skips Element's post-login device-verification prompt during Witly
 * onboarding (the "Confirm your digital identity" / COMPLETE_SECURITY screen).
 *
 * Element shows this screen after a fresh login when the account already has
 * cross-signing set up (e.g. a returning user on a new browser or after a
 * storage clear). It is optional — Element itself renders a "Skip verification
 * for now" affordance — so for Witly's frictionless onboarding we take that skip
 * automatically and land the user straight in their inbox. Encryption stays
 * enabled; only the interactive device-verification step is deferred. A
 * Witly-branded verification step can replace this later.
 *
 * SEAM: read-only use of Element's `SetupEncryptionStore` public API. No core
 * files are modified. See client/witly-web/PATCHES.md.
 *
 * @returns a disarm function to detach the listener early (e.g. on unmount).
 */
export function armDeviceVerificationSkip(): () => void {
    const store = SetupEncryptionStore.sharedInstance();
    let done = false;
    let timeout = 0;

    const disarm = (): void => {
        if (done) return;
        done = true;
        store.off("update", onUpdate);
        window.clearTimeout(timeout);
    };

    const trySkip = (): void => {
        // Phase.Intro is the interactive "verify this device" prompt. Driving the
        // store skip -> skipConfirm advances it to Finished, which makes
        // SetupEncryptionBody call its onFinished handler and log the user in.
        if (store.phase === Phase.Intro) {
            witlyLog.info("auto-skipping device verification (COMPLETE_SECURITY)");
            store.skip();
            store.skipConfirm();
            disarm();
        }
    };

    const onUpdate = (): void => trySkip();

    store.on("update", onUpdate);
    // The store may already be at Intro if it mounted before we armed.
    trySkip();

    timeout = window.setTimeout(() => {
        witlyLog.debug("device-verification skip disarmed (screen never appeared)");
        disarm();
    }, ARM_TIMEOUT_MS);

    return disarm;
}
