/**
 * Settings component for configuring ClickUp integration.
 *
 * Brutalist design with clear sections and visible structure.
 */

import { useState, useEffect, FormEvent } from "react";
import { getSettings, saveSettings, AppSettings } from "../lib/store";
import { useUpdater } from "../hooks/useUpdater";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface SettingsProps {
  onSave?: () => void;
}

export function Settings({ onSave }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>({
    clickupApiKey: "",
    clickupTeamId: "",
    idleThresholdMinutes: 10,
    noTimerWarningEnabled: true,
    noTimerWarningMinutes: 10,
    noTimerWarningRepeat: false,
    widgetEnabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-updater
  const updater = useUpdater();

  // Load settings on mount
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
      // Validate required fields
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
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* ClickUp Settings */}
      <div className="brutalist-border p-4 space-y-4">
        <div className="brutalist-label">ClickUp</div>

        {error && (
          <div className="p-3 bg-destructive/10 border-2 border-destructive text-destructive text-sm font-mono-display">
            {error}
          </div>
        )}

        {/* API Key */}
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
              className="flex-1 font-mono-display text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowApiKey(!showApiKey)}
              className="text-xs uppercase tracking-wider"
            >
              {showApiKey ? "Hide" : "Show"}
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

        {/* Team ID */}
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
            className="font-mono-display text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            From URL: app.clickup.com/<strong>[team_id]</strong>/...
          </p>
        </div>

        {/* Idle Threshold */}
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
            className="w-24 font-mono-display text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            Stop timer after this many idle minutes
          </p>
        </div>
      </div>

      {/* No Timer Warning Section */}
      <div className="brutalist-border p-4 space-y-4">
        <div className="brutalist-label">No Timer Warning</div>

        {/* Enable Warning */}
        <div className="flex items-center justify-between">
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
            <div className="brutalist-divider" />

            {/* Warning Threshold */}
            <div className="space-y-2">
              <Label htmlFor="noTimerWarningMinutes" className="text-xs uppercase tracking-wider">
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
                className="w-24 font-mono-display text-sm"
              />
            </div>

            {/* Repeat Warning */}
            <div className="flex items-center justify-between">
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
          </>
        )}
      </div>

      {/* Display Section */}
      <div className="brutalist-border p-4 space-y-4">
        <div className="brutalist-label">Display</div>

        {/* Floating Widget */}
        <div className="flex items-center justify-between">
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
      </div>

      {/* Updates Section */}
      <div className="brutalist-border p-4 space-y-4">
        <div className="brutalist-label">Updates</div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm">Version</Label>
            <p className="text-xs text-muted-foreground font-mono-display">
              v{updater.currentVersion}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-w-[120px] text-xs uppercase tracking-wider"
            onClick={() => updater.checkForUpdates()}
            disabled={updater.isChecking || updater.isUpdating}
          >
            {updater.isChecking
              ? "Checking..."
              : updater.isUpdating
              ? "Updating..."
              : "Check Updates"}
          </Button>
        </div>

        <div className="brutalist-divider" />

        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider">Status</Label>
          <p className="text-xs text-muted-foreground">
            {updater.statusMessage}
          </p>
          {updater.progress && updater.progress.total && (
            <div className="mt-2">
              <div className="h-2 bg-muted brutalist-border overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${Math.round(
                      (updater.progress.downloaded / updater.progress.total) *
                        100
                    )}%`,
                  }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 font-mono-display">
                {Math.round(updater.progress.downloaded / 1024)} KB /{" "}
                {Math.round(updater.progress.total / 1024)} KB
              </p>
            </div>
          )}
          {updater.error && (
            <p className="text-xs text-destructive font-mono-display">{updater.error}</p>
          )}
        </div>
      </div>

      <Button 
        type="submit" 
        className="w-full h-11 text-sm font-semibold uppercase tracking-wider" 
        disabled={saving}
      >
        {saving ? "Saving..." : saved ? "Saved" : "Save Settings"}
      </Button>
    </form>
  );
}
