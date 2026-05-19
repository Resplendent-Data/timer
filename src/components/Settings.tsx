/**
 * Settings component for configuring ClickUp integration.
 */

import { useState, useEffect, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff, RefreshCw, Save } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { UseUpdaterResult } from "../hooks/useUpdater";
import {
  getSettings,
  saveSettings,
  AppSettings,
  DEFAULT_EXPECTED_HOURS_PER_DAY,
  DEFAULT_WORK_DAYS,
} from "../lib/store";

interface SettingsProps {
  onSave?: () => void;
  updater: UseUpdaterResult;
}

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Mon" },
  { value: 1, label: "Tue" },
  { value: 2, label: "Wed" },
  { value: 3, label: "Thu" },
  { value: 4, label: "Fri" },
  { value: 5, label: "Sat" },
  { value: 6, label: "Sun" },
];

function SettingsSection({
  title,
  description,
  children,
}: SettingsSectionProps) {
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle className="brutalist-label">{title}</CardTitle>
        {description && (
          <CardDescription className="text-xs leading-relaxed">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4 px-4">{children}</CardContent>
    </Card>
  );
}

export function Settings({ onSave, updater }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>({
    clickupApiKey: "",
    clickupTeamId: "",
    idleThresholdMinutes: 10,
    noTimerWarningEnabled: true,
    noTimerWarningMinutes: 10,
    noTimerWarningRepeat: false,
    noTimerWarningRepeatOnlyDuringWorkHours: true,
    meetingDetectionEnabled: false,
    widgetEnabled: false,
    workdayStart: "08:00",
    workdayEnd: "17:00",
    workdays: [...DEFAULT_WORK_DAYS],
    expectedHoursPerDay: DEFAULT_EXPECTED_HOURS_PER_DAY,
    githubToken: "",
    githubUsername: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastCheckedText =
    updater.lastCheckedAt === null
      ? "Never"
      : new Date(updater.lastCheckedAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        });

  useEffect(() => {
    async function loadSettings() {
      try {
        const stored = await getSettings();
        if (stored) {
          setSettings(stored);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
        setError("Failed to load settings");
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      if (!settings.clickupApiKey.trim()) {
        throw new Error("API Key is required");
      }
      if (!settings.clickupTeamId.trim()) {
        throw new Error("Team ID is required");
      }
      if (settings.idleThresholdMinutes < 1) {
        throw new Error("Idle threshold must be at least 1 minute");
      }
      if (settings.noTimerWarningEnabled && settings.noTimerWarningMinutes < 1) {
        throw new Error("No timer warning threshold must be at least 1 minute");
      }
      const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!timePattern.test(settings.workdayStart)) {
        throw new Error("Workday start must be in HH:MM (24h) format");
      }
      if (!timePattern.test(settings.workdayEnd)) {
        throw new Error("Workday end must be in HH:MM (24h) format");
      }
      if (settings.workdayStart === settings.workdayEnd) {
        throw new Error("Workday start and end cannot be the same");
      }
      if (settings.workdays.length === 0) {
        throw new Error("Select at least one workday");
      }
      if (settings.expectedHoursPerDay <= 0) {
        throw new Error("Expected hours per day must be greater than 0");
      }

      await saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSave?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="py-8">
        <CardContent className="flex items-center justify-center px-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pb-2">
      <SettingsSection
        title="ClickUp"
        description="Credentials and idle-stop behavior for ClickUp timers."
      >
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="apiKey" className="text-xs uppercase tracking-wider">
            API Key
          </Label>
          <div className="flex gap-2">
            <Input
              id="apiKey"
              type={showApiKey ? "text" : "password"}
              value={settings.clickupApiKey}
              onChange={(e) =>
                setSettings({ ...settings, clickupApiKey: e.target.value })
              }
              placeholder="pk_..."
              autoComplete="off"
              className="flex-1 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setShowApiKey(!showApiKey)}
              aria-label={showApiKey ? "Hide API key" : "Show API key"}
              title={showApiKey ? "Hide API key" : "Show API key"}
            >
              {showApiKey ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Get from{" "}
            <a
              href="https://app.clickup.com/settings/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              ClickUp Settings &rarr; Apps
            </a>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="teamId" className="text-xs uppercase tracking-wider">
            Team ID
          </Label>
          <Input
            id="teamId"
            type="text"
            value={settings.clickupTeamId}
            onChange={(e) =>
              setSettings({ ...settings, clickupTeamId: e.target.value })
            }
            placeholder="123456789"
            className="text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            From URL: app.clickup.com/<strong>[team_id]</strong>/...
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="threshold" className="text-xs uppercase tracking-wider">
            Idle Threshold (minutes)
          </Label>
          <Input
            id="threshold"
            type="number"
            value={settings.idleThresholdMinutes}
            onChange={(e) =>
              setSettings({
                ...settings,
                idleThresholdMinutes: parseInt(e.target.value) || 10,
              })
            }
            min={1}
            max={120}
            className="w-24 text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            Stop timer after this many idle minutes
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        title="GitHub"
        description="Optional PR counts shown on the timer screen."
      >
        <div className="space-y-2">
          <Label htmlFor="githubToken" className="text-xs uppercase tracking-wider">
            Personal Access Token
          </Label>
          <div className="flex gap-2">
            <Input
              id="githubToken"
              type={showGithubToken ? "text" : "password"}
              value={settings.githubToken ?? ""}
              onChange={(e) =>
                setSettings({ ...settings, githubToken: e.target.value })
              }
              placeholder="ghp_..."
              autoComplete="off"
              className="flex-1 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setShowGithubToken(!showGithubToken)}
              aria-label={showGithubToken ? "Hide GitHub token" : "Show GitHub token"}
              title={showGithubToken ? "Hide GitHub token" : "Show GitHub token"}
            >
              {showGithubToken ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Needs <strong>repo</strong> scope.{" "}
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Create token
            </a>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="githubUsername" className="text-xs uppercase tracking-wider">
            Username
          </Label>
          <Input
            id="githubUsername"
            type="text"
            value={settings.githubUsername ?? ""}
            onChange={(e) =>
              setSettings({ ...settings, githubUsername: e.target.value })
            }
            placeholder="octocat"
            className="text-sm"
          />
        </div>
      </SettingsSection>

      <SettingsSection title="No Timer Warning">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="noTimerWarningEnabled" className="text-sm">
              Warn if no timer running
            </Label>
          </div>
          <Switch
            id="noTimerWarningEnabled"
            checked={settings.noTimerWarningEnabled}
            onCheckedChange={(checked) =>
              setSettings({
                ...settings,
                noTimerWarningEnabled: checked,
              })
            }
          />
        </div>

        {settings.noTimerWarningEnabled && (
          <>
            <Separator />

            <div className="space-y-2">
              <Label
                htmlFor="noTimerWarningMinutes"
                className="text-xs uppercase tracking-wider"
              >
                Warn after (minutes)
              </Label>
              <Input
                id="noTimerWarningMinutes"
                type="number"
                value={settings.noTimerWarningMinutes}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    noTimerWarningMinutes: parseInt(e.target.value) || 10,
                  })
                }
                min={1}
                max={120}
                className="w-24 text-sm"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="noTimerWarningRepeat" className="text-sm">
                  Repeat at intervals
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  If off, warns once until timer starts
                </p>
              </div>
              <Switch
                id="noTimerWarningRepeat"
                checked={settings.noTimerWarningRepeat}
                onCheckedChange={(checked) =>
                  setSettings({
                    ...settings,
                    noTimerWarningRepeat: checked,
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label
                  htmlFor="noTimerWarningRepeatOnlyDuringWorkHours"
                  className="text-sm"
                >
                  Repeat only during work hours
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Uses Work Hours workdays and start/end below.
                </p>
              </div>
              <Switch
                id="noTimerWarningRepeatOnlyDuringWorkHours"
                checked={settings.noTimerWarningRepeatOnlyDuringWorkHours}
                disabled={!settings.noTimerWarningRepeat}
                onCheckedChange={(checked) =>
                  setSettings({
                    ...settings,
                    noTimerWarningRepeatOnlyDuringWorkHours: checked,
                  })
                }
              />
            </div>
          </>
        )}
      </SettingsSection>

      <SettingsSection title="Meeting Mode">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="meetingDetectionEnabled" className="text-sm">
              Detect meetings and prompt
            </Label>
            <p className="text-[10px] text-muted-foreground">
              macOS-only v1. Uses foreground app/tab title matching.
            </p>
          </div>
          <Switch
            id="meetingDetectionEnabled"
            checked={settings.meetingDetectionEnabled}
            onCheckedChange={(checked) =>
              setSettings({
                ...settings,
                meetingDetectionEnabled: checked,
              })
            }
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Display">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="widgetEnabled" className="text-sm">
              Floating widget
            </Label>
            <p className="text-[10px] text-muted-foreground">
              Always-on-top timer display
            </p>
          </div>
          <Switch
            id="widgetEnabled"
            checked={settings.widgetEnabled}
            onCheckedChange={(checked) =>
              setSettings({
                ...settings,
                widgetEnabled: checked,
              })
            }
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Work Hours"
        description="Stats only count active/idle time within this local time window. Overnight windows are supported."
      >
        <div className="space-y-2">
          <Label
            htmlFor="expectedHoursPerDay"
            className="text-xs uppercase tracking-wider"
          >
            Expected Hours / Day
          </Label>
          <Input
            id="expectedHoursPerDay"
            type="number"
            min={0.5}
            max={24}
            step={0.25}
            value={settings.expectedHoursPerDay}
            onChange={(e) => {
              const nextValue = parseFloat(e.target.value);
              setSettings({
                ...settings,
                expectedHoursPerDay: Number.isFinite(nextValue) ? nextValue : 0,
              });
            }}
            className="w-24 text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            Timer page progress uses this target and multiplies it by selected workdays.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider">Workdays</Label>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {WEEKDAY_OPTIONS.map((day) => {
              const checked = settings.workdays.includes(day.value);
              const isOnlySelected = checked && settings.workdays.length === 1;
              return (
                <label
                  key={day.value}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-input/20 px-2 py-1.5 text-xs transition-colors hover:bg-secondary/60"
                >
                  <Checkbox
                    checked={checked}
                    disabled={isOnlySelected}
                    onCheckedChange={(nextChecked) => {
                      const shouldEnable = nextChecked === true;
                      if (shouldEnable) {
                        setSettings({
                          ...settings,
                          workdays: Array.from(
                            new Set([...settings.workdays, day.value])
                          ).sort((a, b) => a - b),
                        });
                        return;
                      }

                      if (settings.workdays.length <= 1) {
                        return;
                      }

                      setSettings({
                        ...settings,
                        workdays: settings.workdays.filter(
                          (value) => value !== day.value
                        ),
                      });
                    }}
                    aria-label={`Workday ${day.label}`}
                  />
                  <span>{day.label}</span>
                </label>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Non-workdays are excluded from active/idle stat totals.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="workdayStart" className="text-xs uppercase tracking-wider">
              Start
            </Label>
            <Input
              id="workdayStart"
              type="time"
              value={settings.workdayStart}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  workdayStart: e.target.value,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workdayEnd" className="text-xs uppercase tracking-wider">
              End
            </Label>
            <Input
              id="workdayEnd"
              type="time"
              value={settings.workdayEnd}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  workdayEnd: e.target.value,
                })
              }
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Updates">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="space-y-0.5">
              <Label className="text-sm">Version</Label>
              <p className="text-xs text-muted-foreground">
                v{updater.currentVersion}
              </p>
            </div>
            <div className="space-y-0.5">
              <Label className="text-sm">Last checked</Label>
              <p className="text-xs text-muted-foreground">{lastCheckedText}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-w-[120px] text-xs uppercase tracking-wider"
            onClick={() => updater.checkForUpdates()}
            disabled={updater.isChecking || updater.isUpdating}
          >
            <RefreshCw
              className={updater.isChecking || updater.isUpdating ? "animate-spin" : ""}
            />
            {updater.isChecking
              ? "Checking..."
              : updater.isUpdating
              ? "Updating..."
              : "Check Updates"}
          </Button>
        </div>

        <Separator />

        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider">Status</Label>
          <p className="text-xs text-muted-foreground">
            {updater.statusMessage}
          </p>
          {updater.progress && updater.progress.total && (
            <div className="mt-2">
              <Progress
                value={Math.round(
                  (updater.progress.downloaded / updater.progress.total) * 100
                )}
                className="h-2"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {Math.round(updater.progress.downloaded / 1024)} KB /{" "}
                {Math.round(updater.progress.total / 1024)} KB
              </p>
            </div>
          )}
          {updater.error && (
            <p className="text-xs text-destructive">{updater.error}</p>
          )}
        </div>
      </SettingsSection>

      <Button
        type="submit"
        className="h-11 w-full text-sm font-semibold uppercase tracking-wider"
        disabled={saving}
      >
        <Save className="h-4 w-4" />
        {saving ? "Saving..." : saved ? "Saved" : "Save Settings"}
      </Button>
    </form>
  );
}
