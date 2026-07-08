/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useState } from "react";

import { witlyLog } from "../../logger";
import {
    sendMagicLink,
    sendPhoneOtp,
    signInWithGoogle,
    verifyEmailOtp,
    verifyPhoneOtp,
    type SupabaseSession,
} from "../../services/supabaseAuth";

interface Props {
    onAuthenticated: (session: SupabaseSession) => void;
}

type View = "choose" | "email" | "phone";

/** Google 'G' mark. */
function GoogleIcon(): JSX.Element {
    return (
        <svg className="witly_Btn_gicon" viewBox="0 0 18 18" aria-hidden="true">
            <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
            />
            <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
            />
            <path
                fill="#FBBC05"
                d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
            />
            <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
            />
        </svg>
    );
}

/**
 * Unified auth step. All methods are passwordless, so there is no separate
 * sign-in vs sign-up — the backend creates the account on first use. Google is
 * the primary CTA; email magic-link and phone SMS OTP are secondary.
 */
export function AuthStep({ onAuthenticated }: Props): JSX.Element {
    const [view, setView] = useState<View>("choose");
    const [contact, setContact] = useState("");
    const [code, setCode] = useState("");
    const [codeSent, setCodeSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const redirectTo = window.location.origin + window.location.pathname;

    const reset = (next: View): void => {
        setView(next);
        setContact("");
        setCode("");
        setCodeSent(false);
        setError(null);
    };

    const onGoogle = (): void => {
        setError(null);
        signInWithGoogle(redirectTo);
    };

    const sendCode = async (): Promise<void> => {
        setLoading(true);
        setError(null);
        try {
            if (view === "email") await sendMagicLink(contact, redirectTo);
            else await sendPhoneOtp(contact);
            setCodeSent(true);
        } catch (err) {
            witlyLog.warn("sending code failed", err);
            setError(err instanceof Error ? err.message : "Couldn't send the code. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const verify = async (): Promise<void> => {
        setLoading(true);
        setError(null);
        try {
            const session = view === "email" ? await verifyEmailOtp(contact, code) : await verifyPhoneOtp(contact, code);
            onAuthenticated(session);
        } catch (err) {
            witlyLog.warn("verifying code failed", err);
            setError(err instanceof Error ? err.message : "That code didn't work. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    // ── Method chooser ──────────────────────────────────────────────────────
    if (view === "choose") {
        return (
            <>
                <h1 className="witly_Onboarding_title">Let's get you in</h1>
                <p className="witly_Onboarding_subtitle">No passwords — pick how you'd like to continue.</p>

                <div className="witly_Onboarding_actions">
                    <button type="button" className="witly_Btn witly_Btn--google" onClick={onGoogle}>
                        <GoogleIcon />
                        Continue with Google
                    </button>

                    <div className="witly_Onboarding_divider">or</div>

                    <button type="button" className="witly_Btn witly_Btn--secondary" onClick={() => reset("email")}>
                        Continue with email
                    </button>
                    <button type="button" className="witly_Btn witly_Btn--secondary" onClick={() => reset("phone")}>
                        Continue with phone
                    </button>
                </div>
            </>
        );
    }

    // ── Email / phone OTP ───────────────────────────────────────────────────
    const isEmail = view === "email";
    return (
        <>
            <h1 className="witly_Onboarding_title">{isEmail ? "Continue with email" : "Continue with phone"}</h1>
            <p className="witly_Onboarding_subtitle">
                {codeSent
                    ? `Enter the code we sent to ${contact}.`
                    : isEmail
                        ? "We'll email you a one-time code."
                        : "We'll text you a one-time code."}
            </p>

            {error && <div className="witly_Onboarding_error">{error}</div>}

            {!codeSent ? (
                <>
                    <label className="witly_Field">
                        <span className="witly_Field_label">{isEmail ? "Email address" : "Phone number"}</span>
                        <input
                            className="witly_Input"
                            type={isEmail ? "email" : "tel"}
                            inputMode={isEmail ? "email" : "tel"}
                            placeholder={isEmail ? "you@example.com" : "+1 555 123 4567"}
                            value={contact}
                            onChange={(e) => setContact(e.target.value)}
                            autoFocus
                        />
                    </label>
                    <div className="witly_Onboarding_actions">
                        <button
                            type="button"
                            className="witly_Btn witly_Btn--primary"
                            disabled={loading || contact.trim().length === 0}
                            onClick={sendCode}
                        >
                            {loading ? "Sending…" : "Send code"}
                        </button>
                        <button type="button" className="witly_Onboarding_link" onClick={() => reset("choose")}>
                            ← Back
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <label className="witly_Field">
                        <span className="witly_Field_label">Verification code</span>
                        <input
                            className="witly_Input"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder="123456"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            autoFocus
                        />
                    </label>
                    <div className="witly_Onboarding_actions">
                        <button
                            type="button"
                            className="witly_Btn witly_Btn--primary"
                            disabled={loading || code.trim().length === 0}
                            onClick={verify}
                        >
                            {loading ? "Verifying…" : "Verify & continue"}
                        </button>
                        <button
                            type="button"
                            className="witly_Onboarding_link"
                            disabled={loading}
                            onClick={() => {
                                setCodeSent(false);
                                setCode("");
                                setError(null);
                            }}
                        >
                            Didn't get it? Try again
                        </button>
                    </div>
                </>
            )}
        </>
    );
}
