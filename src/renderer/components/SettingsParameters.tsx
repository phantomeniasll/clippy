import { useCallback, useEffect, useState } from "react";
import { clippyApi } from "../clippyApi";
import { useSharedState } from "../contexts/SharedStateContext";
import { DEFAULT_SYSTEM_PROMPT } from "../../sharedState";
import type { ReasoningEffort } from "../../sharedState";
import { Checkbox } from "./Checkbox";

export const SettingsParameters: React.FC = () => {
  const { settings } = useSharedState();
  const [tempSystemPrompt, setTempSystemPrompt] = useState(
    settings.systemPrompt,
  );
  const [tempTopK, setTempTopK] = useState(settings.topK);
  const [tempTemperature, setTempTemperature] = useState(settings.temperature);
  const [tempUseMtp, setTempUseMtp] = useState(settings.useMtp ?? true);
  const [tempReasoningEffort, setTempReasoningEffort] =
    useState<ReasoningEffort>(settings.reasoningEffort ?? "xhigh");

  // Update settings on unmount so that the user editing preferences
  // doesn't rapidly reload the model
  useEffect(() => {
    return () => {
      const isNewSettings =
        tempSystemPrompt !== settings.systemPrompt ||
        tempTopK !== settings.topK ||
        tempTemperature !== settings.temperature ||
        tempUseMtp !== settings.useMtp ||
        tempReasoningEffort !== settings.reasoningEffort;

      if (isNewSettings) {
        clippyApi.setState("settings", {
          ...settings,
          systemPrompt: tempSystemPrompt,
          topK: tempTopK,
          temperature: tempTemperature,
          useMtp: tempUseMtp,
          reasoningEffort: tempReasoningEffort,
        });
      }
    };
  }, [
    tempSystemPrompt,
    tempTopK,
    tempTemperature,
    tempUseMtp,
    tempReasoningEffort,
  ]);

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
          Compatible Gemma 4, Qwen3.6, and Qwen3.8 models always use the modern
          Vulkan llama.cpp backend. This option controls whether their MTP
          acceleration is enabled.
        </p>
        <div className="field-row">
          <label htmlFor="reasoningEffort">Reasoning effort</label>
          <select
            id="reasoningEffort"
            value={tempReasoningEffort}
            onChange={(event) =>
              setTempReasoningEffort(event.target.value as ReasoningEffort)
            }
          >
            <option value="off">Direct (thinking off)</option>
            <option value="low">Low (fast)</option>
            <option value="medium">Medium (balanced)</option>
            <option value="xhigh">Extra high (thorough)</option>
          </select>
        </div>
        <p>
          Qwen3.8 applies these official reasoning presets per request. Extra
          high is the model's default.
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
