import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSettings } from "../lib/store";
import { IdleStatus } from "../hooks/useIdleChecker";

interface TaskSearchResult {
  id: string;
  name: string;
  custom_id: string | null;
}

interface TimerControlsProps {
  status: IdleStatus;
}

export function TimerControls({ status }: TimerControlsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<TaskSearchResult[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskSearchResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setError(null);
    setSearchResults([]);
    setSelectedTask(null);

    try {
      const settings = await getSettings();
      if (!settings) throw new Error("Settings not loaded");

      const results = await invoke<TaskSearchResult[]>("search_tasks", {
        apiKey: settings.clickupApiKey,
        teamId: settings.clickupTeamId,
        query: searchQuery,
      });

      setSearchResults(results);
      if (results.length === 0) {
        setError("No tasks found");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSearching(false);
    }
  };

  const handleStartTimer = async () => {
    if (!selectedTask) return;

    setIsProcessing(true);
    setError(null);

    try {
      const settings = await getSettings();
      if (!settings) throw new Error("Settings not loaded");

      await invoke("start_timer", {
        apiKey: settings.clickupApiKey,
        teamId: settings.clickupTeamId,
        taskId: selectedTask.id,
      });

      // Clear selection and refresh status
      setSearchQuery("");
      setSearchResults([]);
      setSelectedTask(null);
      await status.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStopTimer = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const settings = await getSettings();
      if (!settings) throw new Error("Settings not loaded");

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
  };

  if (status.runningTaskName) {
    return (
      <div className="timer-controls timer-controls--running">
        {error && <div className="timer-controls__error">{error}</div>}
        <button 
          className="button button--stop button--full" 
          onClick={handleStopTimer}
          disabled={isProcessing}
        >
          {isProcessing ? "Stopping..." : "Stop Timer"}
        </button>
      </div>
    );
  }

  return (
    <div className="timer-controls">
      <h3>Manual Timer</h3>
      <form onSubmit={handleSearch} className="timer-controls__search-form">
        <div className="input-group">
          <input
            type="text"
            className="input"
            placeholder="Search task name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={isProcessing}
          />
          <button 
            type="submit" 
            className="button"
            disabled={isSearching || isProcessing || !searchQuery.trim()}
          >
            {isSearching ? "..." : "Search"}
          </button>
        </div>
      </form>

      {error && <div className="timer-controls__error">{error}</div>}

      {searchResults.length > 0 && (
        <div className="timer-controls__results">
          <ul className="task-list">
            {searchResults.map((task) => (
              <li 
                key={task.id} 
                className={`task-list__item ${selectedTask?.id === task.id ? "task-list__item--selected" : ""}`}
                onClick={() => setSelectedTask(task)}
              >
                <div className="task-list__name">{task.name}</div>
                <div className="task-list__id">{task.custom_id || task.id}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedTask && (
        <div className="timer-controls__actions">
          <button 
            className="button button--primary button--full"
            onClick={handleStartTimer}
            disabled={isProcessing}
          >
            {isProcessing ? "Starting..." : `Start: ${selectedTask.name}`}
          </button>
        </div>
      )}
    </div>
  );
}
