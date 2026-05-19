/**
 * Modal dialog for starting a timer with optional tag and billable settings.
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getSettings } from "../lib/store";

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
  /** Optional initial description for manual timer mode */
  initialDescription?: string;
  /** Optional initial tag for manual timer mode */
  initialTag?: string;
  /** Cached tags from workspace (to avoid refetching) */
  cachedTags: TimeEntryTag[] | null;
  /** Callback to update cached tags */
  onTagsFetched: (tags: TimeEntryTag[]) => void;
  /** Called when timer is successfully started */
  onTimerStarted: (task: TaskInfo | null, description?: string) => void;
}

const NO_TAG_VALUE = "__none__";

export function StartTimerModal({
  open,
  onOpenChange,
  task,
  initialDescription,
  initialTag,
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
      if (isManualTimer) {
        setDescription(initialDescription ?? "");
        setSelectedTag(initialTag ?? "");
      } else {
        setDescription("");
        setSelectedTag("");
      }
      setBillable(false);
      setError(null);
    }
  }, [open, isManualTimer, initialDescription, initialTag]);

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

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (isLoading && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  const selectedTagValue = selectedTag || NO_TAG_VALUE;

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        className="max-w-md gap-5"
        onEscapeKeyDown={(event) => {
          if (isLoading) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isLoading) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {isManualTimer ? "Start Manual Timer" : "Start Timer"}
          </DialogTitle>
          {!isManualTimer && task && (
            <DialogDescription>
              <span className="font-medium text-foreground">{task.name}</span>
              {task.projectPath && (
                <span className="block text-xs text-muted-foreground mt-1">
                  {task.projectPath}
                </span>
              )}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="grid gap-4">
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
            <Select
              value={selectedTagValue}
              onValueChange={(value) =>
                setSelectedTag(value === NO_TAG_VALUE ? "" : value)
              }
              disabled={isLoadingTags}
            >
              <SelectTrigger id="tag">
                <SelectValue placeholder={isLoadingTags ? "Loading tags..." : "None"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TAG_VALUE}>None</SelectItem>
                {selectedTag && !tags.some((tag) => tag.name === selectedTag) && (
                  <SelectItem value={selectedTag}>{selectedTag}</SelectItem>
                )}
                {tags.map((tag) => (
                  <SelectItem key={tag.name} value={tag.name}>
                    {tag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleDialogOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleStartTimer} disabled={isLoading}>
            {isLoading ? "Starting..." : "Start Timer"}
          </Button>
        </DialogFooter>

        {/* Hint for quick start */}
        {!isManualTimer && (
          <p className="text-center text-xs text-muted-foreground">
            Tip: Hold Shift when clicking a task to start immediately
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
