import { app, DownloadItem, session, dialog } from "electron";
import path from "path";
import fs from "fs";
import { getLogger } from "./logger";

import { ManagedModel, ModelState, Model, BUILT_IN_MODELS } from "../models";
import { DownloadState } from "../sharedState";
import { getStateManager } from "./state";
import { MockDownloadItem } from "./MockDownloadItem";
import { getDebugManager } from "./debug";

class ModelManager {
  private downloadItems: Record<string, DownloadItem | MockDownloadItem> = {};

  constructor() {
    session.defaultSession.on("will-download", (event, downloadItem) =>
      this.onSessionWillDownload(event, downloadItem),
    );
  }

  private get models() {
    return getStateManager().store.get("models");
  }

  private set models(models: ModelState) {
    getStateManager().store.set("models", models);
  }

  /**
   * Returns a managed model from a model
   *
   * @param model
   * @returns
   */
  public getManagedModelFromModel(model: Model): ManagedModel {
    return {
      ...model,
      downloaded: this.getIsModelDownloaded(model),
      path: getModelPath(model),
      draftPath: model.draftUrl ? getModelDraftPath(model) : undefined,
    };
  }

  /**
   * Downloads a model by name
   *
   * @param name
   */
  public async downloadModelByName(name: string) {
    getLogger().info("Downloading model by name", name);

    const model = this.models[name];

    if (!model) {
      throw new Error(`Model not found: ${name}`);
    }

    // Cancel existing download if any
    this.cancelDownload(model);

    // Set model state
    model.downloaded = false;
    model.path = getModelPath(model);
    model.draftPath = model.draftUrl ? getModelDraftPath(model) : undefined;

    if (getDebugManager().store.get("simulateDownload")) {
      this.downloadItems[name] = new MockDownloadItem(model, () => {
        model.downloaded = true;
        this.pollRendererModelState();
      });
    } else {
      session.defaultSession.downloadURL(model.url);
    }

    setTimeout(() => {
      this.pollRendererModelState();
    }, 500);
  }

  /**
   * Removes models from state without deleting them from disk
   *
   * @param name {string}
   * @returns {Promise<void>}
   */
  public async removeModelByName(name: string) {
    getLogger().info("Removing model by name", name);

    const models = { ...this.models };

    if (models[name]) {
      this.cancelDownload(this.models[name]);

      delete models[name];
      this.models = models;
    }

    this.pollRendererModelState();
  }

  /**
   * Deletes a model by name
   *
   * @param name
   * @returns
   */
  public async deleteModelByName(name: string): Promise<boolean> {
    getLogger().info("Deleting model by name", name);

    const model = this.models[name];

    if (!model || !model.path) {
      getLogger().warn(
        `ModelManager deleteModelByName: Model not found: ${name}`,
      );
      throw new Error(`Model not found: ${name}`);
    }

    if (model.imported) {
      getLogger().warn(
        `ModelManager deleteModelByName: Tried to delete imported model: ${name}`,
      );
      throw new Error(`Refusing to delete imported model: ${name}`);
    }

    this.cancelDownload(model);

    if (fs.existsSync(model.path)) {
      try {
        await fs.promises.unlink(model.path);
        model.downloaded = false;
        model.path = undefined;
      } catch (error) {
        getLogger().error(`ModelManager: Error deleting model: ${name}`, error);
        return false;
      }
    }

    if (model.draftPath && fs.existsSync(model.draftPath)) {
      try {
        await fs.promises.unlink(model.draftPath);
        model.draftPath = undefined;
      } catch (error) {
        getLogger().error(
          `ModelManager: Error deleting MTP drafter for ${name}`,
          error,
        );
        return false;
      }
    }

    this.pollRendererModelState();
    return true;
  }

  /**
   * Returns a model by name
   *
   * @param name
   * @returns
   */
  public getModelByName(name: string): ManagedModel | undefined {
    return this.models[name];
  }

  /**
   * Deletes all models
   */
  public async deleteAllModels() {
    this.cancelAllDownloads();

    try {
      await fs.promises.rm(path.join(app.getPath("userData"), "models"), {
        recursive: true,
      });
    } catch (error) {
      getLogger().error(`ModelManager: Error deleting all models`, error);
    }

    this.pollRendererModelState();
  }

  /**
   * Polls the renderer model state
   */
  public pollRendererModelState() {
    process.nextTick(() => {
      getStateManager().store.set("models", this.getRendererModelState());
      getStateManager().onDidAnyChange();
    });
  }

  /**
   * Returns the initial renderer model state
   *
   * @returns
   */
  public getInitialRendererModelState(): ModelState {
    const result: ModelState = {};

    for (const model of BUILT_IN_MODELS) {
      result[model.name] = this.getManagedModelFromModel(model);
    }

    return result;
  }

  /**
   * Returns the state of the models for the renderer
   *
   * @returns
   */
  public getRendererModelState(): ModelState {
    const result: ModelState = {};

    for (const model of Object.values(this.models)) {
      const downloadItem =
        this.downloadItems[`${model.name}:draft`] ||
        this.downloadItems[model.name];
      const downloadState: DownloadState | undefined = downloadItem
        ? {
            totalBytes: downloadItem.getTotalBytes(),
            receivedBytes: downloadItem.getReceivedBytes(),
            percentComplete: downloadItem.getPercentComplete(),
            startTime: downloadItem.getStartTime(),
            savePath: downloadItem.getSavePath(),
            currentBytesPerSecond: downloadItem.getCurrentBytesPerSecond(),
            state: downloadItem.getState(),
          }
        : undefined;

      result[model.name] = {
        name: model.name,
        company: model.company,
        size: model.size,
        url: model.url,
        path: model.path,
        description: model.description,
        homepage: model.homepage,
        draftUrl: model.draftUrl,
        draftPath: model.draftPath,
        mtpMode: model.mtpMode,
        mtpDraftTokens: model.mtpDraftTokens,
        imported: model.imported,
        downloaded: this.getIsModelDownloaded(model),
        downloadState,
      };
    }

    return result;
  }

  /**
   * Returns true if the model exists on disk and is not downloading
   *
   * @param model
   * @returns
   */
  public getIsModelDownloaded(model: ManagedModel | Model): boolean {
    if (getDebugManager().store.get("simulateNoModelsDownloaded")) {
      return false;
    }
    if (getDebugManager().store.get("simulateDownload")) {
      return "downloaded" in model && Boolean(model.downloaded);
    }

    const existsOnDisk = isModelOnDisk(model);
    const draftExists =
      !model.draftUrl || fs.existsSync(getModelDraftPath(model));
    const activeDownloads = [
      this.downloadItems[model.name],
      this.downloadItems[`${model.name}:draft`],
    ].filter(Boolean);
    const isDownloading = activeDownloads.some(
      (item) => item.getState() !== "completed",
    );

    return existsOnDisk && draftExists && !isDownloading;
  }

  /**
   * Opens a file dialog to select a GGUF file and adds it as a model
   */
  public async addModelFromFile() {
    try {
      const result = await dialog.showOpenDialog({
        title: "Select a GGUF Model File",
        defaultPath: app.getPath("downloads"),
        filters: [{ name: "GGUF Model Files", extensions: ["gguf"] }],
        properties: ["openFile"],
      });

      if (result.canceled || result.filePaths.length === 0) {
        getLogger().info("No file selected for adding model.");
        return;
      }

      const filePath = result.filePaths[0];
      const fileName = path.basename(filePath);

      if (this.models[fileName]) {
        const overwrite = await dialog.showMessageBox({
          type: "warning",
          buttons: ["Overwrite", "Cancel"],
          defaultId: 1,
          title: "Model Already Exists",
          message: `A model with the name "${fileName}" already exists. Do you want to overwrite the entry in Clippy? This will not delete the file on disk.`,
        });

        if (overwrite.response !== 0) {
          getLogger().info("User canceled overwriting the existing model.");
          return;
        }
      }

      const model: ManagedModel = {
        name: fileName,
        size: Math.round(fs.statSync(filePath).size / (1024 * 1024)),
        path: filePath,
        description: `Imported GGUF model from ${filePath}.`,
        imported: true,
      };

      const models = { ...this.models, [fileName]: model };
      getStateManager().store.set("models", models);
      this.pollRendererModelState();

      getLogger().info(`Model added from file: ${filePath}`);
    } catch (error) {
      getLogger().error("Error adding model from file", error);
    }
  }

  /**
   * Handles the will-download event
   *
   * @param downloadItem
   */
  private onSessionWillDownload(
    event: Electron.Event,
    downloadItem: DownloadItem,
  ) {
    const urlChain = downloadItem.getURLChain();
    const urlStr = urlChain[0];
    const modelKey = Object.keys(this.models).find((k) => {
      const model = this.models[k];
      return model.url === urlStr || model.draftUrl === urlStr;
    });
    const model = this.models[modelKey];

    if (!model) {
      getLogger().info(
        `ModelManager: Handling will-download event for ${urlStr}, but did not find matching model. Disallowing download.`,
      );
      event.preventDefault();
      return false;
    }

    // Check if there's already a download in progress for this model
    const isDraft = model.draftUrl === urlStr;
    const downloadKey = isDraft ? `${model.name}:draft` : model.name;
    const existingDownload = this.downloadItems[downloadKey];
    if (existingDownload && existingDownload.getState() === "progressing") {
      getLogger().info(
        `ModelManager: Download already in progress for model ${model.name}. Disallowing duplicate download.`,
      );
      event.preventDefault();
      return false;
    }

    getLogger().info(
      `ModelManager: Handling will-download event for model ${model.name}. Allowing download.`,
    );

    model.path = getModelPath(model);
    model.draftPath = model.draftUrl ? getModelDraftPath(model) : undefined;
    model.downloaded = false;
    this.downloadItems[downloadKey] = downloadItem;

    downloadItem.setSavePath(
      isDraft ? getModelDraftPath(model) : getModelPath(model),
    );
    downloadItem.once("done", (_event, state) => {
      if (
        state === "completed" &&
        !isDraft &&
        model.draftUrl &&
        !fs.existsSync(getModelDraftPath(model))
      ) {
        session.defaultSession.downloadURL(model.draftUrl);
      }

      this.pollRendererModelState();
    });
    this.pollRendererModelState();

    return true;
  }

  /**
   * Cancels a download by name
   *
   * @param name
   */
  private cancelDownload(model: ManagedModel) {
    for (const downloadKey of [model.name, `${model.name}:draft`]) {
      const downloadItem = this.downloadItems[downloadKey];
      if (!downloadItem || downloadItem.getState() === "completed") continue;

      try {
        downloadItem.cancel();
      } catch (error) {
        getLogger().error(
          `ModelManager: Error canceling download: ${model.name}`,
          error,
        );
      }

      delete this.downloadItems[downloadKey];
    }
  }

  /**
   * Cancels all downloads
   */
  private cancelAllDownloads() {
    for (const model of Object.values(this.models)) {
      this.cancelDownload(model);
    }
  }

  /**
   * Returns true if the model is downloading
   *
   * @param model
   * @returns
   */
  private isModelDownloading(model: ManagedModel) {
    return [model.name, `${model.name}:draft`].some(
      (key) =>
        this.downloadItems[key] &&
        this.downloadItems[key].getState() !== "completed",
    );
  }
}

let _modelManager: ModelManager;
export function getModelManager() {
  if (!_modelManager) {
    _modelManager = new ModelManager();
  }

  return _modelManager;
}

/**
 * Returns true if the model is on disk
 *
 * @param model
 * @returns {boolean}
 */
export function isModelOnDisk(model: ManagedModel | Model): boolean {
  const filePath =
    "path" in model && model.path ? model.path : getModelPath(model);
  const existsOnDisk = fs.existsSync(filePath);

  return existsOnDisk;
}

/**
 * Returns the path to the model on disk
 *
 * @param model
 * @returns {string}
 */
export function getModelPath(model: Model): string {
  return path.join(app.getPath("userData"), "models", getModelFileName(model));
}

export function getModelDraftPath(model: Model): string {
  if (!model.draftUrl) {
    throw new Error(`Model ${model.name} does not have an MTP drafter`);
  }

  return path.join(
    app.getPath("userData"),
    "models",
    path.basename(new URL(model.draftUrl).pathname),
  );
}

/**
 * Returns the file name of the model
 *
 * @param model
 * @returns {string}
 */
export function getModelFileName(model: Model): string {
  return path.basename(new URL(model.url).pathname);
}
