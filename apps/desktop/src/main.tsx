import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { log } from "./lib/platform";
import { recallSession } from "./project/launchSession";
import { sessionStore } from "./project/sessionStore";

window.addEventListener("error", (e) => log(`JSERROR ${e.message} @${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => log(`JSREJECT ${e.reason?.stack ?? e.reason}`));

async function boot() {
  const session = await recallSession();
  if (session) sessionStore.set(session);
  createRoot(document.getElementById("root")!).render(<App />);
}

void boot();
