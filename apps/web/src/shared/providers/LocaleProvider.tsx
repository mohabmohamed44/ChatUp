'use client';

import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from "react";


export type Locale = 'en' | 'ar';


interface LocaleContextValue {
    locale: Locale;
    dir: 'ltr' | 'rtl';
    setLocale: (locale: Locale) => void;
    toggle: () => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);
const STORAGE_KEY = 'chatup.locale';


export function LocaleProvider({children}: {children:React.ReactNode}) {
    const [locale, setLocaleState] = useState<Locale>('en');
    const [mounted, setMounted] = useState(false);


    useEffect(() => {
        const saved = (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY): null) as Locale | null;
        if (saved === 'ar' || saved === 'en') {
            setLocaleState(saved);
        } else if (typeof navigator !== 'undefined' && navigator.language.startsWith('ar')) {
            setLocaleState('ar');
        }
        setMounted(true);
    }, [])


    // apply to html Element
    useEffect(() => {
        if (!mounted) return;
        const html = document.documentElement;
        const dir = locale === 'ar' ? 'rtl' : 'ltr';
        html.setAttribute('lang', locale);
        html.setAttribute('dir', dir);
        localStorage.setItem(STORAGE_KEY, locale);
    }, [locale, mounted]);

    const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
    const toggle = useCallback(() => setLocaleState((current) =>(current === 'ar' ? 'en' : 'ar')), []);


    const value = useMemo<LocaleContextValue>(
        () => ({
            locale,
            dir: locale === 'ar' ? 'rtl' : 'ltr',
            setLocale,
            toggle,
        }),
        [locale, setLocale, toggle],
    );

    return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
    const ctx = useContext(LocaleContext);
    if (!ctx) throw new Error('useLocale must be used within a LocaleProvider');
    return ctx;
}