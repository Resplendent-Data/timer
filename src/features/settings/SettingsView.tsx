import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  PlugZap,
  RefreshCw,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTimer } from "@/context/TimerProvider";
import type { UseUpdaterResult } from "@/hooks/useUpdater";
import {
  type AppSettings,
  DEFAULT_APP_SETTINGS,
  getSettings,
  saveSettings,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import type { WorkspaceConnectionInfo } from "@/types/timer";

interface SettingsViewProps {
  onSaved?: () => void;
  updater: UseUpdaterResult;
}

const WEEKDAYS = [
  { value: 0, label: "Mon" },
  { value: 1, label: "Tue" },
  { value: 2, label: "Wed" },
  { value: 3, label: "Thu" },
  { value: 4, label: "Fri" },
  { value: 5, label: "Sat" },
  { value: 6, label: "Sun" },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="surface-card rounded-2xl p-4 space-y-3.5">
      <div>
        <h2 className="section-eyebrow">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label
          htmlFor={id}
          className={cn(
            "text-xs font-medium text-foreground",
            disabled && "opacity-50"
          )}
        >
          {label}
        </Label>
        {hint && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function SettingsView({ onSaved, updater }: SettingsViewProps) {
  const { reloadSettings } = useTimer();

  const [form, setForm] = useState<AppSettings>({ ...DEFAULT_APP_SETTINGS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [testingConn, setTestingConn] = useState(false);
  const [connResult, setConnResult] = useState<WorkspaceConnectionInfo | null>(
    null
  );
  const [connError, setConnError] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((stored) => {
        if (stored) setForm(stored);
      })
      .catch((err) => {
        console.error("[SettingsView] Failed to load settings:", err);
        setError("Failed to load saved settings");
      })
      .finally(() => setLoading(false));
  }, []);

  const handleTestConnection = async () => {
    setConnError(null);
    setConnResult(null);
    if (!form.clickupApiKey.trim() || !form.clickupTeamId.trim()) {
      setConnError("Enter both API Key and Team ID first.");
      return;
    }

    setTestingConn(true);
    try {
      const info = await invoke<WorkspaceConnectionInfo>(
        "test_clickup_connection",
        {
          apiKey: form.clickupApiKey.trim(),
          teamId: form.clickupTeamId.trim(),
        }
      );
      setConnResult(info);
    } catch (err) {
      setConnError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingConn(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      if (!form.clickupApiKey.trim()) throw new Error("ClickUp API Key is required");
      if (!form.clickupTeamId.trim()) throw new Error("ClickUp Team ID is required");
      if (form.idleThresholdMinutes < 1) {
        throw new Error("Idle auto-stop threshold must be at least 1 minute");
      }
      if (form.minBackdateMinutes < 1) {
        throw new Error("Minimum backdate threshold must be at least 1 minute");
      }
      if (form.maxBackdateMinutes < form.minBackdateMinutes) {
        throw new Error("Max backdate cap must be >= minimum backdate minutes");
      }
      if (form.noTimerWarningEnabled && form.noTimerWarningMinutes < 1) {
        throw new Error("Reminder threshold must be at least 1 minute");
      }
      const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!timePattern.test(form.workdayStart) || !timePattern.test(form.workdayEnd)) {
        throw new Error("Workday start/end must be in HH:MM format");
      }
      if (form.workdayStart === form.workdayEnd) {
        throw new Error("Workday start and end cannot be the same");
      }
      if (form.workdays.length === 0) {
        throw new Error("Select at least one workday");
      }
      if (form.expectedHoursPerDay <= 0) {
        throw new Error("Expected hours per day must be greater than 0");
      }

      await saveSettings(form);
      await reloadSettings();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const lastCheckedText =
    updater.lastCheckedAt === null
      ? "Never"
      : new Date(updater.lastCheckedAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        });

  if (loading) {
    return (
      <div className="surface-card flex justify-center rounded-2xl py-10">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 pb-6">
      {error && (
        <div className="rounded-xl border border-destructive/35 bg-destructive/12 px-3.5 py-2.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* ClickUp Connection */}
      <Section
        title="ClickUp Workspace"
        description="Connect your workspace for 1-click timers, post-stop notes, and backdating."
      >
        <div className="space-y-1.5">
          <Label htmlFor="apiKey" className="text-xs">
            API Key
          </Label>
          <div className="flex gap-2">
            <Input
              id="apiKey"
              type={showApiKey ? "text" : "password"}
              value={form.clickupApiKey}
              onChange={(e) => {
                setForm({ ...form, clickupApiKey: e.target.value });
                setConnResult(null);
              }}
              placeholder="pk_..."
              autoComplete="off"
              className="h-9 flex-1 font-mono-display text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setShowApiKey((v) => !v)}
              aria-label={showApiKey ? "Hide API key" : "Show API key"}
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Find under{" "}
            <a
              href="https://app.clickup.com/settings/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              ClickUp Settings → Apps
            </a>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="teamId" className="text-xs">
            Team / Workspace ID
          </Label>
          <div className="flex gap-2">
            <Input
              id="teamId"
              type="text"
              value={form.clickupTeamId}
              onChange={(e) => {
                setForm({ ...form, clickupTeamId: e.target.value });
                setConnResult(null);
              }}
              placeholder="123456789"
              className="h-9 flex-1 font-mono-display text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleTestConnection()}
              disabled={testingConn}
              className="h-9 shrink-0 px-3"
            >
              <PlugZap className="h-3.5 w-3.5" />
              {testingConn ? "Testing..." : "Test"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            From URL: app.clickup.com/<strong>[team_id]</strong>/...
          </p>
        </div>

        {connResult && (
          <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              Connected to <strong>{connResult.workspace_name}</strong> ({connResult.member_count}{" "}
              member{connResult.member_count !== 1 ? "s" : ""})
            </span>
          </div>
        )}
        {connError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {connError}
          </div>
        )}
      </Section>

      {/* Smart Timer & Backdating */}
      <Section
        title="Smart Timer & Backdating"
        description="Start timers in 1 click, recover untracked active time automatically, and describe your work when you stop."
      >
        <ToggleRow
          id="autoBackdateEnabled"
          label="Auto-backdate untracked active time"
          hint="When you start a timer after working without one, set start time to when you became active."
          checked={form.autoBackdateEnabled}
          onCheckedChange={(checked) =>
            setForm({ ...form, autoBackdateEnabled: checked })
          }
        />

        {form.autoBackdateEnabled && (
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3">
            <div className="space-y-1">
              <Label htmlFor="minBackdate" className="text-[11px] text-muted-foreground">
                Min active (min)
              </Label>
              <Input
                id="minBackdate"
                type="number"
                min={1}
                max={30}
                value={form.minBackdateMinutes}
                onChange={(e) =>
                  setForm({
                    ...form,
                    minBackdateMinutes: parseInt(e.target.value, 10) || 2,
                  })
                }
                className="h-8 font-mono-display text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="maxBackdate" className="text-[11px] text-muted-foreground">
                Max lookback (min)
              </Label>
              <Input
                id="maxBackdate"
                type="number"
                min={5}
                max={480}
                value={form.maxBackdateMinutes}
                onChange={(e) =>
                  setForm({
                    ...form,
                    maxBackdateMinutes: parseInt(e.target.value, 10) || 120,
                  })
                }
                className="h-8 font-mono-display text-xs"
              />
            </div>
          </div>
        )}

        <ToggleRow
          id="promptDescriptionOnStop"
          label="Open Wrap-Up note after stopping"
          hint="Prompts for what you worked on right after you hit End Session."
          checked={form.promptDescriptionOnStop}
          onCheckedChange={(checked) =>
            setForm({ ...form, promptDescriptionOnStop: checked })
          }
        />

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
          <div>
            <Label htmlFor="idleThreshold" className="text-xs font-medium">
              Idle auto-stop threshold
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Automatically stop running timer after idle minutes
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              id="idleThreshold"
              type="number"
              min={1}
              max={120}
              value={form.idleThresholdMinutes}
              onChange={(e) =>
                setForm({
                  ...form,
                  idleThresholdMinutes: parseInt(e.target.value, 10) || 10,
                })
              }
              className="h-8 w-20 text-center font-mono-display text-xs"
            />
            <span className="text-xs text-muted-foreground">min</span>
          </div>
        </div>
      </Section>

      {/* No-Timer Reminders */}
      <Section title="No-Timer Reminders">
        <ToggleRow
          id="noTimerWarningEnabled"
          label="Notify when working without a timer"
          checked={form.noTimerWarningEnabled}
          onCheckedChange={(checked) =>
            setForm({ ...form, noTimerWarningEnabled: checked })
          }
        />

        {form.noTimerWarningEnabled && (
          <div className="space-y-3 border-t border-white/[0.06] pt-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="noTimerMins" className="text-xs">
                Notify after active for
              </Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="noTimerMins"
                  type="number"
                  min={1}
                  max={120}
                  value={form.noTimerWarningMinutes}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      noTimerWarningMinutes: parseInt(e.target.value, 10) || 10,
                    })
                  }
                  className="h-8 w-20 text-center font-mono-display text-xs"
                />
                <span className="text-xs text-muted-foreground">min</span>
              </div>
            </div>

            <ToggleRow
              id="noTimerRepeat"
              label="Repeat reminders at intervals"
              hint="If off, notifies once per active session"
              checked={form.noTimerWarningRepeat}
              onCheckedChange={(checked) =>
                setForm({ ...form, noTimerWarningRepeat: checked })
              }
            />

            <ToggleRow
              id="noTimerWorkHours"
              label="Repeat only during work hours"
              checked={form.noTimerWarningRepeatOnlyDuringWorkHours}
              disabled={!form.noTimerWarningRepeat}
              onCheckedChange={(checked) =>
                setForm({
                  ...form,
                  noTimerWarningRepeatOnlyDuringWorkHours: checked,
                })
              }
            />
          </div>
        )}
      </Section>

      {/* Work Schedule */}
      <Section
        title="Work Schedule"
        description="Drives daily/weekly progress bars and Insights work-hours filtering."
      >
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="expectedHours" className="text-xs">
            Daily target
          </Label>
          <div className="flex items-center gap-1.5">
            <Input
              id="expectedHours"
              type="number"
              min={0.5}
              max={24}
              step={0.25}
              value={form.expectedHoursPerDay}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setForm({
                  ...form,
                  expectedHoursPerDay: Number.isFinite(v) ? v : 8,
                });
              }}
              className="h-8 w-20 text-center font-mono-display text-xs"
            />
            <span className="text-xs text-muted-foreground">hrs</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Workdays</Label>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((day) => {
              const active = form.workdays.includes(day.value);
              const isOnly = active && form.workdays.length === 1;
              return (
                <button
                  key={day.value}
                  type="button"
                  disabled={isOnly}
                  onClick={() => {
                    if (active) {
                      if (form.workdays.length <= 1) return;
                      setForm({
                        ...form,
                        workdays: form.workdays.filter((d) => d !== day.value),
                      });
                    } else {
                      setForm({
                        ...form,
                        workdays: [...form.workdays, day.value].sort(
                          (a, b) => a - b
                        ),
                      });
                    }
                  }}
                  className={cn(
                    "rounded-lg border py-1.5 text-[11px] font-medium transition-colors",
                    active
                      ? "border-primary/50 bg-primary/20 text-foreground"
                      : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:text-foreground",
                    isOnly && "opacity-70"
                  )}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="workStart" className="text-[11px] text-muted-foreground">
              Start time
            </Label>
            <Input
              id="workStart"
              type="time"
              value={form.workdayStart}
              onChange={(e) => setForm({ ...form, workdayStart: e.target.value })}
              className="h-9 font-mono-display text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="workEnd" className="text-[11px] text-muted-foreground">
              End time
            </Label>
            <Input
              id="workEnd"
              type="time"
              value={form.workdayEnd}
              onChange={(e) => setForm({ ...form, workdayEnd: e.target.value })}
              className="h-9 font-mono-display text-xs"
            />
          </div>
        </div>
      </Section>

      {/* Integrations & Display */}
      <Section title="Integrations & Display">
        <ToggleRow
          id="widgetEnabled"
          label="Floating timer pill"
          hint="Always-on-top compact pill with 1-click Start / Stop."
          checked={form.widgetEnabled}
          onCheckedChange={(checked) =>
            setForm({ ...form, widgetEnabled: checked })
          }
        />

        <ToggleRow
          id="meetingDetection"
          label="Detect meetings (macOS)"
          hint="Prompts to switch to a meeting timer when Zoom, Meet, Teams, or Slack Huddles are active."
          checked={form.meetingDetectionEnabled}
          onCheckedChange={(checked) =>
            setForm({ ...form, meetingDetectionEnabled: checked })
          }
        />

        <div className="space-y-3 border-t border-white/[0.06] pt-3">
          <p className="text-xs font-medium text-foreground">
            GitHub Pull Requests <span className="text-muted-foreground font-normal">(optional)</span>
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="ghToken" className="text-[11px] text-muted-foreground">
              Personal Access Token (repo scope)
            </Label>
            <div className="flex gap-2">
              <Input
                id="ghToken"
                type={showGithubToken ? "text" : "password"}
                value={form.githubToken ?? ""}
                onChange={(e) =>
                  setForm({ ...form, githubToken: e.target.value })
                }
                placeholder="ghp_..."
                autoComplete="off"
                className="h-9 flex-1 font-mono-display text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowGithubToken((v) => !v)}
                aria-label={showGithubToken ? "Hide GitHub token" : "Show GitHub token"}
              >
                {showGithubToken ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ghUser" className="text-[11px] text-muted-foreground">
              GitHub Username
            </Label>
            <Input
              id="ghUser"
              type="text"
              value={form.githubUsername ?? ""}
              onChange={(e) =>
                setForm({ ...form, githubUsername: e.target.value })
              }
              placeholder="octocat"
              className="h-9 text-xs"
            />
          </div>
        </div>
      </Section>

      {/* Updates */}
      <Section title="App & Updates">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono-display text-xs font-semibold text-foreground">
              v{updater.currentVersion}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {updater.statusMessage} · Checked {lastCheckedText}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void updater.checkForUpdates()}
            disabled={updater.isChecking || updater.isUpdating}
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                (updater.isChecking || updater.isUpdating) && "animate-spin"
              )}
            />
            {updater.isChecking
              ? "Checking..."
              : updater.isUpdating
              ? "Updating..."
              : "Check"}
          </Button>
        </div>

        {updater.progress && updater.progress.total && (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${Math.round(
                    (updater.progress.downloaded / updater.progress.total) * 100
                  )}%`,
                }}
              />
            </div>
            <p className="font-mono-display text-[10px] text-muted-foreground">
              {Math.round(updater.progress.downloaded / 1024)} KB /{" "}
              {Math.round(updater.progress.total / 1024)} KB
            </p>
          </div>
        )}
        {updater.error && (
          <p className="text-xs text-destructive">{updater.error}</p>
        )}
      </Section>

      {/* Sticky Save CTA */}
      <div className="sticky bottom-2 pt-1">
        <Button
          type="submit"
          size="lg"
          className="w-full font-semibold"
          disabled={saving}
        >
          {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
        </Button>
      </div>
    </form>
  );
}
