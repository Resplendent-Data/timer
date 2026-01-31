/**
 * Main application component for Resplendent Timer.
 *
 * Manages the idle monitoring service and provides the UI
 * for configuring ClickUp integration.
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { checkNotificationPermission } from "./lib/notification";
import { useIdleChecker } from "./hooks/useIdleChecker";
import { useActivityHeartbeat } from "./hooks/useActivityHeartbeat";
import { Settings } from "./components/Settings";
import { StatusIndicator } from "./components/StatusIndicator";
import { TimerControls } from "./components/TimerControls";
import { Stats } from "./components/Stats";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSettings, getWidgetPosition, saveWidgetPosition, clearWidgetPosition } from "./lib/store";

function App() {
  const [activeTab, setActiveTab] = useState("status");
  const [widgetEnabled, setWidgetEnabled] = useState(false);

  // Start the background idle checker (runs every minute)
  const idleStatus = useIdleChecker(60_000);

  // Start the activity heartbeat (runs every 30 seconds for stats tracking)
  useActivityHeartbeat();

  // Create or close the widget window based on settings
  const updateWidgetState = useCallback(async (enabled: boolean) => {
    try {
      if (enabled) {
        // Get saved position and validate it
        const position = await getWidgetPosition();
        let x: number | null = null;
        let y: number | null = null;
        
        // Only use position if it's within reasonable screen bounds
        if (position && position.x >= 0 && position.x < 5000 && position.y >= 0 && position.y < 2000) {
          x = position.x;
          y = position.y;
        } else if (position) {
          // Clear invalid position
          await clearWidgetPosition();
        }
        
        await invoke("create_widget_window", { x, y });
      } else {
        await invoke("close_widget_window");
      }
    } catch (error) {
      console.error("Failed to update widget state:", error);
    }
  }, []);

  // Request notification permission on app startup (no-op on Linux)
  useEffect(() => {
    checkNotificationPermission().catch((error) => {
      console.error("Failed to request notification permission:", error);
    });
  }, []);

  // Ensure the "rt" tag exists in ClickUp workspace on app startup
  useEffect(() => {
    const ensureRtTag = async () => {
      try {
        const settings = await getSettings();
        if (settings?.clickupApiKey && settings?.clickupTeamId) {
          const created = await invoke<boolean>("ensure_rt_tag", {
            apiKey: settings.clickupApiKey,
            teamId: settings.clickupTeamId,
          });
          if (created) {
            console.log("[App] Created 'rt' tag in ClickUp workspace");
          }
        }
      } catch (error) {
        console.error("Failed to ensure rt tag exists:", error);
      }
    };

    ensureRtTag();
  }, []);

  // Load widget setting on startup and create widget if enabled
  useEffect(() => {
    const loadWidgetSetting = async () => {
      try {
        const settings = await getSettings();
        if (settings?.widgetEnabled) {
          setWidgetEnabled(true);
          await updateWidgetState(true);
        }
      } catch (error) {
        console.error("Failed to load widget setting:", error);
      }
    };

    loadWidgetSetting();
  }, [updateWidgetState]);

  // Listen for widget position save events from Rust
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await listen<[number, number]>("save-widget-position", async (event) => {
        const [x, y] = event.payload;
        await saveWidgetPosition({ x, y });
      });
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Watch for settings changes to update widget
  useEffect(() => {
    const checkWidgetSetting = async () => {
      try {
        const settings = await getSettings();
        const newEnabled = settings?.widgetEnabled ?? false;
        if (newEnabled !== widgetEnabled) {
          setWidgetEnabled(newEnabled);
          await updateWidgetState(newEnabled);
        }
      } catch (error) {
        console.error("Failed to check widget setting:", error);
      }
    };

    // Check periodically (every 2 seconds) for settings changes
    const interval = setInterval(checkWidgetSetting, 2000);
    return () => clearInterval(interval);
  }, [widgetEnabled, updateWidgetState]);

  // Handle tray menu events
  useEffect(() => {
    let unlistenStart: (() => void) | null = null;
    let unlistenStop: (() => void) | null = null;

    const setupListeners = async () => {
      unlistenStart = await listen("menu-start-timer", () => {
        // Switch to status tab which contains the timer controls
        setActiveTab("status");
      });

      unlistenStop = await listen("menu-stop-timer", async () => {
        try {
          const settings = await getSettings();
          if (settings) {
            await invoke("stop_timer", {
              apiKey: settings.clickupApiKey,
              teamId: settings.clickupTeamId,
            });
            idleStatus.refresh();
          }
        } catch (error) {
          console.error("Failed to stop timer from menu:", error);
        }
      });
    };

    setupListeners();

    return () => {
      if (unlistenStart) unlistenStart();
      if (unlistenStop) unlistenStop();
    };
  }, [idleStatus]);

  return (
    <main className="h-screen w-full flex flex-col bg-background text-foreground">
      {/* Brutalist Header - Draggable */}
      <header
        className="sticky top-0 z-10 bg-background pt-7 px-5 pb-4 border-b-2 border-border shrink-0 select-none"
        data-tauri-drag-region
      >
        <h1 className="font-mono-display text-sm font-semibold tracking-widest uppercase pointer-events-none">
          Resplendent
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5 pointer-events-none tracking-wide">
          Auto-stop idle ClickUp timers
        </p>
      </header>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 flex flex-col min-h-full">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <TabsList className="grid w-full grid-cols-3 mb-4 shrink-0">
              <TabsTrigger value="status">Timer</TabsTrigger>
              <TabsTrigger value="stats">Stats</TabsTrigger>
              <TabsTrigger value="settings">Config</TabsTrigger>
            </TabsList>

            <TabsContent value="status" className="space-y-4 mt-0 flex-1">
              <StatusIndicator status={idleStatus} />
              <TimerControls status={idleStatus} />
            </TabsContent>

            <TabsContent value="stats" className="mt-0 flex-1">
              <Stats />
            </TabsContent>

            <TabsContent value="settings" className="mt-0 flex-1">
              <Settings onSave={() => setActiveTab("status")} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </main>
  );
}

export default App;
