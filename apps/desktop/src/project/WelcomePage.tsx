import { useEffect, useState } from "react";
import { settingsStore, useStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { isTauri } from "@/lib/platform";
import "./welcome.css";
import {
  ProjectError,
  createProject,
  documentsDir,
  joinPath,
  listChildDirs,
  nextNumberedName,
  openProject,
  pathExists,
  pickParentDirectory,
  samePath,
  splitProjectPath,
  validFolderName,
} from "./fs";
import { forgetProject, migrateLegacyRecent, rememberProject, recentStore } from "./recent";
import { sessionStore } from "./sessionStore";
import type { ProjectKind, RecentProject } from "./types";

type Roots = { docs: string; library: string; home: string | null };

type View =
  | { name: "home" }
  | { name: "create-scenario" }
  | { name: "edit-scenario" }
  | { name: "pick-scenario" }
  | { name: "create-record"; back: "home" | "pick-scenario"; modulePath: string | null }
  | { name: "pick-record" };

function enterProject(path: string, name: string, kind: ProjectKind, modulePath: string | null) {
  sessionStore.set({
    mode: kind === "scenario" ? "prep" : "play",
    projectPath: path,
    name,
    kind,
    modulePath,
    moduleEditable: kind === "scenario",
  });
  rememberProject({ path, name, kind, modulePath });
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

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

const PLUS = "M12 5v14M5 12h14";
const PENCIL = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z";
const BOOK = "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z";
const ARROW = "M5 12h14M12 5l7 7-7 7";
const HISTORY = "M3 12a9 9 0 1 0 2.5-6.2M3 4v5h5";

export function WelcomePage() {
  const tr = useT();
  const { locale } = useStore(settingsStore);
  const recent = useStore(recentStore);
  const [roots, setRoots] = useState<Roots | null>(null);
  const [view, setView] = useState<View>({ name: "home" });
  const [projectName, setProjectName] = useState("");
  const [parent, setParent] = useState("");
  const [dir, setDir] = useState("");
  const [kids, setKids] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [homeError, setHomeError] = useState<{ kind: ProjectKind; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void migrateLegacyRecent();
  }, []);

  useEffect(() => {
    let cancelled = false;
    documentsDir()
      .then(async (docs) => {
        const library = await joinPath(docs, "EasyKeeper");
        return { docs, library, home: splitProjectPath(docs)?.parent ?? null };
      })
      .then((next) => {
        if (!cancelled) setRoots(next);
      })
      .catch(() => {
        if (!cancelled) setRoots(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const picking = view.name === "edit-scenario" || view.name === "pick-scenario" || view.name === "pick-record";

  useEffect(() => {
    if (!picking || !dir) return;
    let cancelled = false;
    listChildDirs(dir)
      .then((names) => {
        if (!cancelled) setKids(names);
      })
      .catch(() => {
        if (!cancelled) setKids([]);
      });
    return () => {
      cancelled = true;
    };
  }, [picking, dir]);

  function message(caught: unknown, expected: ProjectKind) {
    if (caught instanceof ProjectError) {
      if (caught.code === "exists") return tr("welcome.error.exists");
      if (caught.code === "invalid-name") return tr("welcome.error.invalidName");
      if (caught.code === "missing-parent") return tr("welcome.error.missingParent");
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
    setError(null);
    setHomeError(null);
    setView({ name: "home" });
  }

  async function startCreate(kind: "scenario" | "record", back: "home" | "pick-scenario", modulePath: string | null) {
    if (!roots) return;
    setError(null);
    setBusy(true);
    try {
      const prefix = kind === "scenario" ? "scenario" : "record";
      const name = await nextNumberedName(roots.library, prefix);
      setProjectName(name);
      setParent(roots.library);
      setView(kind === "scenario" ? { name: "create-scenario" } : { name: "create-record", back, modulePath });
    } catch (caught) {
      setError(message(caught, kind === "scenario" ? "scenario" : "gameRecord"));
    } finally {
      setBusy(false);
    }
  }

  async function startPicker(next: "edit-scenario" | "pick-scenario" | "pick-record") {
    if (!roots) return;
    setError(null);
    setSelected(null);
    setKids([]);
    const libraryReady = await pathExists(roots.library);
    setDir(libraryReady ? roots.library : roots.docs);
    if (next === "edit-scenario") setView({ name: "edit-scenario" });
    else if (next === "pick-scenario") setView({ name: "pick-scenario" });
    else setView({ name: "pick-record" });
  }

  async function browse(target: "parent" | "dir") {
    const current = target === "parent" ? parent : dir;
    let picked: string | null = null;
    if (isTauri) {
      picked = await pickParentDirectory(current);
    } else {
      const typed = window.prompt(tr("welcome.browse"), current);
      picked = typed?.trim() ? typed.trim() : null;
    }
    if (!picked) return;
    setError(null);
    if (target === "parent") setParent(picked);
    else {
      setDir(picked);
      setSelected(null);
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
        createParent: roots != null && samePath(parent.trim(), roots.library),
      });
      const modulePath = view.name === "create-record" ? view.modulePath : null;
      enterProject(created.path, created.name, kind, modulePath);
    } catch (caught) {
      setError(message(caught, kind));
    } finally {
      setBusy(false);
    }
  }

  async function acceptFolder(path: string, expected: ProjectKind, fromHome: boolean) {
    setBusy(true);
    try {
      const opened = await openProject(path, expected);
      const recentHit = recent.recentRecords.find((item) => item.path === path);
      const modulePath = expected === "gameRecord" ? (recentHit?.modulePath ?? null) : null;
      enterProject(path, opened.name, expected, modulePath);
    } catch (caught) {
      const text = message(caught, expected);
      if (fromHome) setHomeError({ kind: expected, text });
      else setError(text);
    } finally {
      setBusy(false);
    }
  }

  async function openSelected() {
    if (!selected || !dir) return;
    const expected: ProjectKind = view.name === "pick-record" ? "gameRecord" : "scenario";
    const path = await joinPath(dir, selected);
    if (view.name === "pick-scenario") {
      setBusy(true);
      try {
        await openProject(path, "scenario");
        setError(null);
        await startCreate("record", "pick-scenario", path);
      } catch (caught) {
        setError(message(caught, "scenario"));
        setBusy(false);
      }
      return;
    }
    await acceptFolder(path, expected, false);
  }

  async function openRecent(item: RecentProject) {
    setHomeError(null);
    await acceptFolder(item.path, item.kind, true);
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
              <Action icon={PLUS} title={tr("welcome.createScenario")} hint={tr("welcome.createScenarioHint")} testId="create-scenario" disabled={busy || !roots} onClick={() => void startCreate("scenario", "home", null)} />
              <Action icon={PENCIL} title={tr("welcome.editScenario")} hint={tr("welcome.editScenarioHint")} testId="edit-scenario" disabled={busy || !roots} onClick={() => void startPicker("edit-scenario")} />
              <Action icon={BOOK} title={tr("welcome.runWithScenario")} hint={tr("welcome.runWithScenarioHint")} testId="run-with-scenario" disabled={busy || !roots} onClick={() => void startPicker("pick-scenario")} />
              <Action icon={ARROW} title={tr("welcome.justRun")} hint={tr("welcome.justRunHint")} testId="just-run" disabled={busy || !roots} onClick={() => void startCreate("record", "home", null)} />
              <Action icon={HISTORY} title={tr("welcome.continueGame")} hint={tr("welcome.continueGameHint")} testId="continue-game" disabled={busy || !roots} onClick={() => void startPicker("pick-record")} />
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
              <input id="project-name" value={projectName} spellCheck={false} data-project-name onChange={(event) => setProjectName(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="project-parent">{tr("welcome.location")}</label>
              <div className="loc">
                <input
                  id="project-parent"
                  value={shown(parent)}
                  spellCheck={false}
                  data-project-parent={parent}
                  onChange={(event) => setParent(fromDisplay(event.target.value, roots?.home ?? null))}
                />
                <button type="button" className="iconbtn" aria-label={tr("welcome.browse")} onClick={() => void browse("parent")}>
                  <FolderGlyph />
                </button>
              </div>
              {validFolderName(projectName) && parent.trim() && (
                <p className="hint">{tr("welcome.willCreate", { path: childDisplay(parent, projectName, roots?.home ?? null) })}</p>
              )}
              {error && <p className="err" data-welcome-error>{error}</p>}
            </div>
            <div className="foot">
              <button type="button" className="btn cancel" onClick={() => (view.name === "create-record" && view.back === "pick-scenario" ? void startPicker("pick-scenario") : goHome())}>
                {tr("welcome.cancel")}
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {tr("welcome.create")}
              </button>
            </div>
          </form>
        )}

        {picking && (
          <div className="picker">
            <h2>
              {tr(
                view.name === "edit-scenario"
                  ? "welcome.editScenario"
                  : view.name === "pick-scenario"
                    ? "welcome.selectScenario"
                    : "welcome.selectRecord",
              )}
            </h2>
            <label htmlFor="browser-dir">{tr("welcome.location")}</label>
            <div className="loc">
              <input id="browser-dir" value={shown(dir)} readOnly data-browser-dir />
              <button
                type="button"
                className="iconbtn"
                aria-label={tr("welcome.up")}
                disabled={!splitProjectPath(dir)}
                onClick={() => {
                  const up = splitProjectPath(dir)?.parent;
                  if (!up) return;
                  setSelected(null);
                  setError(null);
                  setDir(up);
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5" />
                  <path d="m6 11 6-6 6 6" />
                </svg>
              </button>
              <button type="button" className="iconbtn" aria-label={tr("welcome.browse")} onClick={() => void browse("dir")}>
                <FolderGlyph />
              </button>
            </div>
            <div className="list" data-folder-list>
              {kids.map((name) => (
                <div
                  key={name}
                  className={name === selected ? "row sel" : "row"}
                  data-folder={name}
                  onClick={() => {
                    setSelected(name);
                    setError(null);
                  }}
                >
                  <FolderGlyph />
                  <span className="grow">{name}</span>
                  <button
                    type="button"
                    className="enter"
                    aria-label={tr("welcome.enter")}
                    onClick={(event) => {
                      event.stopPropagation();
                      setError(null);
                      setSelected(null);
                      void joinPath(dir, name).then(setDir);
                    }}
                  >
                    <Chevron />
                  </button>
                </div>
              ))}
            </div>
            {error && <p className="err" data-welcome-error>{error}</p>}
            <div className="foot">
              <button type="button" className="btn cancel" onClick={goHome}>
                {tr("welcome.cancel")}
              </button>
              <button type="button" className="btn primary" disabled={busy || !selected} onClick={() => void openSelected()}>
                {tr(view.name === "pick-scenario" ? "welcome.next" : "welcome.open")}
              </button>
            </div>
          </div>
        )}
      </div>
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
      <ul>
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
