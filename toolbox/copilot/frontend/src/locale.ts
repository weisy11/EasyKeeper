import { useEffect, useState } from "react";
import { readCopilotLocale } from "./i18n";

export function useCopilotLocale() {
  const [locale, setLocale] = useState(readCopilotLocale);
  useEffect(() => {
    const update = () => setLocale(readCopilotLocale());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    return () => observer.disconnect();
  }, []);
  return locale;
}
