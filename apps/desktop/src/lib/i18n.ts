import { settingsStore, useStore, type Locale } from "./store";

const dict = {
  "app.title": { zh: "EasyKeeper 布局沙盒", en: "EasyKeeper Layout Sandbox" },
  "ws.new": { zh: "新建工作区", en: "New workspace" },
  "ws.dup": { zh: "复制当前工作区", en: "Duplicate workspace" },
  "ws.rename": { zh: "重命名", en: "Rename" },
  "ws.delete": { zh: "删除工作区", en: "Delete workspace" },
  "ws.reset": { zh: "重置为内置默认", en: "Reset to built-in default" },
  "cmd.search": { zh: "搜索工具、命令、工作区…", en: "Search tools, commands, workspaces…" },
  "cmd.tools": { zh: "工具（打开或聚焦）", en: "Tools (open or focus)" },
  "cmd.commands": { zh: "命令", en: "Commands" },
  "cmd.workspaces": { zh: "工作区", en: "Workspaces" },
  "cmd.empty": { zh: "没有匹配项", en: "No matches" },
  "cmd.openAll": { zh: "打开全部工具", en: "Open all tools" },
  "cmd.smallWindow": { zh: "把主窗口缩小到 760×520", en: "Shrink main window to 760×520" },
  "cmd.normalWindow": { zh: "恢复主窗口 1360×820", en: "Restore main window 1360×820" },
  "lock.on": { zh: "布局已锁定", en: "Layout locked" },
  "lock.off": { zh: "锁定布局", en: "Lock layout" },
  "focus.on": { zh: "退出专注模式", en: "Exit focus mode" },
  "focus.off": { zh: "专注模式", en: "Focus mode" },
  "dock.left": { zh: "左停靠区", en: "Left dock" },
  "dock.right": { zh: "右停靠区", en: "Right dock" },
  "dock.bottom": { zh: "底部停靠区", en: "Bottom dock" },
  "layout.menu": { zh: "布局", en: "Layout" },
  "layout.savePreset": { zh: "保存为预设…", en: "Save as preset…" },
  "layout.loadPreset": { zh: "应用预设", en: "Apply preset" },
  "layout.export": { zh: "导出预设文件…", en: "Export preset file…" },
  "layout.import": { zh: "导入预设文件…", en: "Import preset file…" },
  "layout.saved": { zh: "已自动保存", en: "Autosaved" },
  "tools.manage": { zh: "工具管理", en: "Manage tools" },
  "tools.enabled": { zh: "启用", en: "Enabled" },
  "tools.installed": { zh: "已安装", en: "Installed" },
  "settings.title": { zh: "全局设置", en: "Global settings" },
  "settings.lang": { zh: "语言", en: "Language" },
  "settings.langZh": { zh: "中", en: "中" },
  "settings.langEn": { zh: "EN", en: "EN" },
  "settings.font": { zh: "字号", en: "Font size" },
  "settings.theme": { zh: "主题", en: "Theme" },
  "settings.dark": { zh: "深色", en: "Dark" },
  "settings.light": { zh: "浅色", en: "Light" },
  "ph.disabled": { zh: "「{name}」已停用", en: "“{name}” is disabled" },
  "ph.missing": { zh: "工具「{name}」未安装", en: "Tool “{name}” is not installed" },
  "ph.disabledHint": { zh: "面板位置已保留。重新启用后原样恢复。", en: "The panel keeps its place and comes back as-is when re-enabled." },
  "ph.missingHint": { zh: "布局里引用了这个工具，但本机没有安装。", en: "The layout references this tool, but it is not installed here." },
  "ph.enable": { zh: "启用", en: "Enable" },
  "ph.install": { zh: "模拟安装", en: "Simulate install" },
  "ph.close": { zh: "关闭此面板", en: "Close this panel" },
  "status.popouts": { zh: "弹出窗口", en: "Pop-outs" },
  "status.width": { zh: "窗口宽度", en: "Window width" },
  "status.autocollapse": { zh: "窄屏自动折叠", en: "Narrow auto-collapse" },
  "panel.popout": { zh: "弹出到新窗口", en: "Pop out to window" },
  "panel.float": { zh: "浮动", en: "Float" },
  "panel.dockback": { zh: "放回主窗口", en: "Dock back" },
  "panel.maximize": { zh: "最大化", en: "Maximize" },
  "panel.localCount": { zh: "组件内计数（useState）", en: "Component count (useState)" },
  "panel.hostCount": { zh: "Host 计数（框架 store）", en: "Host count (framework store)" },
  "panel.mounts": { zh: "挂载次数", en: "Mounts" },
  "panel.doc": { zh: "所在文档", en: "Document" },
  "ws.empty": {
    zh: "这个工作区还是空的。按 Ctrl+K（⌘K）打开工具。",
    en: "This workspace is empty. Press Ctrl+K (⌘K) to open a tool.",
  },
  "layout.resetDefault": { zh: "重置为默认布局", en: "Reset to default layout" },
  "tools.manageHint": {
    zh: "勾选的工具会出现在命令面板里；取消勾选后，布局里若仍引用会显示占位。",
    en: "Checked tools appear in the command palette; unchecked tools show a placeholder if still in the layout.",
  },
  "tools.available": { zh: "工具「{name}」可用", en: "Tool “{name}” is available" },
  "action.open": { zh: "打开", en: "Open" },
  "layout.presetNamePlaceholder": { zh: "预设名，例如「战斗」", en: "Preset name, e.g. “Combat”" },
  "popout.blocked": { zh: "弹出窗口被拦截", en: "Pop-out blocked" },
  "popout.opening": { zh: "正在弹出窗口…", en: "Opening pop-out…" },
} as const;

export type I18nKey = keyof typeof dict;

export function translate(locale: Locale, key: I18nKey, vars?: Record<string, string | number>) {
  let s: string = dict[key][locale] ?? dict[key].zh;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export function t(key: I18nKey, vars?: Record<string, string | number>) {
  return translate(settingsStore.get().locale, key, vars);
}

export function useT() {
  const { locale } = useStore(settingsStore);
  return (key: I18nKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

export type LText = { zh: string; en: string };
export function useL() {
  const { locale } = useStore(settingsStore);
  return (x: LText) => x[locale];
}
