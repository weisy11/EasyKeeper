import { useEffect, useState } from "react";
import { readCharacterLocale } from "./i18n";

export function useCharacterLocale() {
  const [locale, setLocale] = useState(readCharacterLocale);
  useEffect(() => {
    const update = () => setLocale(readCharacterLocale());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    return () => observer.disconnect();
  }, []);
  return locale;
}
