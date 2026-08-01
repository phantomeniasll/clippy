import { useCallback, useEffect, useState } from "react";
import { clippyApi } from "../clippyApi";
import { useSharedState } from "../contexts/SharedStateContext";
import { DEFAULT_SYSTEM_PROMPT } from "../../sharedState";
import { Checkbox } from "./Checkbox";

export const SettingsParameters: React.FC = () => {
  const { settings } = useSharedState();
  const [tempSystemPrompt, setTempSystemPrompt] = useState(
    settings.systemPrompt,
  );
  const [tempTopK, setTempTopK] = useState(settings.topK);
  const [tempTemperature, setTempTemperature] = useState(settings.temperature);
  const [tempUseMtp, setTempUseMtp] = useState(settings.useMtp ?? false);

  // Update settings on unmount so that the user editing preferences
  // doesn't rapidly reload the model
  useEffect(() => {
    return () => {
      const isNewSettings =
        tempSystemPrompt !== settings.systemPrompt ||
        tempTopK !== settings.topK ||
        tempTemperature !== settings.temperature ||
        tempUseMtp !== settings.useMtp;

      if (isNewSettings) {
        clippyApi.setState("settings", {
          ...settings,
          systemPrompt: tempSystemPrompt,
          topK: tempTopK,
          temperature: tempTemperature,
          useMtp: tempUseMtp,
        });
      }
    };
  }, [tempSystemPrompt, tempTopK, tempTemperature, tempUseMtp]);

  const handleSystemPromptReset = useCallback(() => {
    const confirmed = window.confirm(
      "Are you sure you want to reset the system prompt to the default? This will overwrite any customizations you have made.",
    );

    if (confirmed) {
      setTempSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    }
  }, []);

  return (
    <>
      <fieldset>
        <legend>Prompts</legend>
        <div className="field-row-stacked">
          <label htmlFor="systemPrompt">
            System Prompt. The key "[LIST OF ANIMATIONS]" will be automatically
            replaced by a full list of all available animations.
          </label>
          <textarea
            id="systemPrompt"
            rows={8}
            style={{ resize: "vertical" }}
            value={tempSystemPrompt}
            onChange={(e) => {
              setTempSystemPrompt(e.target.value);
            }}
          />
        </div>
        <div className="field-row-stacked">
          <button onClick={handleSystemPromptReset} style={{ width: 100 }}>
            Reset
          </button>
        </div>
      </fieldset>
      <fieldset style={{ marginTop: "20px" }}>
        <legend>Parameters</legend>
        <Checkbox
          id="useMtp"
          label="Enable multi-token prediction (MTP) when supported"
          checked={tempUseMtp}
          onChange={setTempUseMtp}
        />
        <p>
          Uses the modern Vulkan llama.cpp backend for compatible Gemma 4 and
          Qwen3.6 models. Other models continue to use Clippy's normal backend.
        </p>
        <div className="field-row">
          <label htmlFor="topK">Top K</label>
          <input
            id="topK"
            type="number"
            value={tempTopK}
            step="0.1"
            onChange={(e) => setTempTopK(parseFloat(e.target.value))}
          />
        </div>
        <div className="field-row">
          <label htmlFor="temperature">Temperature</label>
          <input
            id="temperature"
            type="number"
            value={tempTemperature}
            step="0.1"
            onChange={(e) => setTempTemperature(parseFloat(e.target.value))}
          />
        </div>
      </fieldset>
    </>
  );
};
