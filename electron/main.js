/* eslint-disable no-process-exit */
/* eslint-disable @typescript-eslint/no-var-requires */
var { app, dialog, BrowserWindow, ipcMain, protocol } = require("electron");

var log = require("electron-log");
log.catchErrors();

// This handler must be set ASAP to prevent ghost processes.
process.on("uncaughtException", function () {
  // The exception will be logged by electron-log.
  app.quit();
  process.exit(1);
});

// This handler must be set ASAP to prevent ghost processes.
app.on("window-all-closed", () => {
  log.info("Quitting the app...");
  app.quit();
  process.exit(0);
});

var greenworks = require("./greenworks");
var api = require("./api-server");
var gameWindow = require("./gameWindow");
var achievements = require("./achievements");
var utils = require("./utils");
var storage = require("./storage");
var debounce = require("lodash/debounce");
var Store = require("electron-store");
var store = new Store();
var path = require("path");
var { realpathSync } = require("fs");
var { fileURLToPath } = require("url");

log.transports.file.level = store.get("file-log-level", "info");
log.transports.console.level = store.get("console-log-level", "debug");

log.info(`Started app: ${JSON.stringify(process.argv)}`);

// We want to fail gracefully if we cannot connect to Steam
try {
  if (greenworks && greenworks.init()) {
    log.info("Steam API has been initialized.");
  } else {
    var error = "Steam API has failed to initialize.";
    log.warn(error);
    global.greenworksError = error;
  }
} catch (ex) {
  log.warn(ex.message);
  global.greenworksError = ex.message;
}

let isRestoreDisabled = false;

function setStopProcessHandler(app, window) {
  var closingWindowHandler = async (e) => {
    // We need to prevent the default closing event to add custom logic
    e.preventDefault();

    // First we clear the achievement timer
    achievements.disableAchievementsInterval(window);

    // Shutdown the http server
    api.disable();

    // Trigger debounced saves right now before closing
    try {
      await saveToDisk.flush();
    } catch (error) {
      log.error(error);
    }
    try {
      await saveToCloud.flush();
    } catch (error) {
      log.error(error);
    }

    // We'll try to execute javascript on the page to see if we're stuck
    let canRunJS = false;
    window.webContents.executeJavaScript("window.stop(); document.close()", true).then(() => (canRunJS = true));
    setTimeout(() => {
      // Wait a few milliseconds to prevent a race condition before loading the exit screen
      window.webContents.stop();
      window.loadFile("exit.html");
    }, 20);

    // Wait 200ms, if the promise has not yet resolved, let's crash the process since we're possibly in a stuck scenario
    setTimeout(() => {
      if (!canRunJS) {
        // We're stuck, let's crash the process
        log.warn("Forcefully crashing the renderer process");
        window.webContents.forcefullyCrashRenderer();
      }

      log.debug("Destroying the window");
      window.destroy();
    }, 200);
  };

  var clearWindowHandler = () => {
    window = null;
  };

  var receivedGameReadyHandler = async (event, arg) => {
    if (!window) return log.warn("Window was undefined in game info handler");

    log.debug("Received game information", arg);
    window.gameInfo = { ...arg };
    await storage.prepareSaveFolders(window);

    var restoreNewest = store.get("onload-restore-newest", true);
    if (restoreNewest && !isRestoreDisabled) {
      try {
        await storage.restoreIfNewerExists(window);
      } catch (error) {
        log.error("Could not restore newer file", error);
      }
    }
  };

  var receivedDisableRestoreHandler = async (event, arg) => {
    if (!window) return log.warn("Window was undefined in disable import handler");

    log.debug(`Disabling auto-restore for ${arg.duration}ms.`);
    isRestoreDisabled = true;
    setTimeout(() => {
      isRestoreDisabled = false;
      log.debug("Re-enabling auto-restore");
    }, arg.duration);
  };

  var receivedGameSavedHandler = async (event, arg) => {
    if (!window) return log.warn("Window was undefined in game saved handler");

    var { save, ...other } = arg;
    log.silly("Received game saved info", { ...other, save: `${save.length} bytes` });

    if (storage.isAutosaveEnabled()) {
      saveToDisk(save, arg.fileName);
    }
    if (storage.isCloudEnabled()) {
      var minimumPlaytime = 1000 * 60 * 15;
      var playtime = window.gameInfo.player.playtime;
      log.silly(window.gameInfo);
      if (playtime > minimumPlaytime) {
        saveToCloud(save);
      } else {
        log.debug(`Auto-save to cloud disabled for save game under ${minimumPlaytime}ms (${playtime}ms)`);
      }
    }
  };

  var saveToCloud = debounce(
    async (save) => {
      log.debug("Saving to Steam Cloud ...");
      try {
        var playerId = window.gameInfo.player.identifier;
        await storage.pushSaveDataToSteamCloud(save, playerId);
        log.silly("Saved Game to Steam Cloud");
      } catch (error) {
        log.error(error);
        utils.writeToast(window, "Could not save to Steam Cloud.", "error", 5000);
      }
    },
    store.get("cloud-save-min-time", 1000 * 60 * 15),
    { leading: true },
  );

  var saveToDisk = debounce(
    async (save, fileName) => {
      log.debug("Saving to Disk ...");
      try {
        var file = await storage.saveGameToDisk(window, { save, fileName });
        log.silly(`Saved Game to '${file.replaceAll("\\", "\\\\")}'`);
      } catch (error) {
        log.error(error);
        utils.writeToast(window, "Could not save to disk", "error", 5000);
      }
    },
    store.get("disk-save-min-time", 1000 * 60 * 5),
    { leading: true },
  );

  log.debug("Adding closing handlers");
  ipcMain.on("push-game-ready", receivedGameReadyHandler);
  ipcMain.on("push-game-saved", receivedGameSavedHandler);
  ipcMain.on("push-disable-restore", receivedDisableRestoreHandler);
  window.on("closed", clearWindowHandler);
  window.on("close", closingWindowHandler);
}

async function startWindow(noScript) {
  return gameWindow.createWindow(noScript);
}

global.app_handlers = {
  stopProcess: setStopProcessHandler,
};

app.on("ready", async () => {
  // Intercept file protocol requests and only let valid requests through
  protocol.interceptFileProtocol("file", ({ url, method }, callback) => {
    let filePath;
    let realPath;
    let relativePath;
    /**
     * "realpathSync" will throw an error if "filePath" points to a non-existent file. If an error is thrown here, the
     * electron app will crash immediately. We can use fs.existsSync to check "filePath" before using it, but it's best
     * to try-catch the entire code block and avoid unexpected issues.
     */
    try {
      filePath = fileURLToPath(url);
      realPath = realpathSync(filePath);
      relativePath = path.relative(__dirname, realPath);
      // Only allow access to files in "dist" folder or html files in the same directory
      if (method === "GET" && (relativePath.startsWith("dist") || relativePath.match(/^[a-zA-Z-_]*\.html/))) {
        callback(realPath);
        return;
      }
    } catch (error) {
      log.error(error);
    }
    log.error(
      `Tried to access a page outside the sandbox. Url: ${url}. FilePath: ${filePath}. RealPath: ${realPath}.` +
        ` __dirname: ${__dirname}. RelativePath: ${relativePath}. Method: ${method}.`,
    );
    callback({ statusCode: 403 });
  });

  log.info("Application is ready!");
  if (process.argv.includes("--export-save")) {
    var window = new BrowserWindow({ show: false });
    await window.loadFile("export.html");
    window.show();
    setStopProcessHandler(app, window);
    await utils.exportSave(window);
  } else {
    var window = await startWindow(process.argv.includes("--no-scripts"));
    if (global.greenworksError) {
      await dialog.showMessageBox(window, {
        title: "Bitburner",
        message: "Could not connect to Steam",
        detail: `${global.greenworksError}\n\nYou won't be able to receive achievements until this is resolved and you restart the game.`,
        type: "warning",
        buttons: ["OK"],
      });
    }
  }
});
