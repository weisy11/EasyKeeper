import "./index.css";
import { installAppKv } from "./lib/appKv";

void (async () => {
  await installAppKv();
  const { createRoot } = await import("react-dom/client");
  const { UtilityApp } = await import("./shell/UtilityApp");
  createRoot(document.getElementById("root")!).render(<UtilityApp />);
})();
