/**
 * Resplendent Timer — Application Shell.
 *
 * Compact macOS overlay title bar with unified segmented navigation,
 * optional GitHub PR badge, scrollable feature workspace, and global Session Wrap-Up sheet.
 */

import { BarChart3, Clock3, SlidersHorizontal } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type AppTab, TimerProvider, useTimer } from "@/context/TimerProvider";
import { FocusView } from "@/features/focus/FocusView";
import { GitHubPrPopover } from "@/features/focus/GitHubPrPopover";
import { WrapUpSheet } from "@/features/focus/WrapUpSheet";
import { InsightsView } from "@/features/insights/InsightsView";
import { SettingsView } from "@/features/settings/SettingsView";
import { useMeetingDetector } from "@/hooks/useMeetingDetector";
import { useUpdater } from "@/hooks/useUpdater";
import { cn } from "@/lib/utils";

const NAV_ITEMS: { id: AppTab; label: string; icon: typeof Clock3 }[] = [
  { id: "focus", label: "Focus", icon: Clock3 },
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: SlidersHorizontal },
];

function isMacOS(): boolean {
  return navigator.platform.toLowerCase().includes("mac");
}

function AppShell() {
  const {
    activeTab,
    setActiveTab,
    isWindowVisible,
    settings,
    runningTimer,
    isBackdateEligible,
  } = useTimer();

  useMeetingDetector(runningTimer, settings, isWindowVisible);

  const updater = useUpdater({
    isWindowVisible,
    eagerCheck: isWindowVisible || activeTab === "settings",
  });

  const macTrafficLightPad = isMacOS() ? "pl-[76px]" : "pl-4";

  return (
    <main className="relative flex h-screen w-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      {/* Compact Overlay Draggable Title Bar */}
      <header
        data-tauri-drag-region
        className={cn(
          "sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-white/[0.07] bg-[#0c0d14]/95 pr-3 select-none",
          macTrafficLightPad
        )}
      >
        {/* Segmented pill navigation */}
        <nav
          aria-label="Primary navigation"
          data-no-drag
          className="inline-flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.035] p-0.5"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all",
                  active
                    ? "bg-white/[0.11] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right utility cluster: GitHub PR popover + live status indicator */}
        <div className="flex items-center gap-2" data-no-drag>
          <GitHubPrPopover />
          <button
            type="button"
            onClick={() => setActiveTab("focus")}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] transition-colors hover:bg-white/[0.08]"
            title={
              runningTimer
                ? `Running: ${runningTimer.name}`
                : isBackdateEligible
                ? "Untracked active time ready to capture"
                : "No timer running"
            }
            aria-label="Timer status"
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                runningTimer
                  ? "bg-success animate-pulse shadow-[0_0_8px_rgba(45,212,150,0.8)]"
                  : isBackdateEligible
                  ? "bg-accent shadow-[0_0_8px_rgba(246,196,83,0.75)]"
                  : "bg-white/25"
              )}
            />
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[480px] px-4 pt-3.5 pb-4">
          {activeTab === "focus" && <FocusView />}
          {activeTab === "insights" && <InsightsView />}
          {activeTab === "settings" && (
            <SettingsView
              onSaved={() => setActiveTab("focus")}
              updater={updater}
            />
          )}
        </div>
      </ScrollArea>

      {/* Global Post-Stop / Quick-Edit Session Wrap-Up Sheet */}
      <WrapUpSheet />
    </main>
  );
}

export default function App() {
  return (
    <TimerProvider>
      <AppShell />
    </TimerProvider>
  );
}
