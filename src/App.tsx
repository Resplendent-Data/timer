/**
 * Main application component for Resplendent Timer.
 *
 * Manages the idle monitoring service and provides the UI
 * for configuring ClickUp integration.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { onAction } from "@tauri-apps/plugin-notification";
import { ChartNoAxesColumn, Clock3, SlidersHorizontal } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitHubPrStatus } from "./components/GitHubPrStatus";
import { Settings } from "./components/Settings";
import { Stats } from "./components/Stats";
import { StatusIndicator } from "./components/StatusIndicator";
import { TimerControls } from "./components/TimerControls";
import { WorkProgress } from "./components/WorkProgress";
import { useIdleChecker } from "./hooks/useIdleChecker";
import { useMeetingDetector } from "./hooks/useMeetingDetector";
import { useUpdater } from "./hooks/useUpdater";
import { checkNotificationPermission } from "./lib/notification";
import {
  AppSettings,
  SETTINGS_UPDATED_EVENT,
  getSettings,
  getWidgetPosition,
  saveWidgetPosition,
  clearWidgetPosition,
} from "./lib/store";

interface AppVisibilityChange {
  visible: boolean;
  focused: boolean;
}

function App() {
  const [activeTab, setActiveTab] = useState("status");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isWindowVisible, setIsWindowVisible] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const widgetEnabledRef = useRef(false);

  const shouldTickClock =
    isWindowVisible && (activeTab === "status" || activeTab === "stats");

  const idleStatus = useIdleChecker(settings, isWindowVisible);
  useMeetingDetector(idleStatus, settings, isWindowVisible);
  const updater = useUpdater({
    isWindowVisible,
    eagerCheck: isWindowVisible || activeTab === "settings",
  });

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

  const loadSettingsSnapshot = useCallback(async () => {
    try {
      const nextSettings = await getSettings();
      setSettings(nextSettings);

      const nextWidgetEnabled = nextSettings?.widgetEnabled ?? false;
      if (widgetEnabledRef.current !== nextWidgetEnabled) {
        widgetEnabledRef.current = nextWidgetEnabled;
        void updateWidgetState(nextWidgetEnabled);
      }
    } catch (error) {
      console.error("Failed to load settings snapshot:", error);
    }
  }, [updateWidgetState]);

  // Request notification permission on app startup (no-op on Linux)
  useEffect(() => {
    checkNotificationPermission().catch((error) => {
      console.error("Failed to request notification permission:", error);
    });
  }, []);

  // Listen for notification clicks to show the main window (macOS/Windows)
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    const setup = async () => {
      try {
        const listener = await onAction((notification) => {
          // Show the main window when notification is clicked
          invoke("show_main_window").catch((error) => {
            console.error("Failed to show main window on notification click:", error);
          });
          setActiveTab("status");

          const intent = notification.extra?.intent;
          if (intent === "meeting-start") {
            emit("open-meeting-modal").catch((error) => {
              console.error("Failed to emit open-meeting-modal event:", error);
            });
            return;
          }

          if (intent === "meeting-resume") {
            emit("show-meeting-resume", notification.extra?.resume_payload ?? null).catch(
              (error) => {
                console.error("Failed to emit show-meeting-resume event:", error);
              }
            );
          }
        });
        unlistenFn = () => listener.unregister();
      } catch (error) {
        // onAction may not be available on all platforms (e.g., Linux with notify-send)
        console.debug("Notification action listener not available:", error);
      }
    };

    setup();

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Ensure the "rt" tag exists in ClickUp workspace on app startup
  useEffect(() => {
    if (!settings?.clickupApiKey || !settings?.clickupTeamId) {
      return;
    }

    invoke<boolean>("ensure_rt_tag", {
      apiKey: settings.clickupApiKey,
      teamId: settings.clickupTeamId,
    })
      .then((created) => {
        if (created) {
          console.log("[App] Created 'rt' tag in ClickUp workspace");
        }
      })
      .catch((error) => {
        console.error("Failed to ensure rt tag exists:", error);
      });
  }, [settings]);

  useEffect(() => {
    void loadSettingsSnapshot();
  }, [loadSettingsSnapshot]);

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

  useEffect(() => {
    let unlistenSettings: (() => void) | null = null;
    let unlistenVisibility: (() => void) | null = null;

    const setup = async () => {
      unlistenSettings = await listen(SETTINGS_UPDATED_EVENT, () => {
        void loadSettingsSnapshot();
      });

      unlistenVisibility = await listen<AppVisibilityChange>(
        "app-visibility-changed",
        (event) => {
          setIsWindowVisible(event.payload.visible);
        }
      );
    };

    void setup();

    return () => {
      if (unlistenSettings) unlistenSettings();
      if (unlistenVisibility) unlistenVisibility();
    };
  }, [loadSettingsSnapshot]);

  useEffect(() => {
    setNowMs(Date.now());
    if (!shouldTickClock) {
      return;
    }

    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [shouldTickClock]);

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
  }, [idleStatus, settings]);

  return (
    <main className="h-screen w-full flex flex-col bg-background text-foreground">
      <header
        className="sticky top-0 z-10 shrink-0 border-b border-border/80 bg-background/95 px-5 pb-4 pt-7 shadow-sm backdrop-blur select-none"
        data-tauri-drag-region
      >
        <h1 className="text-base font-extrabold uppercase tracking-[0.12em] pointer-events-none">
          Resplendent Timer
        </h1>
        <p className="mt-1 text-xs text-muted-foreground pointer-events-none tracking-[0.04em]">
          Auto-stop idle ClickUp timers
        </p>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full flex-col p-4 pb-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <TabsList className="grid w-full grid-cols-3 mb-4 shrink-0">
              <TabsTrigger value="status">
                <Clock3 className="h-3.5 w-3.5" />
                Timer
              </TabsTrigger>
              <TabsTrigger value="stats">
                <ChartNoAxesColumn className="h-3.5 w-3.5" />
                Stats
              </TabsTrigger>
              <TabsTrigger value="settings">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Config
              </TabsTrigger>
            </TabsList>

            <TabsContent value="status" className="space-y-4 mt-0 flex-1">
              <GitHubPrStatus settings={settings} isVisible={isWindowVisible} />
              <StatusIndicator status={idleStatus} nowMs={nowMs} />
              <WorkProgress
                status={idleStatus}
                settings={settings}
                isVisible={isWindowVisible}
                nowMs={nowMs}
              />
              <TimerControls status={idleStatus} />
            </TabsContent>

            <TabsContent value="stats" className="mt-0 flex-1">
              <Stats
                status={idleStatus}
                settings={settings}
                isVisible={isWindowVisible}
                nowMs={nowMs}
              />
            </TabsContent>

            <TabsContent value="settings" className="mt-0 flex-1">
              <Settings onSave={() => setActiveTab("status")} updater={updater} />
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </main>
  );
}

export default App;
