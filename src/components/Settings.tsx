/**
 * Settings component for configuring ClickUp integration.
 *
 * Allows users to enter their ClickUp API key, team ID, and
 * configure the idle timeout threshold.
 */

import { useState, useEffect, FormEvent } from "react";
import { getSettings, saveSettings, AppSettings } from "../lib/store";

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
      <div className="settings settings--loading">
        <p>Loading settings...</p>
      </div>
    );
  }

  return (
    <form className="settings" onSubmit={handleSubmit}>
      <h2>ClickUp Settings</h2>

      {error && <div className="settings__error">{error}</div>}

      <div className="settings__field">
        <label htmlFor="apiKey">API Key</label>
        <div className="settings__input-group">
          <input
            id="apiKey"
            type={showApiKey ? "text" : "password"}
            value={settings.clickupApiKey}
            onChange={(e) =>
              setSettings({ ...settings, clickupApiKey: e.target.value })
            }
            placeholder="pk_..."
            autoComplete="off"
          />
          <button
            type="button"
            className="settings__toggle-visibility"
            onClick={() => setShowApiKey(!showApiKey)}
            title={showApiKey ? "Hide API key" : "Show API key"}
          >
            {showApiKey ? "Hide" : "Show"}
          </button>
        </div>
        <p className="settings__hint">
          Get your API key from{" "}
          <a
            href="https://app.clickup.com/settings/apps"
            target="_blank"
            rel="noopener noreferrer"
          >
            ClickUp Settings → Apps
          </a>
        </p>
      </div>

      <div className="settings__field">
        <label htmlFor="teamId">Team ID</label>
        <input
          id="teamId"
          type="text"
          value={settings.clickupTeamId}
          onChange={(e) =>
            setSettings({ ...settings, clickupTeamId: e.target.value })
          }
          placeholder="123456789"
        />
        <p className="settings__hint">
          Find your Team ID in the ClickUp URL: app.clickup.com/
          <strong>[team_id]</strong>/...
        </p>
      </div>

      <div className="settings__field">
        <label htmlFor="threshold">Idle Threshold (minutes)</label>
        <input
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
        />
        <p className="settings__hint">
          Timer will be stopped after this many minutes of inactivity
        </p>
      </div>

      <h3>No Timer Warning</h3>

      <div className="settings__field settings__field--checkbox">
        <label htmlFor="noTimerWarningEnabled">
          <input
            id="noTimerWarningEnabled"
            type="checkbox"
            checked={settings.noTimerWarningEnabled}
            onChange={(e) =>
              setSettings({
                ...settings,
                noTimerWarningEnabled: e.target.checked,
              })
            }
          />
          Warn me if no timer is running
        </label>
      </div>

      {settings.noTimerWarningEnabled && (
        <>
          <div className="settings__field">
            <label htmlFor="noTimerWarningMinutes">
              Warn after (minutes)
            </label>
            <input
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
            />
            <p className="settings__hint">
              Time of activity without a timer before warning
            </p>
          </div>

          <div className="settings__field settings__field--checkbox">
            <label htmlFor="noTimerWarningRepeat">
              <input
                id="noTimerWarningRepeat"
                type="checkbox"
                checked={settings.noTimerWarningRepeat}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    noTimerWarningRepeat: e.target.checked,
                  })
                }
              />
              Repeat warning at intervals
            </label>
            <p className="settings__hint">
              If disabled, warns once until you start a timer
            </p>
          </div>
        </>
      )}

      <button
        type="submit"
        className="settings__submit"
        disabled={saving}
      >
        {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
      </button>
    </form>
  );
}
