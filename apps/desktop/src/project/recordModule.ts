/** Resolve the durable association first. Recent projects are only a migration source for old records. */
export async function resolveRecordModule(options: {
  stored: { modulePath: string | null } | null;
  legacyPath: string | null;
  isScenario: (path: string) => Promise<boolean>;
  recover: (missingPath: string | null) => Promise<string | null>;
  save: (path: string | null) => Promise<void>;
}): Promise<string | null> {
  const { stored, legacyPath, isScenario, recover, save } = options;
  if (stored?.modulePath === null) return null;
  const path = stored?.modulePath ?? legacyPath;
  if (!stored && path) await save(path);
  if (path && await isScenario(path)) return path;
  const replacement = await recover(path);
  // Keep a missing path so the user can reconnect it next time, even after opening without it.
  if (replacement) await save(replacement);
  return replacement;
}
