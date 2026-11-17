/** Shared selection treatment for the scenario's lists; distinct from hover and drag targets. */
export function rowSelectionClass(selected: boolean) {
  return selected
    ? "bg-blue-200 text-blue-950 shadow-[inset_3px_0_0_#2563eb] dark:bg-blue-900 dark:text-blue-50 dark:shadow-[inset_3px_0_0_#60a5fa]"
    : "hover:bg-muted";
}
