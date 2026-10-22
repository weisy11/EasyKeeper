import "./index.css";
import { installAppState } from "./lib/appState";

void boot();

async function boot() {
  await installAppState();
  const { createRoot } = await import("react-dom/client");
  const { log } = await import("./lib/platform");
  const { recallSession } = await import("./project/launchSession");
  const { sessionStore } = await import("./project/sessionStore");
  const { default: App } = await import("./App.tsx");

  window.addEventListener("error", (e) => log(`JSERROR ${e.message} @${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => log(`JSREJECT ${e.reason?.stack ?? e.reason}`));

  const session = await recallSession();
  if (session) sessionStore.set(session);
  createRoot(document.getElementById("root")!).render(<App />);
}
