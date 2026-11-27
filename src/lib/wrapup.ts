import type { StoppedTimeEntry, TimeEntrySummary, WrapUpEntry } from "@/types/timer";

export function stoppedToWrapUp(
  entry: StoppedTimeEntry,
  source: WrapUpEntry["source"],
  suggestedDescription?: string | null
): WrapUpEntry {
  return {
    id: entry.id,
    name: entry.name,
    task_id: entry.task_id,
    task_name: entry.task_name,
    description: entry.description ?? "",
    suggested_description: suggestedDescription ?? null,
    start_time_ms: entry.start_time_ms,
    end_time_ms: entry.end_time_ms,
    duration_secs: entry.duration_secs,
    is_manual: entry.is_manual,
    tags: entry.tags,
    billable: entry.billable,
    is_backdated: entry.is_backdated,
    source,
  };
}

export function summaryToWrapUp(entry: TimeEntrySummary): WrapUpEntry {
  return {
    id: entry.id,
    name: entry.name,
    task_id: entry.task_id,
    task_name: entry.task_name,
    description: entry.description ?? "",
    suggested_description: null,
    start_time_ms: entry.start_time_ms,
    end_time_ms: entry.end_time_ms,
    duration_secs: entry.duration_secs,
    is_manual: entry.is_manual,
    tags: entry.tags,
    billable: entry.billable,
    is_backdated: false,
    source: "edit",
  };
}

export function summaryToStopped(entry: TimeEntrySummary): StoppedTimeEntry {
  return {
    id: entry.id,
    name: entry.name,
    task_id: entry.task_id,
    task_name: entry.task_name,
    description: entry.description,
    start_time_ms: entry.start_time_ms,
    end_time_ms: entry.end_time_ms,
    duration_secs: entry.duration_secs,
    is_manual: entry.is_manual,
    tags: entry.tags,
    billable: entry.billable,
    is_backdated: false,
  };
}
