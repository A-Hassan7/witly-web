/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Country-code dropdown + national-number field, emitting an E.164 value
 * (e.g. "+447911123456"). Ported dependency-free from the reference web-client
 * (`components/ui/PhoneInput.tsx`) and restyled with Witly/Compound tokens — we
 * deliberately avoid pulling in a phone-input library to keep the Element fork
 * lean (thin-seams constraint).
 */

import React, { type JSX, useEffect, useRef, useState } from "react";

// flag · ISO-3166-1 alpha-2 · name · dial code
const COUNTRIES = [
    { code: "GB", flag: "🇬🇧", name: "United Kingdom", dial: "44" },
    { code: "US", flag: "🇺🇸", name: "United States", dial: "1" },
    { code: "CA", flag: "🇨🇦", name: "Canada", dial: "1" },
    { code: "AU", flag: "🇦🇺", name: "Australia", dial: "61" },
    { code: "DE", flag: "🇩🇪", name: "Germany", dial: "49" },
    { code: "FR", flag: "🇫🇷", name: "France", dial: "33" },
    { code: "IT", flag: "🇮🇹", name: "Italy", dial: "39" },
    { code: "ES", flag: "🇪🇸", name: "Spain", dial: "34" },
    { code: "NL", flag: "🇳🇱", name: "Netherlands", dial: "31" },
    { code: "BE", flag: "🇧🇪", name: "Belgium", dial: "32" },
    { code: "CH", flag: "🇨🇭", name: "Switzerland", dial: "41" },
    { code: "AT", flag: "🇦🇹", name: "Austria", dial: "43" },
    { code: "SE", flag: "🇸🇪", name: "Sweden", dial: "46" },
    { code: "NO", flag: "🇳🇴", name: "Norway", dial: "47" },
    { code: "DK", flag: "🇩🇰", name: "Denmark", dial: "45" },
    { code: "FI", flag: "🇫🇮", name: "Finland", dial: "358" },
    { code: "PL", flag: "🇵🇱", name: "Poland", dial: "48" },
    { code: "PT", flag: "🇵🇹", name: "Portugal", dial: "351" },
    { code: "IE", flag: "🇮🇪", name: "Ireland", dial: "353" },
    { code: "GR", flag: "🇬🇷", name: "Greece", dial: "30" },
    { code: "CZ", flag: "🇨🇿", name: "Czech Republic", dial: "420" },
    { code: "HU", flag: "🇭🇺", name: "Hungary", dial: "36" },
    { code: "RO", flag: "🇷🇴", name: "Romania", dial: "40" },
    { code: "UA", flag: "🇺🇦", name: "Ukraine", dial: "380" },
    { code: "TR", flag: "🇹🇷", name: "Turkey", dial: "90" },
    { code: "RU", flag: "🇷🇺", name: "Russia", dial: "7" },
    { code: "IN", flag: "🇮🇳", name: "India", dial: "91" },
    { code: "PK", flag: "🇵🇰", name: "Pakistan", dial: "92" },
    { code: "BD", flag: "🇧🇩", name: "Bangladesh", dial: "880" },
    { code: "LK", flag: "🇱🇰", name: "Sri Lanka", dial: "94" },
    { code: "CN", flag: "🇨🇳", name: "China", dial: "86" },
    { code: "JP", flag: "🇯🇵", name: "Japan", dial: "81" },
    { code: "KR", flag: "🇰🇷", name: "South Korea", dial: "82" },
    { code: "ID", flag: "🇮🇩", name: "Indonesia", dial: "62" },
    { code: "MY", flag: "🇲🇾", name: "Malaysia", dial: "60" },
    { code: "SG", flag: "🇸🇬", name: "Singapore", dial: "65" },
    { code: "TH", flag: "🇹🇭", name: "Thailand", dial: "66" },
    { code: "PH", flag: "🇵🇭", name: "Philippines", dial: "63" },
    { code: "VN", flag: "🇻🇳", name: "Vietnam", dial: "84" },
    { code: "HK", flag: "🇭🇰", name: "Hong Kong", dial: "852" },
    { code: "TW", flag: "🇹🇼", name: "Taiwan", dial: "886" },
    { code: "AE", flag: "🇦🇪", name: "UAE", dial: "971" },
    { code: "SA", flag: "🇸🇦", name: "Saudi Arabia", dial: "966" },
    { code: "QA", flag: "🇶🇦", name: "Qatar", dial: "974" },
    { code: "KW", flag: "🇰🇼", name: "Kuwait", dial: "965" },
    { code: "BH", flag: "🇧🇭", name: "Bahrain", dial: "973" },
    { code: "OM", flag: "🇴🇲", name: "Oman", dial: "968" },
    { code: "JO", flag: "🇯🇴", name: "Jordan", dial: "962" },
    { code: "EG", flag: "🇪🇬", name: "Egypt", dial: "20" },
    { code: "MA", flag: "🇲🇦", name: "Morocco", dial: "212" },
    { code: "TN", flag: "🇹🇳", name: "Tunisia", dial: "216" },
    { code: "DZ", flag: "🇩🇿", name: "Algeria", dial: "213" },
    { code: "NG", flag: "🇳🇬", name: "Nigeria", dial: "234" },
    { code: "ZA", flag: "🇿🇦", name: "South Africa", dial: "27" },
    { code: "KE", flag: "🇰🇪", name: "Kenya", dial: "254" },
    { code: "GH", flag: "🇬🇭", name: "Ghana", dial: "233" },
    { code: "TZ", flag: "🇹🇿", name: "Tanzania", dial: "255" },
    { code: "ET", flag: "🇪🇹", name: "Ethiopia", dial: "251" },
    { code: "BR", flag: "🇧🇷", name: "Brazil", dial: "55" },
    { code: "MX", flag: "🇲🇽", name: "Mexico", dial: "52" },
    { code: "AR", flag: "🇦🇷", name: "Argentina", dial: "54" },
    { code: "CO", flag: "🇨🇴", name: "Colombia", dial: "57" },
    { code: "CL", flag: "🇨🇱", name: "Chile", dial: "56" },
    { code: "PE", flag: "🇵🇪", name: "Peru", dial: "51" },
    { code: "NZ", flag: "🇳🇿", name: "New Zealand", dial: "64" },
] as const;

export type Country = (typeof COUNTRIES)[number];

interface PhoneInputProps {
    value: string;
    onChange: (value: string) => void;
    onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
    disabled?: boolean;
}

/**
 * Split a full E.164 value (e.g. "+447911123456") back into country + local by
 * matching the longest dial-code prefix.
 */
function parseE164(value: string): { country: Country; local: string } {
    const defaultCountry = COUNTRIES[0]; // GB
    if (!value.startsWith("+")) return { country: defaultCountry, local: value };
    const digits = value.slice(1);
    // Try longest match first (dial codes are up to 4 digits).
    for (let len = 4; len >= 1; len--) {
        const prefix = digits.slice(0, len);
        const matched = COUNTRIES.find((c) => c.dial === prefix);
        if (matched) return { country: matched, local: digits.slice(matched.dial.length) };
    }
    return { country: defaultCountry, local: value };
}

export function PhoneInput({ value, onChange, onKeyDown, disabled }: PhoneInputProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const rootRef = useRef<HTMLDivElement>(null);

    const { country: selected, local } = parseE164(value);

    // Close the dropdown on outside click.
    useEffect(() => {
        if (!open) return;
        const onDocClick = (e: MouseEvent): void => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
                setSearch("");
            }
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [open]);

    const selectCountry = (c: Country): void => {
        setOpen(false);
        setSearch("");
        onChange(`+${c.dial}${local}`);
    };

    const handleLocalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const digits = e.target.value.replace(/\D/g, "");
        onChange(`+${selected.dial}${digits}`);
    };

    const filtered = search
        ? COUNTRIES.filter(
            (c) =>
                c.name.toLowerCase().includes(search.toLowerCase()) ||
                c.dial.includes(search.replace(/\D/g, "")),
        )
        : COUNTRIES;

    return (
        <div className="witly_PhoneInput" ref={rootRef}>
            <button
                type="button"
                className="witly_PhoneInput_country"
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
            >
                <span className="witly_PhoneInput_flag" aria-hidden="true">
                    {selected.flag}
                </span>
                <span className="witly_PhoneInput_dial">+{selected.dial}</span>
                <span className="witly_PhoneInput_caret" aria-hidden="true">
                    ▾
                </span>
            </button>

            <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                className="witly_PhoneInput_number"
                placeholder="Phone number"
                value={local}
                disabled={disabled}
                onChange={handleLocalChange}
                onKeyDown={onKeyDown}
            />

            {open && (
                <div className="witly_PhoneInput_menu" role="listbox">
                    <div className="witly_PhoneInput_search">
                        <input
                            autoFocus
                            type="text"
                            placeholder="Search country or code…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <ul className="witly_PhoneInput_list">
                        {filtered.map((c) => (
                            <li key={c.code}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={c.code === selected.code}
                                    className="witly_PhoneInput_option"
                                    onClick={() => selectCountry(c)}
                                >
                                    <span className="witly_PhoneInput_flag" aria-hidden="true">
                                        {c.flag}
                                    </span>
                                    <span className="witly_PhoneInput_name">{c.name}</span>
                                    <span className="witly_PhoneInput_dial">+{c.dial}</span>
                                </button>
                            </li>
                        ))}
                        {filtered.length === 0 && <li className="witly_PhoneInput_empty">No matches</li>}
                    </ul>
                </div>
            )}
        </div>
    );
}
