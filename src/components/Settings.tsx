/**
 * Settings component for configuring ClickUp integration.
 *
 * Allows users to enter their ClickUp API key, team ID, and
 * configure the idle timeout threshold.
 */

import { useState, useEffect, FormEvent } from "react";
import { getSettings, saveSettings, AppSettings } from "../lib/store";
import { useUpdater } from "../hooks/useUpdater";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">ClickUp Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive text-destructive text-sm">
              {error}
            </div>
          )}

          {/* API Key */}
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
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
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? "Hide" : "Show"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Get your API key from{" "}
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
            <Label htmlFor="teamId">Team ID</Label>
            <Input
              id="teamId"
              type="text"
              value={settings.clickupTeamId}
              onChange={(e) =>
                setSettings({ ...settings, clickupTeamId: e.target.value })
              }
              placeholder="123456789"
            />
            <p className="text-xs text-muted-foreground">
              Find your Team ID in the ClickUp URL: app.clickup.com/
              <strong>[team_id]</strong>/...
            </p>
          </div>

          {/* Idle Threshold */}
          <div className="space-y-2">
            <Label htmlFor="threshold">Idle Threshold (minutes)</Label>
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
              className="w-24"
            />
            <p className="text-xs text-muted-foreground">
              Timer will be stopped after this many minutes of inactivity
            </p>
          </div>
        </CardContent>
      </Card>

      {/* No Timer Warning Section */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">No Timer Warning</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Enable Warning */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="noTimerWarningEnabled">
                Warn me if no timer is running
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

              {/* Warning Threshold */}
              <div className="space-y-2">
                <Label htmlFor="noTimerWarningMinutes">
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
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  Time of activity without a timer before warning
                </p>
              </div>

              {/* Repeat Warning */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="noTimerWarningRepeat">
                    Repeat warning at intervals
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    If disabled, warns once until you start a timer
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
        </CardContent>
      </Card>

      {/* Updates Section */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Updates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>App Version</Label>
              <p className="text-sm text-muted-foreground">
                v{updater.currentVersion}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => updater.checkForUpdates()}
              disabled={updater.isChecking || updater.isUpdating}
            >
              {updater.isChecking
                ? "Checking..."
                : updater.isUpdating
                ? "Updating..."
                : "Check for Updates"}
            </Button>
          </div>

          <Separator />

          <div className="space-y-1">
            <Label>Status</Label>
            <p className="text-sm text-muted-foreground">
              {updater.statusMessage}
            </p>
            {updater.progress && updater.progress.total && (
              <div className="mt-2">
                <div className="h-2 bg-muted rounded-full overflow-hidden">
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
                <p className="text-xs text-muted-foreground mt-1">
                  {Math.round(updater.progress.downloaded / 1024)} KB /{" "}
                  {Math.round(updater.progress.total / 1024)} KB
                </p>
              </div>
            )}
            {updater.error && (
              <p className="text-sm text-destructive">{updater.error}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
      </Button>
    </form>
  );
}
