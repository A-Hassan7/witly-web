/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * WitlyUserSettingsTab — the Witly account section shown at the top of
 * Element's native User Settings dialog (P6).
 *
 * Mounted via the core seam in `UserSettingsDialog.tsx` (PATCHES.md #5). The
 * component is prop-less and self-contained, matching Element's settings-tab
 * contract (each tab body is a pre-rendered, prop-free element).
 *
 * Sections:
 *   • Profile      — Matrix display name + avatar (editable), Supabase
 *                    email/phone (read-only), and Element sign-out.
 *   • Plan         — stubbed "Free trial" card + disabled Upgrade CTA.
 *   • Credits      — remaining/allocated usage bar + reset period.
 *   • Platforms    — connected chat apps; "Manage" reuses the connect wizard.
 *   • Danger zone  — delete account (type-to-confirm → DELETE /account).
 *
 * All Matrix writes + sign-out go through the quarantined `element/profile.ts`
 * seam; all control-plane calls go through `services/agchatApi.ts`.
 */

import React, { type JSX, useCallback, useEffect, useRef, useState } from "react";

import { witlyLog } from "../logger";
import { witlySession } from "../services/session";
import { getCurrentUser } from "../services/supabaseAuth";
import {
    getAiCredits,
    getAllBridges,
    deleteAccount as apiDeleteAccount,
    type AiCreditsResponse,
    type BridgeService,
} from "../services/agchatApi";
import {
    getMatrixProfile,
    setMatrixDisplayName,
    setMatrixAvatarFromFile,
    signOut,
} from "../element/profile";
import { openConnectDialog, WITLY_CONNECT_CHANGED } from "../element/registerConnect";
import { PLATFORMS } from "../connect/platforms";
import "./account.pcss";

function platformName(service: BridgeService): string {
    return PLATFORMS.find((p) => p.service === service)?.name ?? service;
}

function ProfileSection(): JSX.Element {
    const initial = getMatrixProfile();
    const [displayName, setDisplayName] = useState<string>(initial?.displayName ?? "");
    const [savedName, setSavedName] = useState<string>(initial?.displayName ?? "");
    const [avatarUrl, setAvatarUrl] = useState<string | null>(initial?.avatarUrl ?? null);
    const [email, setEmail] = useState<string | null>(witlySession.get()?.email ?? null);
    const [phone, setPhone] = useState<string | null>(null);
    const [savingName, setSavingName] = useState(false);
    const [savingAvatar, setSavingAvatar] = useState(false);
    const [signingOut, setSigningOut] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Enrich email/phone from Supabase (read-only display).
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const token = await witlySession.getValidToken();
                const user = await getCurrentUser(token);
                if (cancelled) return;
                if (user.email) setEmail(user.email);
                if (user.phone) setPhone(user.phone);
            } catch (err) {
                witlyLog.warn("account: could not load Supabase profile", err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const saveName = useCallback(async () => {
        const trimmed = displayName.trim();
        if (!trimmed || trimmed === savedName) return;
        setSavingName(true);
        try {
            await setMatrixDisplayName(trimmed);
            setSavedName(trimmed);
        } catch (err) {
            witlyLog.warn("account: setDisplayName failed", err);
            setDisplayName(savedName); // revert
        } finally {
            setSavingName(false);
        }
    }, [displayName, savedName]);

    const onPickAvatar = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ""; // allow re-picking the same file
        if (!file) return;
        setSavingAvatar(true);
        try {
            const url = await setMatrixAvatarFromFile(file);
            if (url) setAvatarUrl(url);
        } catch (err) {
            witlyLog.warn("account: setAvatar failed", err);
        } finally {
            setSavingAvatar(false);
        }
    }, []);

    const doSignOut = useCallback(async () => {
        setSigningOut(true);
        try {
            await signOut();
        } catch (err) {
            witlyLog.warn("account: sign out failed", err);
            setSigningOut(false);
        }
    }, []);

    return (
        <section className="witly_Account_section">
            <h3 className="witly_Account_title">Profile</h3>
            <div className="witly_Account_profile">
                <button
                    type="button"
                    className="witly_Account_avatarBtn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={savingAvatar}
                    aria-label="Change profile photo"
                    title="Change profile photo"
                >
                    {avatarUrl ? (
                        <img className="witly_Account_avatar" src={avatarUrl} alt="" />
                    ) : (
                        <span className="witly_Account_avatar witly_Account_avatar--empty">
                            {(savedName || "?").charAt(0).toUpperCase()}
                        </span>
                    )}
                    <span className="witly_Account_avatarEdit">{savingAvatar ? "…" : "Edit"}</span>
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="witly_Account_fileInput"
                    onChange={(e) => void onPickAvatar(e)}
                />
                <div className="witly_Account_profileFields">
                    <label className="witly_Account_label" htmlFor="witly_display_name">
                        Display name
                    </label>
                    <div className="witly_Account_nameRow">
                        <input
                            id="witly_display_name"
                            className="witly_Account_input"
                            type="text"
                            value={displayName}
                            maxLength={200}
                            onChange={(e) => setDisplayName(e.target.value)}
                            onBlur={() => void saveName()}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") void saveName();
                            }}
                        />
                        {displayName.trim() !== savedName && (
                            <button
                                type="button"
                                className="witly_Btn witly_Btn--primary"
                                onClick={() => void saveName()}
                                disabled={savingName || !displayName.trim()}
                            >
                                {savingName ? "Saving…" : "Save"}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <dl className="witly_Account_readonly">
                <div className="witly_Account_readonlyRow">
                    <dt>Email</dt>
                    <dd>{email ?? "—"}</dd>
                </div>
                {phone && (
                    <div className="witly_Account_readonlyRow">
                        <dt>Phone</dt>
                        <dd>{phone}</dd>
                    </div>
                )}
            </dl>

            <button
                type="button"
                className="witly_Btn witly_Account_signout"
                onClick={() => void doSignOut()}
                disabled={signingOut}
            >
                {signingOut ? "Signing out…" : "Sign out"}
            </button>
        </section>
    );
}

function PlanSection(): JSX.Element {
    return (
        <section className="witly_Account_section">
            <h3 className="witly_Account_title">Plan</h3>
            <div className="witly_Account_plan">
                <div className="witly_Account_planInfo">
                    <span className="witly_Account_planName">Free trial</span>
                    <span className="witly_Account_planHint">You&rsquo;re on the free trial. Paid plans are coming soon.</span>
                </div>
                <button type="button" className="witly_Btn witly_Btn--primary" disabled title="Coming soon">
                    Upgrade
                </button>
            </div>
        </section>
    );
}

function CreditsSection(): JSX.Element {
    const [credits, setCredits] = useState<AiCreditsResponse | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await getAiCredits();
                if (!cancelled) setCredits(res);
            } catch (err) {
                witlyLog.warn("account: could not load credits", err);
                if (!cancelled) setError(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    let body: JSX.Element;
    if (error) {
        body = <p className="witly_Account_hint">Couldn&rsquo;t load your usage right now.</p>;
    } else if (!credits) {
        body = <p className="witly_Account_hint">Loading…</p>;
    } else {
        const allocated = credits.tokens_allocated || 0;
        const used = credits.tokens_used || 0;
        const remaining = Math.max(0, credits.tokens_remaining);
        const pct = allocated > 0 ? Math.min(100, Math.round((used / allocated) * 100)) : 0;
        const periodLabel = credits.reset_period === "monthly" ? "month" : "day";
        body = (
            <>
                <div className="witly_Account_meter" role="img" aria-label={`${pct}% of credits used`}>
                    <div className="witly_Account_meterFill" style={{ width: `${pct}%` }} />
                </div>
                <p className="witly_Account_hint">
                    {remaining.toLocaleString()} of {allocated.toLocaleString()} credits left this {periodLabel}.
                </p>
            </>
        );
    }

    return (
        <section className="witly_Account_section">
            <h3 className="witly_Account_title">AI credits</h3>
            {body}
        </section>
    );
}

function PlatformsSection(): JSX.Element {
    const [connected, setConnected] = useState<BridgeService[]>([]);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        try {
            const bridges = await getAllBridges();
            setConnected(bridges.filter((b) => b.login_status === "CONNECTED").map((b) => b.service));
        } catch (err) {
            witlyLog.warn("account: could not load connected platforms", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
        const onChanged = (): void => void refresh();
        window.addEventListener(WITLY_CONNECT_CHANGED, onChanged);
        return () => window.removeEventListener(WITLY_CONNECT_CHANGED, onChanged);
    }, [refresh]);

    return (
        <section className="witly_Account_section">
            <div className="witly_Account_sectionHead">
                <h3 className="witly_Account_title">Connected apps</h3>
                <button type="button" className="witly_Btn" onClick={openConnectDialog}>
                    Manage
                </button>
            </div>
            {loading ? (
                <p className="witly_Account_hint">Loading…</p>
            ) : connected.length === 0 ? (
                <p className="witly_Account_hint">No chat apps connected yet.</p>
            ) : (
                <ul className="witly_Account_platforms">
                    {connected.map((service) => (
                        <li key={service} className="witly_Account_platform">
                            <span className="witly_Account_platformName">{platformName(service)}</span>
                            <span className="witly_Account_platformStatus">Connected</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function DangerSection(): JSX.Element {
    const [confirming, setConfirming] = useState(false);
    const [confirmText, setConfirmText] = useState("");
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const doDelete = useCallback(async () => {
        if (confirmText !== "DELETE") return;
        setDeleting(true);
        setError(null);
        try {
            await apiDeleteAccount("DELETE");
            // Account + infra gone; sign out of Element to land back at welcome.
            await signOut();
        } catch (err) {
            witlyLog.warn("account: delete failed", err);
            setError("Couldn't delete your account. Please try again.");
            setDeleting(false);
        }
    }, [confirmText]);

    return (
        <section className="witly_Account_section witly_Account_danger">
            <h3 className="witly_Account_title">Delete account</h3>
            <p className="witly_Account_hint">
                Permanently deletes your account, messages, and connected apps. This cannot be undone.
            </p>
            {!confirming ? (
                <button
                    type="button"
                    className="witly_Btn witly_Btn--danger"
                    onClick={() => setConfirming(true)}
                >
                    Delete my account
                </button>
            ) : (
                <div className="witly_Account_confirm">
                    <label className="witly_Account_label" htmlFor="witly_delete_confirm">
                        Type <strong>DELETE</strong> to confirm
                    </label>
                    <input
                        id="witly_delete_confirm"
                        className="witly_Account_input"
                        type="text"
                        value={confirmText}
                        autoComplete="off"
                        onChange={(e) => setConfirmText(e.target.value)}
                        disabled={deleting}
                    />
                    {error && <p className="witly_Account_error">{error}</p>}
                    <div className="witly_Account_confirmActions">
                        <button
                            type="button"
                            className="witly_Btn"
                            onClick={() => {
                                setConfirming(false);
                                setConfirmText("");
                                setError(null);
                            }}
                            disabled={deleting}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="witly_Btn witly_Btn--danger"
                            onClick={() => void doDelete()}
                            disabled={deleting || confirmText !== "DELETE"}
                        >
                            {deleting ? "Deleting…" : "Delete account"}
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}

export default function WitlyUserSettingsTab(): JSX.Element {
    return (
        <div className="witly_Account">
            <ProfileSection />
            <PlanSection />
            <CreditsSection />
            <PlatformsSection />
            <DangerSection />
        </div>
    );
}
