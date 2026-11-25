import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MiniPlayer } from "./MiniPlayer";

// Мини-плеер — то же приложение, но в отдельном окне: маршрут выбирается
// адресом, чтобы не тащить в него весь App с рейлом и экранами.
const mini = new URLSearchParams(window.location.search).get("mini") === "1";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{mini ? <MiniPlayer /> : <App />}</StrictMode>,
);
