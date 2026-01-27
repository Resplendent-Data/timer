/**
 * Timer controls component for starting and stopping ClickUp timers.
 *
 * Features:
 * - Search for tasks with auto-complete (debounced)
 * - Recent tasks list for quick access
 * - Resume last stopped timer
 * - Start manual timer (without a task)
 * - Keyboard navigation
 * - Task details (project path, status, tags)
 * - Optional tag and billable settings via modal
 * - Shift+click for quick start (skips modal)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getSettings,
  getRecentTasks,
  addRecentTask,
  RecentTask,
} from "../lib/store";
import { IdleStatus } from "../hooks/useIdleChecker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { StartTimerModal, TimeEntryTag, TaskInfo } from "./StartTimerModal";

/** Tag on a task */
interface TaskTag {
  name: string;
  tag_fg: string | null;
  tag_bg: string | null;
}

/** Task search result from Rust backend */
interface TaskSearchResult {
  id: string;
  name: string;
  custom_id: string | null;
  status_name: string | null;
  status_color: string | null;
  list_name: string | null;
  folder_name: string | null;
  space_name: string | null;
  tags: TaskTag[];
}

interface TimerControlsProps {
  status: IdleStatus;
}

/** Debounce delay for auto-search in milliseconds */
const SEARCH_DEBOUNCE_MS = 300;

/** Build a project path string from space/folder/list */
function buildProjectPath(task: TaskSearchResult): string {
  const parts: string[] = [];
  if (task.space_name) parts.push(task.space_name);
  if (task.folder_name) parts.push(task.folder_name);
  if (task.list_name) parts.push(task.list_name);
  return parts.join(" > ");
}

export function TimerControls({ status }: TimerControlsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<TaskSearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([]);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTask, setModalTask] = useState<TaskInfo | null>(null);
  const [cachedTags, setCachedTags] = useState<TimeEntryTag[] | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);

  // Load recent tasks on mount
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      getRecentTasks().then((tasks) => {
        console.log("[TimerControls] Initial load of recent tasks:", tasks);
        setRecentTasks(tasks);
      }).catch((err) => {
        console.error("[TimerControls] Failed to load recent tasks:", err);
      });
    }
  }, []);

  // Reload recent tasks when timer stops (runningTaskName becomes null)
  useEffect(() => {
    if (status.runningTaskName === null && hasLoadedRef.current) {
      getRecentTasks().then((tasks) => {
        console.log("[TimerControls] Reloaded recent tasks after timer stop:", tasks);
        setRecentTasks(tasks);
      }).catch((err) => {
        console.error("[TimerControls] Failed to reload recent tasks:", err);
      });
    }
  }, [status.runningTaskName]);

  // Debounced search effect
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSelectedIndex(-1);
      return;
    }

    debounceRef.current = window.setTimeout(async () => {
      setIsSearching(true);
      setError(null);

      try {
        const settings = await getSettings();
        if (!settings) throw new Error("Settings not configured");

        const results = await invoke<TaskSearchResult[]>("search_tasks", {
          apiKey: settings.clickupApiKey,
          teamId: settings.clickupTeamId,
          query: searchQuery,
        });

        setSearchResults(results);
        setSelectedIndex(results.length > 0 ? 0 : -1);

        if (results.length === 0) {
          setError("No tasks found");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && resultsRef.current) {
      const selectedElement = resultsRef.current.children[
        selectedIndex
      ] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  // Quick start timer (no modal) - used for Resume and Shift+click
  const quickStartTimer = useCallback(
    async (taskId: string, taskName: string, projectPath?: string) => {
      setIsProcessing(true);
      setError(null);

      try {
        const settings = await getSettings();
        if (!settings) throw new Error("Settings not configured");

        await invoke("start_timer", {
          apiKey: settings.clickupApiKey,
          teamId: settings.clickupTeamId,
          taskId,
        });

        // Add to recent tasks
        await addRecentTask({ id: taskId, name: taskName, projectPath });
        setRecentTasks(await getRecentTasks());

        // Clear search and refresh status
        setSearchQuery("");
        setSearchResults([]);
        setSelectedIndex(-1);
        await status.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsProcessing(false);
      }
    },
    [status]
  );

  // Handle timer started from modal
  const handleTimerStarted = useCallback(
    async (task: TaskInfo | null, _description?: string) => {
      // Clear search and refresh status
      setSearchQuery("");
      setSearchResults([]);
      setSelectedIndex(-1);

      // If it was a task timer, add to recent tasks
      if (task) {
        await addRecentTask({ id: task.id, name: task.name, projectPath: task.projectPath });
        setRecentTasks(await getRecentTasks());
      }

      await status.refresh();
    },
    [status]
  );

  // Handle click on task - opens modal unless Shift is held
  const handleTaskClick = useCallback(
    (task: TaskSearchResult, event: React.MouseEvent) => {
      const projectPath = buildProjectPath(task);
      
      if (event.shiftKey) {
        // Quick start (no modal)
        quickStartTimer(task.id, task.name, projectPath);
      } else {
        // Open modal with task
        setModalTask({ id: task.id, name: task.name, projectPath });
        setModalOpen(true);
      }
    },
    [quickStartTimer]
  );

  // Handle click on recent task - opens modal unless Shift is held
  const handleRecentTaskClick = useCallback(
    (task: RecentTask, event: React.MouseEvent) => {
      if (event.shiftKey) {
        // Quick start (no modal)
        quickStartTimer(task.id, task.name, task.projectPath);
      } else {
        // Open modal with task
        setModalTask({ id: task.id, name: task.name, projectPath: task.projectPath });
        setModalOpen(true);
      }
    },
    [quickStartTimer]
  );

  // Resume always does quick start (no modal)
  const handleResumeTimer = useCallback(async () => {
    if (!status.lastStoppedTaskId || !status.lastStoppedTaskName) return;
    await quickStartTimer(
      status.lastStoppedTaskId,
      status.lastStoppedTaskName
    );
  }, [status.lastStoppedTaskId, status.lastStoppedTaskName, quickStartTimer]);

  // Open manual timer modal
  const handleStartManualTimer = useCallback(() => {
    setModalTask(null); // null = manual timer
    setModalOpen(true);
  }, []);

  const handleStopTimer = useCallback(async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const settings = await getSettings();
      if (!settings) throw new Error("Settings not configured");

      await invoke("stop_timer", {
        apiKey: settings.clickupApiKey,
        teamId: settings.clickupTeamId,
      });

      await status.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  }, [status]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (searchResults.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < searchResults.length - 1 ? prev + 1 : prev
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < searchResults.length) {
            const task = searchResults[selectedIndex];
            const projectPath = buildProjectPath(task);
            if (e.shiftKey) {
              // Shift+Enter = quick start
              quickStartTimer(task.id, task.name, projectPath);
            } else {
              // Enter = open modal
              setModalTask({ id: task.id, name: task.name, projectPath });
              setModalOpen(true);
            }
          }
          break;
        case "Escape":
          e.preventDefault();
          setSearchQuery("");
          setSearchResults([]);
          setSelectedIndex(-1);
          break;
      }
    },
    [searchResults, selectedIndex, quickStartTimer]
  );

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
    setSelectedIndex(-1);
    setError(null);
    searchInputRef.current?.focus();
  }, []);

  // If timer is running, show stop button
  if (status.runningTaskName) {
    return (
      <div className="space-y-3">
        {error && (
          <Card className="bg-destructive/10 border-destructive">
            <CardContent className="py-3">
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}
        <Button
          variant="destructive"
          className="w-full"
          onClick={handleStopTimer}
          disabled={isProcessing}
        >
          {isProcessing ? "Stopping..." : "Stop Timer"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Start Timer Modal */}
      <StartTimerModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        task={modalTask}
        cachedTags={cachedTags}
        onTagsFetched={setCachedTags}
        onTimerStarted={handleTimerStarted}
      />

      {/* Resume last stopped timer */}
      {status.lastStoppedTaskId && status.lastStoppedTaskName && (
        <Button
          variant="secondary"
          className="w-full justify-start text-left h-auto py-3"
          onClick={handleResumeTimer}
          disabled={isProcessing}
        >
          <div className="flex flex-col items-start">
            <span className="text-xs text-muted-foreground">Resume</span>
            <span className="font-medium truncate max-w-full">
              {status.lastStoppedTaskName}
            </span>
          </div>
        </Button>
      )}

      {/* Recent tasks */}
      {recentTasks.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Recent Tasks
          </h4>
          <div className="space-y-1">
            {recentTasks.map((task) => (
              <Button
                key={task.id}
                variant="ghost"
                className="w-full justify-start text-left h-auto py-2 px-3"
                onClick={(e) => handleRecentTaskClick(task, e)}
                disabled={isProcessing}
              >
                <div className="flex flex-col items-start overflow-hidden">
                  <span className="font-medium text-sm truncate max-w-full">
                    {task.name}
                  </span>
                  {task.projectPath && (
                    <span className="text-xs text-muted-foreground truncate max-w-full">
                      {task.projectPath}
                    </span>
                  )}
                </div>
              </Button>
            ))}
          </div>
        </div>
      )}

      <Separator />

      {/* Search */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">
          Search Tasks
        </h4>
        <div className="relative">
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search task name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isProcessing}
            className="pr-8"
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
          )}
          {searchQuery && !isSearching && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-muted hover:bg-muted-foreground/20 flex items-center justify-center text-muted-foreground text-xs"
              aria-label="Clear search"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {error && (
        <Card className="bg-destructive/10 border-destructive">
          <CardContent className="py-3">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Search results */}
      {searchResults.length > 0 && (
        <Card>
          <ScrollArea className="max-h-64">
            <div ref={resultsRef} className="divide-y divide-border">
              {searchResults.map((task, index) => (
                <div
                  key={task.id}
                  className={`p-3 cursor-pointer transition-colors ${
                    index === selectedIndex
                      ? "bg-accent border-l-2 border-l-primary"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={(e) => handleTaskClick(task, e)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{task.name}</span>
                    {task.status_name && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                        style={{
                          backgroundColor: task.status_color || undefined,
                          color: task.status_color ? "#fff" : undefined,
                        }}
                      >
                        {task.status_name}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {buildProjectPath(task) || task.custom_id || task.id}
                  </p>
                  {task.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {task.tags.map((tag) => (
                        <span
                          key={tag.name}
                          className="inline-flex items-center rounded-md px-1.5 py-0 text-[10px] font-medium"
                          style={{
                            backgroundColor: tag.tag_bg || "#888888",
                            color: "#ffffff",
                            border: `1px solid ${tag.tag_bg || "#888888"}`,
                          }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
          <Separator />
          <div className="px-3 py-2 text-center">
            <p className="text-xs text-muted-foreground">
              &uarr;&darr; navigate, Enter to start, Shift+click for quick start
            </p>
          </div>
        </Card>
      )}

      <Separator />

      {/* Manual Timer Button */}
      <Button
        variant="outline"
        className="w-full"
        onClick={handleStartManualTimer}
        disabled={isProcessing}
      >
        Start Manual Timer
      </Button>
    </div>
  );
}
