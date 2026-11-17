import { useEffect, useRef, useState } from "react";
import { settingsStore, useStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { isTauri } from "@/lib/platform";
import "./welcome.css";
import {
  ProjectError,
  createProject,
  documentsDir,
  joinPath,
  nextNumberedName,
  openProject,
  readRecordModule,
  saveRecordModule,
  pathExists,
  pickParentDirectory,
  samePath,
  splitProjectPath,
  validFolderName,
} from "./fs";
import { requestPrepDefaultLayout } from "@/layout";
import { rememberSession } from "./launchSession";
import { forgetProject, migrateLegacyRecent, rememberProject, recentStore } from "./recent";
import { sessionStore } from "./sessionStore";
import type { ProjectKind, RecentProject } from "./types";
import { resolveRecordModule } from "./recordModule";
import { closeOpenProject } from "./closeProject";
import { projectActionStore } from "../shell/projectActions";

type Roots = { docs: string; library: string; home: string | null };

type View =
  | { name: "home" }
  | { name: "create-scenario" }
  | { name: "create-record"; modulePath: string | null };

async function enterProject(path: string, name: string, kind: ProjectKind, modulePath: string | null) {
  if (sessionStore.get()) await closeOpenProject();
  const session = {
    mode: kind === "scenario" ? "prep" : "play",
    projectPath: path,
    name,
    kind,
    modulePath,
    moduleEditable: kind === "scenario",
  } as const;
  sessionStore.set(session);
  void rememberSession(session);
  rememberProject({ path, name, kind, modulePath });
  projectActionStore.set(null);
}

function displayPath(path: string, home: string | null) {
  if (!home) return path;
  if (path === home) return "~";
  const slash = path.startsWith(`${home}/`) || path.startsWith(`${home}\\`);
  return slash ? `~${path.slice(home.length)}` : path;
}

function formatOpened(ts: number) {
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDisplay(value: string, home: string | null) {
  if (home && (value === "~" || value.startsWith("~/") || value.startsWith("~\\"))) return home + value.slice(1);
  return value;
}

function childDisplay(parent: string, name: string, home: string | null) {
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return displayPath(`${parent.replace(/[\\/]+$/, "")}${sep}${name.trim()}`, home);
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cccccc" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

const PLUS = "M12 5v14M5 12h14";
const PENCIL = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z";
const BOOK = "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z";
const HISTORY = "M3 12a9 9 0 1 0 2.5-6.2M3 4v5h5";

export function WelcomePage() {
  const tr = useT();
  const { locale } = useStore(settingsStore);
  const recent = useStore(recentStore);
  const menuAction = useStore(projectActionStore);
  const [roots, setRoots] = useState<Roots | null>(null);
  const [rootsError, setRootsError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: "home" });
  const [projectName, setProjectName] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [homeError, setHomeError] = useState<{ kind: ProjectKind; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [directoryPrompt, setDirectoryPrompt] = useState<{ title: string; value: string } | null>(null);
  const directoryResolver = useRef<((path: string | null) => void) | null>(null);
  const [missingModule, setMissingModule] = useState<{ path: string | null; error: string | null; choosing: boolean } | null>(null);
  const moduleResolver = useRef<((path: string | null) => void) | null>(null);
  const creationRequest = useRef(0);
  const creationEdited = useRef(false);

  useEffect(() => () => {
    directoryResolver.current?.(null);
    directoryResolver.current = null;
    moduleResolver.current?.(null);
    moduleResolver.current = null;
    creationRequest.current += 1;
  }, []);

  useEffect(() => {
    void migrateLegacyRecent();
  }, []);

  useEffect(() => {
    if (!roots || !menuAction || menuAction.started) return;
    projectActionStore.set({ ...menuAction, started: true });
    if (menuAction.id === "create-scenario") void startCreate("scenario", null);
    else if (menuAction.id === "create-record") void startPicker("pick-scenario");
    else if (menuAction.id === "open-scenario") void startPicker("edit-scenario");
    else if (menuAction.id === "open-record") void startPicker("pick-record");
    else if (menuAction.path && menuAction.kind) void acceptFolder(menuAction.path, menuAction.kind, true);
    // The native menu supplies one action; editing the resulting form must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, menuAction]);

  useEffect(() => {
    let cancelled = false;
    documentsDir()
      .then(async (docs) => {
        const library = await joinPath(docs, "EasyKeeper");
        return { docs, library, home: splitProjectPath(docs)?.parent ?? null };
      })
      .then((next) => {
        if (!cancelled) {
          setRoots(next);
          setRootsError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setRoots(null);
          const text = caught instanceof Error ? caught.message : String(caught);
          setRootsError(text);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function message(caught: unknown, expected: ProjectKind) {
    if (caught instanceof ProjectError) {
      if (caught.code === "exists") return tr("welcome.error.exists");
      if (caught.code === "invalid-name") return tr("welcome.error.invalidName");
      if (caught.code === "missing-parent") return tr("welcome.error.missingParent");
      if (caught.code === "missing-dir") return tr("welcome.error.missingDir");
      if (caught.code === "wrong-kind") {
        return tr(expected === "scenario" ? "welcome.error.scenarioIsRecord" : "welcome.error.recordIsScenario");
      }
      if (caught.code === "not-project") {
        return tr(expected === "scenario" ? "welcome.error.notScenario" : "welcome.error.notRecord");
      }
      return tr("welcome.error.generic", { message: caught.message });
    }
    return tr("welcome.error.generic", { message: caught instanceof Error ? caught.message : String(caught) });
  }

  function goHome() {
    creationRequest.current += 1;
    projectActionStore.set(null);
    setError(null);
    setHomeError(null);
    setView({ name: "home" });
  }

  async function startCreate(kind: "scenario" | "record", modulePath: string | null) {
    if (!roots) return;
    const request = ++creationRequest.current;
    creationEdited.current = false;
    setError(null);
    setHomeError(null);
    const prefix = kind === "scenario" ? "scenario" : "record";
    setProjectName(`${prefix}1`);
    setParent(roots.library);
    setView(kind === "scenario" ? { name: "create-scenario" } : { name: "create-record", modulePath });
    // Network/cloud-backed Documents folders can stall while listing. Suggestions must not block the form.
    void nextNumberedName(roots.library, prefix).then((name) => {
      if (creationRequest.current === request && !creationEdited.current) setProjectName(name);
    }).catch(() => undefined);
  }

  async function chooseDirectory(current: string, title: string): Promise<string | null> {
    if (isTauri) return pickParentDirectory(current, title);
    return new Promise((resolve) => {
      directoryResolver.current = resolve;
      setDirectoryPrompt({ title, value: current });
    });
  }

  function finishDirectoryPrompt(path: string | null) {
    const resolve = directoryResolver.current;
    directoryResolver.current = null;
    setDirectoryPrompt(null);
    resolve?.(path?.trim() || null);
  }

  async function startPicker(action: "edit-scenario" | "pick-scenario" | "pick-record") {
    if (!roots || busy) return;
    const expected: ProjectKind = action === "pick-record" ? "gameRecord" : "scenario";
    setError(null);
    setHomeError(null);
    setBusy(true);
    try {
      const libraryReady = await pathExists(roots.library);
      const title = tr(expected === "scenario" ? "welcome.selectScenario" : "welcome.selectRecord");
      const path = await chooseDirectory(libraryReady ? roots.library : roots.docs, title);
      if (!path) { projectActionStore.set(null); return; }
      if (action === "pick-scenario") {
        await openProject(path, "scenario");
        await startCreate("record", path);
      } else {
        await acceptFolder(path, expected);
      }
    } catch (caught) {
      setError(message(caught, expected));
    } finally {
      setBusy(false);
    }
  }

  async function browseParent() {
    setBusy(true);
    try {
      const picked = await chooseDirectory(parent, tr("welcome.browse"));
      if (picked) {
        creationEdited.current = true;
        setError(null);
        setParent(picked);
      }
    } catch (caught) {
      setError(message(caught, view.name === "create-record" ? "gameRecord" : "scenario"));
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate() {
    if (view.name !== "create-scenario" && view.name !== "create-record") return;
    const kind: ProjectKind = view.name === "create-scenario" ? "scenario" : "gameRecord";
    if (!validFolderName(projectName) || !parent.trim()) {
      setError(tr("welcome.error.invalidName"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createProject({
        name: projectName,
        parent: parent.trim(),
        kind,
        modulePath: view.name === "create-record" ? view.modulePath : null,
        createParent: roots != null && samePath(parent.trim(), roots.library),
      });
      const modulePath = view.name === "create-record" ? view.modulePath : null;
      if (kind === "scenario") requestPrepDefaultLayout();
      await enterProject(created.path, created.name, kind, modulePath);
    } catch (caught) {
      setError(message(caught, kind));
    } finally {
      setBusy(false);
    }
  }

  async function acceptFolder(path: string, expected: ProjectKind, fromRecent = false) {
    setBusy(true);
    try {
      const opened = await openProject(path, expected);
      const recentHit = recent.recentRecords.find((item) => item.path === path);
      const modulePath = expected === "gameRecord" ? await resolveRecordModule({
        stored: await readRecordModule(path),
        legacyPath: recentHit?.modulePath ?? null,
        isScenario: async (candidate) => {
          try { await openProject(candidate, "scenario"); return true; }
          catch { return false; }
        },
        recover: (missingPath) => new Promise((resolve) => {
          moduleResolver.current = resolve;
          setMissingModule({ path: missingPath, error: null, choosing: false });
        }),
        save: (candidate) => saveRecordModule(path, candidate),
      }) : null;
      await enterProject(path, opened.name, expected, modulePath);
    } catch (caught) {
      const text = message(caught, expected);
      if (fromRecent) setHomeError({ kind: expected, text });
      else setError(text);
    } finally {
      setBusy(false);
    }
  }

  async function openRecent(item: RecentProject) {
    setError(null);
    setHomeError(null);
    await acceptFolder(item.path, item.kind, true);
  }

  function finishModuleRecovery(path: string | null) {
    const resolve = moduleResolver.current;
    moduleResolver.current = null;
    setMissingModule(null);
    resolve?.(path);
  }

  async function chooseMissingModule() {
    if (!missingModule || missingModule.choosing) return;
    setMissingModule({ ...missingModule, choosing: true, error: null });
    try {
      const picked = await chooseDirectory(roots?.library ?? "", tr("welcome.selectScenario"));
      if (picked) {
        await openProject(picked, "scenario");
        finishModuleRecovery(picked);
        return;
      }
      setMissingModule((current) => current && { ...current, choosing: false });
    } catch (caught) {
      setMissingModule((current) => current && { ...current, choosing: false, error: message(caught, "scenario") });
    }
  }

  const shown = (path: string) => displayPath(path, roots?.home ?? null);

  function removeRecent(item: RecentProject) {
    forgetProject(item.kind, item.path);
    setHomeError(null);
  }

  return (
    <div className="ek-welcome" data-welcome data-view={view.name}>
      <div className={view.name === "home" ? "page" : "page sub"}>
        <div className="top">
          <h1>EasyKeeper</h1>
          {menuAction && sessionStore.get() && view.name === "home" && <button type="button" className="lang" disabled={busy} onClick={goHome}>{tr("welcome.backToProject")}</button>}
          <button
            type="button"
            className="lang"
            data-lang
            onClick={() => settingsStore.set((s) => ({ ...s, locale: s.locale === "zh" ? "en" : "zh" }))}
          >
            {locale === "zh" ? "EN" : "中"}
          </button>
        </div>

        {view.name === "home" && (
          <div className="split">
            <div>
              <RecentBlock
                title={tr("welcome.editScenario")}
                items={recent.recentScenario}
                showWhen={false}
                error={homeError?.kind === "scenario" ? homeError.text : null}
                shown={shown}
                busy={busy}
                removeLabel={tr("welcome.removeRecent")}
                onOpen={(item) => void openRecent(item)}
                onRemove={removeRecent}
              />
              <RecentBlock
                title={tr("welcome.continueGame")}
                items={recent.recentRecords}
                showWhen
                error={homeError?.kind === "gameRecord" ? homeError.text : null}
                shown={shown}
                busy={busy}
                removeLabel={tr("welcome.removeRecent")}
                onOpen={(item) => void openRecent(item)}
                onRemove={removeRecent}
              />
            </div>
            <div className="actions">
              <h2>{tr("welcome.start")}</h2>
              <Action icon={PLUS} title={tr("welcome.createScenario")} hint={tr("welcome.createScenarioHint")} testId="create-scenario" disabled={busy || !roots} onClick={() => void startCreate("scenario", null)} />
              <Action icon={PENCIL} title={tr("welcome.editScenario")} hint={tr("welcome.editScenarioHint")} testId="edit-scenario" disabled={busy || !roots} onClick={() => void startPicker("edit-scenario")} />
              <Action icon={BOOK} title={tr("welcome.runWithScenario")} hint={tr("welcome.runWithScenarioHint")} testId="run-with-scenario" disabled={busy || !roots} onClick={() => void startPicker("pick-scenario")} />
              <Action icon={HISTORY} title={tr("welcome.continueGame")} hint={tr("welcome.continueGameHint")} testId="continue-game" disabled={busy || !roots} onClick={() => void startPicker("pick-record")} />
              {error && <p className="err" role="alert" data-welcome-error>{error}</p>}
              {rootsError && <p className="err" data-welcome-error>{tr("welcome.error.generic", { message: rootsError })}</p>}
            </div>
          </div>
        )}

        {(view.name === "create-scenario" || view.name === "create-record") && (
          <form
            className="create"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCreate();
            }}
          >
            <h2>{tr(view.name === "create-scenario" ? "welcome.createScenario" : "welcome.newRecord")}</h2>
            <div className="field">
              <label htmlFor="project-name">{tr("welcome.name")}</label>
              <input id="project-name" value={projectName} spellCheck={false} data-project-name onChange={(event) => { creationEdited.current = true; setProjectName(event.target.value); }} />
            </div>
            <div className="field">
              <label htmlFor="project-parent">{tr("welcome.location")}</label>
              <div className="loc">
                <input
                  id="project-parent"
                  value={shown(parent)}
                  spellCheck={false}
                  data-project-parent={parent}
                  onChange={(event) => { creationEdited.current = true; setParent(fromDisplay(event.target.value, roots?.home ?? null)); }}
                />
                <button type="button" className="iconbtn" aria-label={tr("welcome.browse")} disabled={busy} onClick={() => void browseParent()}>
                  <FolderGlyph />
                </button>
              </div>
              {validFolderName(projectName) && parent.trim() && (
                <p className="hint">{tr("welcome.willCreate", { path: childDisplay(parent, projectName, roots?.home ?? null) })}</p>
              )}
              {error && <p className="err" data-welcome-error>{error}</p>}
            </div>
            <div className="foot">
              <button type="button" className="btn cancel" disabled={busy} onClick={goHome}>
                {tr("welcome.cancel")}
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {tr("welcome.create")}
              </button>
            </div>
          </form>
        )}
      </div>
      {missingModule && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-6">
          <div role="dialog" aria-modal="true" aria-labelledby="missing-module-title" className="w-full max-w-lg rounded-md border border-border bg-background p-4 shadow-lg">
            <h2 id="missing-module-title">{tr("welcome.moduleMissing")}</h2>
            <p className="mt-2 text-sm">{tr("welcome.moduleMissingHint")}</p>
            {missingModule.path && <p className="mt-2 break-all text-sm text-muted-foreground">{missingModule.path}</p>}
            {missingModule.error && <p role="alert" className="err">{missingModule.error}</p>}
            <div className="foot">
              <button type="button" className="btn cancel" disabled={missingModule.choosing} onClick={() => finishModuleRecovery(null)}>{tr("welcome.openRecordOnly")}</button>
              <button type="button" className="btn primary" disabled={missingModule.choosing} onClick={() => void chooseMissingModule()}>{tr("welcome.selectScenario")}</button>
            </div>
          </div>
        </div>
      )}
      {directoryPrompt && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="directory-prompt-title"
            className="w-full max-w-lg rounded-md border border-border bg-background p-4 shadow-lg"
            onSubmit={(event) => {
              event.preventDefault();
              finishDirectoryPrompt(directoryPrompt.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                finishDirectoryPrompt(null);
              }
            }}
          >
            <h2 id="directory-prompt-title">{directoryPrompt.title}</h2>
            <p className="mb-3 text-sm text-muted-foreground">{tr("welcome.browserDirectoryHint")}</p>
            <label htmlFor="directory-prompt-path">{tr("welcome.location")}</label>
            <input
              id="directory-prompt-path"
              autoFocus
              spellCheck={false}
              value={directoryPrompt.value}
              onChange={(event) => setDirectoryPrompt({ ...directoryPrompt, value: event.target.value })}
            />
            <div className="foot">
              <button type="button" className="btn cancel" onClick={() => finishDirectoryPrompt(null)}>{tr("welcome.cancel")}</button>
              <button type="submit" className="btn primary" disabled={!directoryPrompt.value.trim()}>{tr("welcome.open")}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function RecentBlock({
  title,
  items,
  showWhen,
  error,
  shown,
  busy,
  removeLabel,
  onOpen,
  onRemove,
}: {
  title: string;
  items: RecentProject[];
  showWhen: boolean;
  error: string | null;
  shown: (path: string) => string;
  busy: boolean;
  removeLabel: string;
  onOpen: (item: RecentProject) => void;
  onRemove: (item: RecentProject) => void;
}) {
  return (
    <section className="block">
      <h2>{title}</h2>
      <ul className="recent-list">
        {items.map((item) => (
          <li key={item.path} className="recent">
            <button type="button" className="item" disabled={busy} data-recent={item.kind} onClick={() => onOpen(item)}>
              <span className="name">
                {item.name}
                {showWhen && <span className="when">{formatOpened(item.openedAt)}</span>}
              </span>
              <span className="path">{shown(item.path)}</span>
            </button>
            <button
              type="button"
              className="remove"
              disabled={busy}
              aria-label={removeLabel}
              data-remove-recent={item.path}
              onClick={() => onRemove(item)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="err" data-welcome-error>{error}</p>}
    </section>
  );
}

function Action({
  icon,
  title,
  hint,
  testId,
  disabled,
  onClick,
}: {
  icon: string;
  title: string;
  hint: string;
  testId: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="act" data-action={testId} disabled={disabled} onClick={onClick}>
      <span className="ico">
        <Icon d={icon} />
      </span>
      <span>
        <b>{title}</b>
        <span className="sub">{hint}</span>
      </span>
    </button>
  );
}
