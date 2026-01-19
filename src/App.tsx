/**
 * Main application component for Resplendent Timer.
 *
 * Manages the idle monitoring service and provides the UI
 * for configuring ClickUp integration.
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { useIdleChecker } from "./hooks/useIdleChecker";
import { Settings } from "./components/Settings";
import { StatusIndicator } from "./components/StatusIndicator";
import { TimerControls } from "./components/TimerControls";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { getSettings } from "./lib/store";

function App() {
  const [activeTab, setActiveTab] = useState("status");

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
      {/* Sticky Header with Traffic Light Space - Draggable */}
      <header
        className="sticky top-0 z-10 bg-background pt-8 text-center px-6 pb-4 border-b border-border shrink-0 select-none"
        data-tauri-drag-region
      >
        <h1 className="text-xl font-semibold tracking-tight pointer-events-none">
          Resplendent Timer
        </h1>
        <p className="text-sm text-muted-foreground mt-1 pointer-events-none">
          Automatically stops ClickUp timers when you're idle
        </p>
      </header>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 flex flex-col min-h-full">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <TabsList className="grid w-full grid-cols-2 mb-6 shrink-0">
              <TabsTrigger value="status">Status</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="status" className="space-y-6 mt-0 flex-1">
              <StatusIndicator status={idleStatus} />
              <TimerControls status={idleStatus} />
            </TabsContent>

            <TabsContent value="settings" className="mt-0 flex-1">
              <Settings onSave={() => setActiveTab("status")} />
            </TabsContent>
          </Tabs>

          {/* Footer */}
          <div className="mt-auto pt-8">
            <Separator className="mb-4" />
            <footer className="text-center">
              <p className="text-xs text-muted-foreground">
                Minimize to system tray to keep monitoring in the background
              </p>
            </footer>
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
