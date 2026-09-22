"use client";

import { createContext, ReactNode, useContext } from "react";

const CurrencyContext = createContext("INR");

export function CurrencyProvider({ currency, children }: { currency: string; children: ReactNode }) {
  return <CurrencyContext value={currency}>{children}</CurrencyContext>;
}

export function useCurrencyFormatter() {
  const currencyCode = useContext(CurrencyContext);
  const locale = currencyCode === "INR" ? "en-IN" : "en-US";
  const preciseCurrency = new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    currencyCode,
    currencySymbol: preciseCurrency.formatToParts(0).find((part) => part.type === "currency")?.value ?? currencyCode,
    currency: new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode, minimumFractionDigits: 0, maximumFractionDigits: 0 }),
    preciseCurrency,
  };
}
