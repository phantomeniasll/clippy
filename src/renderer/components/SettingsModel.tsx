import { Column, TableView } from "./TableView";
import { Progress } from "./Progress";
import React, { useState } from "react";
import { useSharedState } from "../contexts/SharedStateContext";
import { clippyApi } from "../clippyApi";
import { prettyDownloadSpeed } from "../helpers/convert-download-speed";
import { HuggingFaceModelFile, ManagedModel } from "../../models";
import { isModelDownloading } from "../../helpers/model-helpers";
import { useChat } from "../contexts/ChatContext";

export const SettingsModel: React.FC = () => {
  const { models, settings } = useSharedState();
  const {
    isModelLoaded,
    isModelLoading,
    loadedModelName,
    loadModel,
    unloadModel,
  } = useChat();
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [huggingFaceSource, setHuggingFaceSource] = useState("");
  const [huggingFaceFiles, setHuggingFaceFiles] = useState<
    HuggingFaceModelFile[]
  >([]);
  const [selectedHuggingFaceFile, setSelectedHuggingFaceFile] = useState(0);
  const [isResolvingHuggingFace, setIsResolvingHuggingFace] = useState(false);
  const [huggingFaceError, setHuggingFaceError] = useState<string>();

  const columns: Array<Column> = [
    { key: "status", header: "Status", width: 65 },
    { key: "name", header: "Name" },
    {
      key: "size",
      header: "Size",
      render: (row) => `${row.size.toLocaleString()} MB`,
    },
    { key: "company", header: "Company" },
    { key: "downloaded", header: "Downloaded" },
  ];

  const modelKeys = Object.keys(models || {});
  const data = modelKeys.map((modelKey) => {
    const model = models?.[modelKey as keyof typeof models];

    return {
      status:
        model?.name === loadedModelName && isModelLoaded
          ? "Loaded"
          : model?.name === settings.selectedModel
            ? "Selected"
            : "",
      name: model?.name,
      company: model?.company,
      size: model?.size,
      downloaded: model.downloaded ? "Yes" : "No",
    };
  });

  // Variables
  const selectedModel =
    models?.[modelKeys[selectedIndex] as keyof typeof models] || null;
  const isDownloading = isModelDownloading(selectedModel);
  const isDefaultModel = selectedModel?.name === settings.selectedModel;
  const isLoadedModel =
    isModelLoaded && selectedModel?.name === loadedModelName;

  // Handlers
  // ---------------------------------------------------------------------------
  const handleRowSelect = (index: number) => {
    setSelectedIndex(index);
  };

  const handleDownload = async () => {
    if (selectedModel) {
      await clippyApi.downloadModelByName(data[selectedIndex].name);
    }
  };

  const handleDeleteOrRemove = async () => {
    if (isLoadedModel) {
      await unloadModel();
    }

    if (selectedModel?.imported) {
      await clippyApi.removeModelByName(selectedModel.name);
    } else if (selectedModel) {
      await clippyApi.deleteModelByName(selectedModel.name);
    }
  };

  const handleMakeDefault = async () => {
    if (selectedModel) {
      if (loadedModelName && loadedModelName !== selectedModel.name) {
        await unloadModel();
      }

      await clippyApi.setState("settings.selectedModel", selectedModel.name);
    }
  };

  const handleResolveHuggingFace = async () => {
    setIsResolvingHuggingFace(true);
    setHuggingFaceError(undefined);
    setHuggingFaceFiles([]);

    try {
      const files = await clippyApi.resolveHuggingFaceSource(huggingFaceSource);
      setHuggingFaceFiles(files);
      setSelectedHuggingFaceFile(0);
    } catch (error) {
      setHuggingFaceError(getErrorMessage(error));
    } finally {
      setIsResolvingHuggingFace(false);
    }
  };

  const handleAddHuggingFace = async () => {
    const file = huggingFaceFiles[selectedHuggingFaceFile];
    if (!file) return;

    setHuggingFaceError(undefined);
    try {
      const name = await clippyApi.addModelFromHuggingFace(file);
      const existingIndex = modelKeys.indexOf(name);
      setSelectedIndex(existingIndex >= 0 ? existingIndex : modelKeys.length);
      setHuggingFaceFiles([]);
      setHuggingFaceSource("");
    } catch (error) {
      setHuggingFaceError(getErrorMessage(error));
    }
  };

  const handleAddLocalFile = async () => {
    const name = await clippyApi.addModelFromFile();
    if (!name) return;

    const existingIndex = modelKeys.indexOf(name);
    setSelectedIndex(existingIndex >= 0 ? existingIndex : modelKeys.length);
  };

  return (
    <div>
      <p>
        Select the model you want to use for your chat. The larger the model,
        the more powerful the chat, but the slower it will be - and the more
        memory it will use. Clippy uses models in the GGUF format.{" "}
        <a
          href="https://github.com/felixrieseberg/clippy?tab=readme-ov-file#downloading-more-models"
          target="_blank"
        >
          More information.
        </a>
      </p>

      <fieldset style={{ marginBottom: 10 }}>
        <legend>Add a Hugging Face model</legend>
        <div className="field-row-stacked">
          <label htmlFor="huggingFaceSource">
            Repository name, link, or direct GGUF link
          </label>
          <input
            id="huggingFaceSource"
            placeholder="unsloth/Qwen3.8-27B-GGUF"
            value={huggingFaceSource}
            onChange={(event) => setHuggingFaceSource(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleResolveHuggingFace();
            }}
          />
        </div>
        <button
          disabled={isResolvingHuggingFace || !huggingFaceSource.trim()}
          onClick={() => void handleResolveHuggingFace()}
          style={{ marginTop: 8 }}
        >
          {isResolvingHuggingFace ? "Looking up files..." : "Choose model size"}
        </button>

        {huggingFaceFiles.length > 0 && (
          <div className="field-row-stacked" style={{ marginTop: 8 }}>
            <label htmlFor="huggingFaceFile">
              GGUF quant and download size
            </label>
            <select
              id="huggingFaceFile"
              value={selectedHuggingFaceFile}
              onChange={(event) =>
                setSelectedHuggingFaceFile(Number(event.target.value))
              }
            >
              {huggingFaceFiles.map((file, index) => (
                <option key={file.url} value={index}>
                  {file.filename} — {formatModelSize(file.size)}
                </option>
              ))}
            </select>
            <button
              onClick={() => void handleAddHuggingFace()}
              style={{ marginTop: 8, alignSelf: "flex-start" }}
            >
              Add and download
            </button>
          </div>
        )}

        {huggingFaceError && (
          <p style={{ color: "#800000" }}>{huggingFaceError}</p>
        )}
      </fieldset>

      <button
        style={{ marginBottom: 10 }}
        onClick={() => void handleAddLocalFile()}
      >
        Use a local GGUF file
      </button>
      <TableView
        columns={columns}
        data={data}
        onRowSelect={handleRowSelect}
        initialSelectedIndex={selectedIndex}
      />

      {selectedModel && (
        <div
          className="model-details sunken-panel"
          style={{ marginTop: "20px", padding: "15px" }}
        >
          <strong>{selectedModel.name}</strong>

          {selectedModel.description && <p>{selectedModel.description}</p>}

          {selectedModel.homepage && (
            <p>
              <a
                href={selectedModel.homepage}
                target="_blank"
                rel="noopener noreferrer"
              >
                Visit Homepage
              </a>
            </p>
          )}

          <div style={{ marginTop: "15px", display: "flex", gap: "10px" }}>
            {!selectedModel.downloaded ? (
              <button disabled={isDownloading} onClick={handleDownload}>
                Download Model
              </button>
            ) : (
              <>
                <button
                  disabled={isDownloading || isDefaultModel}
                  onClick={handleMakeDefault}
                >
                  {isDefaultModel
                    ? "Clippy uses this model"
                    : "Make Clippy use this model"}
                </button>
                {(isDefaultModel || isLoadedModel) && (
                  <button
                    disabled={isModelLoading}
                    onClick={() =>
                      void (isLoadedModel ? unloadModel() : loadModel())
                    }
                  >
                    {isModelLoading
                      ? "Loading..."
                      : isLoadedModel
                        ? "Unload Model"
                        : "Load Model"}
                  </button>
                )}
                <button onClick={handleDeleteOrRemove}>
                  {selectedModel?.imported ? "Remove" : "Delete"} Model
                </button>
              </>
            )}
          </div>
          <SettingsModelDownload model={selectedModel} />
        </div>
      )}
    </div>
  );
};

function formatModelSize(sizeInMegabytes: number): string {
  if (!sizeInMegabytes) return "size unknown";
  if (sizeInMegabytes < 1024) return `${sizeInMegabytes.toLocaleString()} MB`;
  return `${(sizeInMegabytes / 1000).toFixed(1)} GB`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const SettingsModelDownload: React.FC<{
  model?: ManagedModel;
}> = ({ model }) => {
  if (!model || !isModelDownloading(model)) {
    return null;
  }

  const downloadSpeed = prettyDownloadSpeed(
    model?.downloadState?.currentBytesPerSecond || 0,
  );

  return (
    <div style={{ marginTop: "15px" }}>
      <p>
        Downloading {model.name}... ({downloadSpeed}/s)
      </p>
      <Progress progress={model.downloadState?.percentComplete || 0} />
    </div>
  );
};
