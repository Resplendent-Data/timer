/**
 * Main application component for Resplendent Timer.
 *
 * Manages the idle monitoring service and provides the UI
 * for configuring ClickUp integration.
 */

import { useState, useEffect } from "react";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { useIdleChecker } from "./hooks/useIdleChecker";
import { Settings } from "./components/Settings";
import { StatusIndicator } from "./components/StatusIndicator";
import { TimerControls } from "./components/TimerControls";
import "./App.css";

type Tab = "status" | "settings";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("status");

  // Start the background idle checker (runs every minute)
  const idleStatus = useIdleChecker(60_000);

  // Request notification permission on app startup
  useEffect(() => {
    async function requestNotificationPermission() {
      try {
        const granted = await isPermissionGranted();
        if (!granted) {
          const permission = await requestPermission();
          console.log("Notification permission:", permission);
        }
      } catch (error) {
        console.error("Failed to request notification permission:", error);
      }
    }
    requestNotificationPermission();
  }, []);

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">Resplendent Timer</h1>
        <p className="app__subtitle">
          Automatically stops ClickUp timers when you're idle
        </p>
      </header>

      <nav className="app__tabs">
        <button
          className={`app__tab ${activeTab === "status" ? "app__tab--active" : ""}`}
          onClick={() => setActiveTab("status")}
        >
          Status
        </button>
        <button
          className={`app__tab ${activeTab === "settings" ? "app__tab--active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          Settings
        </button>
      </nav>

      <div className="app__content">
        {activeTab === "status" && (
          <>
            <StatusIndicator status={idleStatus} />
            <TimerControls status={idleStatus} />
          </>
        )}
        {activeTab === "settings" && (
          <Settings onSave={() => setActiveTab("status")} />
        )}
      </div>

      <footer className="app__footer">
        <p>
          <small>
            Minimize to system tray to keep monitoring in the background
          </small>
        </p>
      </footer>
    </main>
  );
}

export default App;
