/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * WitLibraryDialog — the standalone Wit Library modal.
 *
 * Two views inside one dialog:
 *   browse  → search + category groups of Wit cards (preset + custom), each with
 *             canned example previews and an add/remove-from-mix toggle.
 *   create  → a form to define a custom Wit (name, emoji, persona, examples).
 *
 * Preset Wits are fetched from GET /wits. The user's mix and custom Wits live in
 * Matrix account data via `witStore` (synced across devices by the homeserver).
 * This surface is designed to be reused later as the Witly panel "Wits" tab and
 * the onboarding "Wit Explorer", so it stays presentational and easy to restyle.
 */

import React, { type JSX, useCallback, useEffect, useMemo, useState } from "react";

import type { DialogProps } from "@element-hq/element-web-module-api";

import { witlyLog } from "../logger";
import { getWits, getAiCatalog, type WitCatalogEntry, type WitExample } from "../services/agchatApi";
import { type CustomWit, witStore } from "./witStore";
import "./wits.pcss";

/** Unified shape the card grid renders, from either a preset or a custom Wit. */
interface WitCard {
    id: string;
    name: string;
    emoji: string;
    blurb: string;
    examples: WitExample[];
    category: string;
    custom: boolean;
}

const CUSTOM_CATEGORY = "Your Wits";

function presetToCard(w: WitCatalogEntry): WitCard {
    return {
        id: w.wit_id,
        name: w.name,
        emoji: w.emoji,
        blurb: w.blurb,
        examples: w.examples ?? [],
        category: w.category || "Wits",
        custom: false,
    };
}

function customToCard(w: CustomWit): WitCard {
    return {
        id: w.id,
        name: w.name,
        emoji: w.emoji || "✨",
        blurb: w.prompt,
        examples: w.examples ?? [],
        category: CUSTOM_CATEGORY,
        custom: true,
    };
}

export function WitLibraryDialog(_props: DialogProps<Record<string, never>>): JSX.Element {
    const [view, setView] = useState<"browse" | "create">("browse");
    const [presets, setPresets] = useState<WitCatalogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [query, setQuery] = useState("");

    // Snapshot of store-derived state; refreshed via subscribe.
    const [customWits, setCustomWits] = useState<CustomWit[]>([]);
    const [mix, setMix] = useState<string[]>([]);
    const [maxMixSize, setMaxMixSize] = useState<number>(witStore.getMaxMixSize());
    const [mixError, setMixError] = useState<string | null>(null);

    useEffect(() => {
        const sync = (): void => {
            setCustomWits(witStore.getCustomWits());
            setMix(witStore.getMix());
            setMaxMixSize(witStore.getMaxMixSize());
        };
        sync();
        return witStore.subscribe(sync);
    }, []);

    // Load the admin-configured mix-size cap from the backend catalog once.
    useEffect(() => {
        void getAiCatalog()
            .then((c) => {
                if (typeof c.max_wit_mix_size === "number") witStore.setMaxMixSize(c.max_wit_mix_size);
            })
            .catch((err) => witlyLog.warn("getAiCatalog (mix cap) failed", err));
    }, []);

    useEffect(() => {
        let active = true;
        setLoading(true);
        void getWits()
            .then((res) => {
                if (active) {
                    setPresets(res.wits);
                    setLoadError(null);
                }
            })
            .catch((err) => {
                witlyLog.warn("getWits failed", err);
                if (active) setLoadError("Couldn't load Wits. Please try again.");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const cards = useMemo<WitCard[]>(() => {
        const all = [...customWits.map(customToCard), ...presets.map(presetToCard)];
        const q = query.trim().toLowerCase();
        if (!q) return all;
        return all.filter(
            (c) => c.name.toLowerCase().includes(q) || c.blurb.toLowerCase().includes(q),
        );
    }, [presets, customWits, query]);

    const grouped = useMemo<[string, WitCard[]][]>(() => {
        const map = new Map<string, WitCard[]>();
        for (const c of cards) {
            const list = map.get(c.category) ?? [];
            list.push(c);
            map.set(c.category, list);
        }
        // "Your Wits" first, then the rest alphabetically.
        return [...map.entries()].sort(([a], [b]) => {
            if (a === CUSTOM_CATEGORY) return -1;
            if (b === CUSTOM_CATEGORY) return 1;
            return a.localeCompare(b);
        });
    }, [cards]);

    const toggleMix = useCallback(async (witId: string, inMix: boolean) => {
        setMixError(null);
        try {
            if (inMix) await witStore.removeFromMix(witId);
            else await witStore.addToMix(witId);
        } catch (err) {
            // addToMix throws when the mix is at the configured cap.
            setMixError(err instanceof Error ? err.message : "Couldn't update your mix.");
            witlyLog.warn("toggleMix failed", err);
        }
    }, []);

    const deleteCustom = useCallback(async (id: string) => {
        try {
            await witStore.deleteCustomWit(id);
        } catch (err) {
            witlyLog.warn("deleteCustomWit failed", err);
        }
    }, []);

    if (view === "create") {
        return (
            <div className="witly_Wits">
                <CreateWitForm
                    onCancel={() => setView("browse")}
                    onSaved={() => setView("browse")}
                />
            </div>
        );
    }

    return (
        <div className="witly_Wits">
            <div className="witly_Wits_toolbar">
                <input
                    type="search"
                    className="witly_Wits_search"
                    placeholder="Search Wits…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search Wits"
                />
                <button
                    type="button"
                    className="witly_Btn witly_Btn--primary witly_Wits_create"
                    onClick={() => setView("create")}
                >
                    Create Wit
                </button>
            </div>

            <p className="witly_Wits_mixNote">
                {mix.length === 0
                    ? "Add Wits to your mix to shape your reply suggestions."
                    : `${mix.length} of ${maxMixSize} Wit${maxMixSize === 1 ? "" : "s"} in your mix.`}
            </p>
            {mixError && <p className="witly_Wits_status witly_Wits_status--error">{mixError}</p>}

            {loading && <p className="witly_Wits_status">Loading Wits…</p>}
            {loadError && !loading && <p className="witly_Wits_status witly_Wits_status--error">{loadError}</p>}
            {!loading && !loadError && cards.length === 0 && (
                <p className="witly_Wits_status">No Wits match "{query}".</p>
            )}

            {grouped.map(([category, list]) => (
                <section key={category} className="witly_Wits_group">
                    <h3 className="witly_Wits_groupTitle">{category}</h3>
                    <ul className="witly_Wits_grid">
                        {list.map((card) => (
                            <WitCardItem
                                key={card.id}
                                card={card}
                                inMix={mix.includes(card.id)}
                                onToggleMix={() => toggleMix(card.id, mix.includes(card.id))}
                                onDelete={card.custom ? () => deleteCustom(card.id) : undefined}
                            />
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}

// ── Wit card ──────────────────────────────────────────────────────────────────

interface WitCardItemProps {
    card: WitCard;
    inMix: boolean;
    onToggleMix: () => void;
    onDelete?: () => void;
}

function WitCardItem({ card, inMix, onToggleMix, onDelete }: WitCardItemProps): JSX.Element {
    const example = card.examples[0];
    return (
        <li className={`witly_WitCard${inMix ? " witly_WitCard--inMix" : ""}`}>
            <div className="witly_WitCard_head">
                <span className="witly_WitCard_emoji" aria-hidden="true">
                    {card.emoji || "💬"}
                </span>
                <div className="witly_WitCard_id">
                    <span className="witly_WitCard_name">{card.name}</span>
                    <span className="witly_WitCard_blurb">{card.blurb}</span>
                </div>
            </div>

            {example && (
                <div className="witly_WitCard_example">
                    {example.incoming && (
                        <span className="witly_WitCard_bubble witly_WitCard_bubble--in">{example.incoming}</span>
                    )}
                    <span className="witly_WitCard_bubble witly_WitCard_bubble--out">{example.reply}</span>
                </div>
            )}

            <div className="witly_WitCard_actions">
                <button
                    type="button"
                    className={`witly_Btn${inMix ? "" : " witly_Btn--primary"} witly_WitCard_toggle`}
                    onClick={onToggleMix}
                >
                    {inMix ? "In your mix ✓" : "Add to mix"}
                </button>
                {onDelete && (
                    <button
                        type="button"
                        className="witly_WitCard_delete"
                        onClick={onDelete}
                        aria-label={`Delete ${card.name}`}
                    >
                        Delete
                    </button>
                )}
            </div>
        </li>
    );
}

// ── Create custom Wit ─────────────────────────────────────────────────────────

interface CreateWitFormProps {
    onCancel: () => void;
    onSaved: () => void;
}

function CreateWitForm({ onCancel, onSaved }: CreateWitFormProps): JSX.Element {
    const [name, setName] = useState("");
    const [emoji, setEmoji] = useState("");
    const [prompt, setPrompt] = useState("");
    const [exampleIn, setExampleIn] = useState("");
    const [exampleReply, setExampleReply] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canSave = name.trim().length > 0 && prompt.trim().length > 0;

    const handleSave = useCallback(async () => {
        if (!canSave) return;
        setSaving(true);
        setError(null);
        const examples =
            exampleReply.trim().length > 0
                ? [{ incoming: exampleIn.trim(), reply: exampleReply.trim() }]
                : undefined;
        const wit: CustomWit = {
            id: `custom-${crypto.randomUUID()}`,
            name: name.trim(),
            emoji: emoji.trim(),
            prompt: prompt.trim(),
            ...(examples ? { examples } : {}),
        };
        try {
            await witStore.saveCustomWit(wit);
            onSaved();
        } catch (err) {
            witlyLog.warn("saveCustomWit failed", err);
            setError("Couldn't save your Wit. Please try again.");
        } finally {
            setSaving(false);
        }
    }, [canSave, name, emoji, prompt, exampleIn, exampleReply, onSaved]);

    return (
        <div className="witly_WitForm">
            <h3 className="witly_WitForm_title">Create a custom Wit</h3>
            <p className="witly_WitForm_hint">
                Describe the persona and Witly will reply in that voice. This Wit stays private to you.
            </p>

            <label className="witly_WitForm_field">
                <span className="witly_WitForm_label">Name</span>
                <input
                    className="witly_WitForm_input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Shakespeare"
                    maxLength={64}
                />
            </label>

            <label className="witly_WitForm_field witly_WitForm_field--emoji">
                <span className="witly_WitForm_label">Emoji</span>
                <input
                    className="witly_WitForm_input"
                    value={emoji}
                    onChange={(e) => setEmoji(e.target.value)}
                    placeholder="🎭"
                    maxLength={4}
                />
            </label>

            <label className="witly_WitForm_field">
                <span className="witly_WitForm_label">Persona</span>
                <textarea
                    className="witly_WitForm_input witly_WitForm_textarea"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Speaks in flowery Elizabethan English, fond of dramatic flourishes."
                    rows={3}
                    maxLength={500}
                />
            </label>

            <div className="witly_WitForm_field">
                <span className="witly_WitForm_label">Example (optional)</span>
                <input
                    className="witly_WitForm_input"
                    value={exampleIn}
                    onChange={(e) => setExampleIn(e.target.value)}
                    placeholder="They wrote: “Running late!”"
                    maxLength={140}
                />
                <input
                    className="witly_WitForm_input"
                    value={exampleReply}
                    onChange={(e) => setExampleReply(e.target.value)}
                    placeholder="Your Wit replies: “Fear not, fair friend…”"
                    maxLength={140}
                />
            </div>

            {error && <p className="witly_Wits_status witly_Wits_status--error">{error}</p>}

            <div className="witly_WitForm_actions">
                <button type="button" className="witly_Btn witly_WitForm_cancel" onClick={onCancel} disabled={saving}>
                    Cancel
                </button>
                <button
                    type="button"
                    className="witly_Btn witly_Btn--primary"
                    onClick={handleSave}
                    disabled={!canSave || saving}
                >
                    {saving ? "Saving…" : "Save Wit"}
                </button>
            </div>
        </div>
    );
}
