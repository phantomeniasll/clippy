import { shouldQuit } from "./squirrel-startup";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (shouldQuit) {
  app.quit();
}

import { app, BrowserWindow, ipcMain } from "electron";
import { loadElectronLlm } from "@electron/llm";
import { setupIpcListeners } from "./ipc";
import { createMainWindow, setupWindowListener } from "./windows";
import { getModelManager } from "./models";
import { setupAutoUpdater } from "./update";
import { setupAppMenu } from "./menu";
import { IpcMessages } from "../ipc-messages";
import { getLlamaServerManager } from "./llama-server";

const hasSingleInstanceLock = app.requestSingleInstanceLock();
let shouldOpenChatOnStart = process.argv.includes("--toggle-chat");

function requestChatToggle() {
  const mainWindow = BrowserWindow.getAllWindows().find(
    (window) => !window.getParentWindow(),
  );

  if (!mainWindow || mainWindow.webContents.isLoadingMainFrame()) {
    shouldOpenChatOnStart = !shouldOpenChatOnStart;
    return;
  }

  mainWindow.webContents.send(IpcMessages.TOGGLE_CHAT_REQUESTED);
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    if (commandLine.includes("--toggle-chat")) {
      requestChatToggle();
    }
  });
}

async function onReady() {
  console.info(`Welcome to Clippy v${app.getVersion()}`);

  await setupAutoUpdater();
  await loadLlm();
  setupAppMenu();
  setupIpcListeners();
  ipcMain.handle(IpcMessages.APP_SHOULD_OPEN_CHAT_ON_START, () => {
    const result = shouldOpenChatOnStart;
    shouldOpenChatOnStart = false;
    return result;
  });
  setupWindowListener();
  await createMainWindow();
}

async function loadLlm() {
  await loadElectronLlm({
    getModelPath: (modelAlias: string) => {
      console.info(
        `Loading model ${modelAlias} from ${getModelManager().getModelByName(modelAlias)?.path}`,
      );
      return getModelManager().getModelByName(modelAlias)?.path;
    },
  });
}

if (hasSingleInstanceLock) app.on("ready", onReady);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => getLlamaServerManager().stopNow());

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
