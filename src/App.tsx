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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

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

  return (
    <main className="min-h-screen flex flex-col p-4 pt-10 max-w-md mx-auto">
      {/* Header - draggable on macOS */}
      <header
        className="text-center mb-6 pb-4 border-b border-border"
        data-tauri-drag-region
      >
        <h1 className="text-xl font-semibold tracking-tight">
          Resplendent Timer
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Automatically stops ClickUp timers when you're idle
        </p>
      </header>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="space-y-6 mt-0">
          <StatusIndicator status={idleStatus} />
          <TimerControls status={idleStatus} />
        </TabsContent>

        <TabsContent value="settings" className="mt-0">
          <Settings onSave={() => setActiveTab("status")} />
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <Separator className="mt-auto" />
      <footer className="text-center py-4">
        <p className="text-xs text-muted-foreground">
          Minimize to system tray to keep monitoring in the background
        </p>
      </footer>
    </main>
  );
}

export default App;
