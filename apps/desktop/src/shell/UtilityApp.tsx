import { lazy, Suspense, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { settingsStore, useStore } from "../lib/store";
import { applySettings, installSettingsSync } from "./settingsSync";
import { applyCurrentForm, currentSaveButton } from "./formCommands";
import { GITHUB } from "./docs";

const Help = lazy(() => import("./Help").then((module) => ({ default: module.Help })));
const Models = lazy(() => import("@ek-tool/copilot/settings").then((module) => ({ default: module.CopilotEditorDialog })));

function Settings() {
  const settings = useStore(settingsStore);
  const en = settings.locale === "en";
  const select = "h-9 min-w-36 rounded-md border border-border bg-background px-2";
  return <main className="mx-auto flex h-screen max-w-lg flex-col gap-5 overflow-auto p-6">
    <h1 className="text-lg font-semibold">{en ? "Settings" : "设置"}</h1>
    <label className="flex items-center justify-between gap-4"><span>{en ? "Language" : "语言"}</span><select className={select} value={settings.locale} onChange={(event) => settingsStore.set((state) => ({ ...state, locale: event.target.value as "zh" | "en" }))}><option value="zh">简体中文</option><option value="en">English</option></select></label>
    <label className="flex items-center justify-between gap-4"><span>{en ? "Theme" : "主题"}</span><select className={select} value={settings.theme} onChange={(event) => settingsStore.set((state) => ({ ...state, theme: event.target.value as "light" | "dark" }))}><option value="light">{en ? "Light" : "浅色"}</option><option value="dark">{en ? "Dark" : "深色"}</option></select></label>
    <label className="flex items-center justify-between gap-4"><span>{en ? "Font size" : "字号"}</span><select className={select} value={settings.fontScale} onChange={(event) => settingsStore.set((state) => ({ ...state, fontScale: Number(event.target.value) }))}>{[0.8,0.9,1,1.1,1.2,1.3,1.4].map((scale) => <option key={scale} value={scale}>{Math.round(scale * 100)}%{scale === 1 ? (en ? " (Default)" : "（默认）") : ""}</option>)}</select></label>
    <label className="flex items-center justify-between gap-4"><span>{en ? "Mute dice sounds" : "骰子静音"}</span><input type="checkbox" checked={settings.diceMuted} onChange={(event) => settingsStore.set((state) => ({ ...state, diceMuted: event.target.checked }))} /></label>
    <button type="button" className="mt-1 rounded-md border border-border px-3 py-2 hover:bg-muted" onClick={() => void invoke("open_utility", { kind: "models", page: null })}>{en ? "Models and Proxies…" : "模型与代理配置…"}</button>
  </main>;
}

function About() {
  const { locale } = useStore(settingsStore);
  const en = locale === "en";
  return <main className="flex h-screen flex-col items-center justify-center gap-3 overflow-auto p-6 text-center">
    <h1 className="text-2xl font-semibold">EasyKeeper</h1>
    <p className="text-sm text-muted-foreground">{en ? "Version" : "版本"} {__APP_VERSION__}</p>
    <p>{en ? "A toolbox for preparing and running tabletop games" : "为备团和跑团设计的工具箱"}</p>
    <a href={GITHUB} className="break-all text-sm underline underline-offset-4" onClick={(event) => { event.preventDefault(); void invoke("open_http_url", { url: GITHUB }); }}>{GITHUB}</a>
    <p className="mt-2 text-xs text-muted-foreground">Apache License 2.0<br />Copyright © 2026 EasyKeeper contributors</p>
  </main>;
}

export function UtilityApp() {
  const { locale } = useStore(settingsStore);
  const kind = new URLSearchParams(location.search).get("kind") ?? "about";
  const page = new URLSearchParams(location.search).get("page") ?? "README";
  useEffect(() => {
    installSettingsSync();
    const sync = () => {
      applySettings(document);
      const en = settingsStore.get().locale === "en";
      const title = kind === "help" ? (en ? "Help" : "帮助") : kind === "settings" ? (en ? "Settings" : "设置") : kind === "models" ? (en ? "Models and Proxies" : "模型与代理配置") : (en ? "About EasyKeeper" : "关于 EasyKeeper");
      void getCurrentWindow().setTitle(title);
    };
    sync();
    return settingsStore.subscribe(sync);
  }, [kind]);
  useEffect(() => {
    let last: boolean | undefined;
    let frame = 0;
    const sync = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const enabled = currentSaveButton([document]) !== null;
        if (enabled === last) return;
        last = enabled;
        void invoke("set_utility_save_enabled", { enabled });
      });
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    let cancelled = false;
    let stop: (() => void) | undefined;
    void listen("ek:save-form", () => applyCurrentForm([document])).then((unlisten) => { if (cancelled) unlisten(); else stop = unlisten; });
    sync();
    return () => { cancelled = true; observer.disconnect(); stop?.(); cancelAnimationFrame(frame); };
  }, []);
  return <Suspense fallback={<p className="p-6">{locale === "en" ? "Loading…" : "正在加载…"}</p>}>
    {kind === "help" ? <Help page={page} /> : kind === "settings" ? <Settings /> : kind === "models" ? <Models standalone onClose={() => void getCurrentWindow().close()} /> : <About />}
  </Suspense>;
}
