import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { log } from "./lib/platform";

window.addEventListener("error", (e) => log(`JSERROR ${e.message} @${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => log(`JSREJECT ${e.reason?.stack ?? e.reason}`));

createRoot(document.getElementById("root")!).render(<App />);
