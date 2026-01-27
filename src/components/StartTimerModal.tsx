/**
 * Modal dialog for starting a timer with optional tag and billable settings.
 *
 * Uses a simple overlay approach instead of portals for Tauri compatibility.
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSettings } from "../lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

/** Time entry tag from ClickUp */
export interface TimeEntryTag {
  name: string;
  tag_bg: string | null;
  tag_fg: string | null;
}

/** Task information for the modal */
export interface TaskInfo {
  id: string;
  name: string;
  projectPath?: string;
}

interface StartTimerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Task to start timer for (null = manual timer) */
  task: TaskInfo | null;
  /** Cached tags from workspace (to avoid refetching) */
  cachedTags: TimeEntryTag[] | null;
  /** Callback to update cached tags */
  onTagsFetched: (tags: TimeEntryTag[]) => void;
  /** Called when timer is successfully started */
  onTimerStarted: (task: TaskInfo | null, description?: string) => void;
}

export function StartTimerModal({
  open,
  onOpenChange,
  task,
  cachedTags,
  onTagsFetched,
  onTimerStarted,
}: StartTimerModalProps) {
  const [description, setDescription] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>("");
  const [billable, setBillable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<TimeEntryTag[]>(cachedTags || []);

  const isManualTimer = task === null;

  // Fetch tags when modal opens if not cached
  useEffect(() => {
    if (open && cachedTags === null && !isLoadingTags) {
      fetchTags();
    } else if (cachedTags) {
      setTags(cachedTags);
    }
  }, [open, cachedTags]);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setDescription("");
      setSelectedTag("");
      setBillable(false);
      setError(null);
    }
  }, [open]);

  const fetchTags = async () => {
    setIsLoadingTags(true);
    try {
      const settings = await getSettings();
      if (!settings) {
        throw new Error("Settings not configured");
      }

      const fetchedTags = await invoke<TimeEntryTag[]>("get_time_entry_tags", {
        apiKey: settings.clickupApiKey,
        teamId: settings.clickupTeamId,
      });

      setTags(fetchedTags);
      onTagsFetched(fetchedTags);
    } catch (err) {
      console.error("Failed to fetch tags:", err);
      // Don't show error for tags - they're optional
    } finally {
      setIsLoadingTags(false);
    }
  };

  const handleStartTimer = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const settings = await getSettings();
      if (!settings) {
        throw new Error("Settings not configured");
      }

      const tagsToSend = selectedTag ? [selectedTag] : undefined;

      if (isManualTimer) {
        // Start manual timer
        await invoke("start_manual_timer", {
          apiKey: settings.clickupApiKey,
          teamId: settings.clickupTeamId,
          description: description.trim() || null,
          billable,
          tags: tagsToSend,
        });
        onTimerStarted(null, description.trim() || undefined);
      } else {
        // Start task timer
        await invoke("start_timer", {
          apiKey: settings.clickupApiKey,
          teamId: settings.clickupTeamId,
          taskId: task.id,
          billable,
          tags: tagsToSend,
        });
        onTimerStarted(task);
      }

      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      onOpenChange(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60"
        onClick={handleClose}
      />
      
      {/* Modal content */}
      <Card className="relative z-10 w-full max-w-md mx-4 shadow-xl">
        <CardHeader>
          <CardTitle>
            {isManualTimer ? "Start Manual Timer" : "Start Timer"}
          </CardTitle>
          {!isManualTimer && task && (
            <CardDescription>
              <span className="font-medium text-foreground">{task.name}</span>
              {task.projectPath && (
                <span className="block text-xs text-muted-foreground mt-1">
                  {task.projectPath}
                </span>
              )}
            </CardDescription>
          )}
        </CardHeader>

        <CardContent className="grid gap-4">
          {/* Description - only for manual timers */}
          {isManualTimer && (
            <div className="grid gap-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                placeholder="What are you working on?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {/* Tag selector */}
          <div className="grid gap-2">
            <Label htmlFor="tag">Tag (optional)</Label>
            <select
              id="tag"
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
              className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">{isLoadingTags ? "Loading tags..." : "None"}</option>
              {tags.map((tag) => (
                <option key={tag.name} value={tag.name}>
                  {tag.name}
                </option>
              ))}
            </select>
            {selectedTag && (() => {
              const selectedTagData = tags.find((t) => t.name === selectedTag);
              const bgColor = selectedTagData?.tag_bg || "#888888";
              return (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Selected:</span>
                  <span
                    className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: bgColor,
                      color: "#ffffff",
                      border: `1px solid ${bgColor}`,
                    }}
                  >
                    {selectedTag}
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Billable toggle */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="billable"
              checked={billable}
              onCheckedChange={(checked) => setBillable(checked === true)}
            />
            <Label htmlFor="billable" className="text-sm font-normal cursor-pointer">
              Billable
            </Label>
          </div>

          {/* Error message */}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md p-2">
              {error}
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleStartTimer} disabled={isLoading}>
            {isLoading ? "Starting..." : "Start Timer"}
          </Button>
        </CardFooter>

        {/* Hint for quick start */}
        {!isManualTimer && (
          <p className="text-xs text-muted-foreground text-center pb-4 -mt-2">
            Tip: Hold Shift when clicking a task to start immediately
          </p>
        )}
      </Card>
    </div>
  );
}
