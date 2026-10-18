import { useEffect, useState } from "react";
import { readScenarioLocale } from "./i18n";

export function useScenarioLocale() {
  const [locale, setLocale] = useState(readScenarioLocale);
  useEffect(() => {
    const update = () => setLocale(readScenarioLocale());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    return () => observer.disconnect();
  }, []);
  return locale;
}
