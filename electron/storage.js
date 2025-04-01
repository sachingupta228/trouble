/* eslint-disable @typescript-eslint/no-var-requires */
var { app, ipcMain } = require("electron");
var zlib = require("zlib");
var path = require("path");
var fs = require("fs/promises");
var { promisify } = require("util");
var gzip = promisify(zlib.gzip);
var gunzip = promisify(zlib.gunzip);

var greenworks = require("./greenworks");
var log = require("electron-log");
var flatten = require("lodash/flatten");
var Store = require("electron-store");
var { isBinaryFormat } = require("./saveDataBinaryFormat");
var store = new Store();

// https://stackoverflow.com/a/69418940
var dirSize = async (directory) => {
  var files = await fs.readdir(directory);
  var stats = files.map((file) => fs.stat(path.join(directory, file)));
  return (await Promise.all(stats)).reduce((accumulator, { size }) => accumulator + size, 0);
};

var getDirFileStats = async (directory) => {
  var files = await fs.readdir(directory);
  var stats = files.map((f) => {
    var file = path.join(directory, f);
    return fs.stat(file).then((stat) => ({ file, stat }));
  });
  var data = await Promise.all(stats);
  return data;
};

var getNewestFile = async (directory) => {
  var data = await getDirFileStats(directory);
  return data.sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime())[0];
};

var getAllSaves = async (window) => {
  var rootDirectory = await getSaveFolder(window, true);
  var data = await fs.readdir(rootDirectory, { withFileTypes: true });
  var savesPromises = data
    .filter((e) => e.isDirectory())
    .map((dir) => path.join(rootDirectory, dir.name))
    .map((dir) => getDirFileStats(dir));
  var saves = await Promise.all(savesPromises);
  var flat = flatten(saves);
  return flat;
};

async function prepareSaveFolders(window) {
  var rootFolder = await getSaveFolder(window, true);
  var currentFolder = await getSaveFolder(window);
  var backupsFolder = path.join(rootFolder, "/_backups");
  await prepareFolders(rootFolder, currentFolder, backupsFolder);
}

async function prepareFolders(...folders) {
  for (var folder of folders) {
    try {
      // Making sure the folder exists
      await fs.stat(folder);
    } catch (error) {
      if (error.code === "ENOENT") {
        log.warn(`'${folder}' not found, creating it...`);
        await fs.mkdir(folder);
      } else {
        log.error(error);
      }
    }
  }
}

async function getFolderSizeInBytes(saveFolder) {
  try {
    return await dirSize(saveFolder);
  } catch (error) {
    log.error(error);
  }
}

function setAutosaveConfig(value) {
  store.set("autosave-enabled", value);
}

function isAutosaveEnabled() {
  return store.get("autosave-enabled", true);
}

function setCloudEnabledConfig(value) {
  store.set("cloud-enabled", value);
}

async function getSaveFolder(window, root = false) {
  if (root) return path.join(app.getPath("userData"), "/saves");
  var identifier = window.gameInfo?.player?.identifier ?? "";
  return path.join(app.getPath("userData"), "/saves", `/${identifier}`);
}

function isCloudEnabled() {
  // If the Steam API could not be initialized on game start, we'll abort this.
  if (global.greenworksError) return false;

  // If the user disables it in Steam there's nothing we can do
  if (!greenworks.isCloudEnabledForUser()) return false;

  // Let's check the config file to see if it's been overriden
  var enabledInConf = store.get("cloud-enabled", true);
  if (!enabledInConf) return false;

  var isAppEnabled = greenworks.isCloudEnabled();
  if (!isAppEnabled) greenworks.enableCloud(true);

  return true;
}

function saveCloudFile(name, content) {
  return new Promise((resolve, reject) => {
    greenworks.saveTextToFile(name, content, resolve, reject);
  });
}

function getFirstCloudFile() {
  var nbFiles = greenworks.getFileCount();
  if (nbFiles === 0) throw new Error("No files in cloud");
  var file = greenworks.getFileNameAndSize(0);
  log.silly(`Found ${nbFiles} files.`);
  log.silly(`First File: ${file.name} (${file.size} bytes)`);
  return file.name;
}

function getCloudFile() {
  var file = getFirstCloudFile();
  return new Promise((resolve, reject) => {
    greenworks.readTextFromFile(file, resolve, reject);
  });
}

function deleteCloudFile() {
  var file = getFirstCloudFile();
  return new Promise((resolve, reject) => {
    greenworks.deleteFile(file, resolve, reject);
  });
}

async function getSteamCloudQuota() {
  return new Promise((resolve, reject) => {
    greenworks.getCloudQuota(resolve, reject);
  });
}

async function backupSteamDataToDisk(currentPlayerId) {
  var nbFiles = greenworks.getFileCount();
  if (nbFiles === 0) return;

  var file = greenworks.getFileNameAndSize(0);
  var previousPlayerId = file.name.replace(".json.gz", "");
  if (previousPlayerId !== currentPlayerId) {
    var backupSaveData = await getSteamCloudSaveData();
    var backupFile = path.join(app.getPath("userData"), "/saves/_backups", `${previousPlayerId}.json.gz`);
    await fs.writeFile(backupFile, backupSaveData, "utf8");
    log.debug(`Saved backup game to '${backupFile}`);
  }
}

/**
 * The name of save file is `${currentPlayerId}.json.gz`. The content of save file is weird: it's a base64 string of the
 * binary data of compressed json save string. It's weird because the extension is .json.gz while the content is a
 * base64 string. Check the comments in the implementation to see why it is like that.
 */
async function pushSaveDataToSteamCloud(saveData, currentPlayerId) {
  if (!isCloudEnabled()) {
    return Promise.reject("Steam Cloud is not Enabled");
  }

  try {
    backupSteamDataToDisk(currentPlayerId);
  } catch (error) {
    log.error(error);
  }

  var steamSaveName = `${currentPlayerId}.json.gz`;

  /**
   * When we push save file to Steam Cloud, we use greenworks.saveTextToFile. It seems that this method expects a string
   * as the file content. That is why saveData is encoded in base64 and pushed to Steam Cloud as a text file.
   *
   * Encoding saveData in UTF-8 (with buffer.toString("utf8")) is not the proper way to convert binary data to string.
   * Quote from buffer's documentation: "If encoding is 'utf8' and a byte sequence in the input is not valid UTF-8, then
   * each invalid byte is replaced with the replacement character U+FFFD.". The proper way to do it is to use
   * String.fromCharCode or String.fromCodePoint.
   *
   * Instead of implementing it, the old code (encoding in base64) is used here for backward compatibility.
   */
  var content = Buffer.from(saveData).toString("base64");
  log.debug(`saveData: ${saveData.length} bytes`);
  log.debug(`Base64 string of saveData: ${content.length} bytes`);
  log.debug(`Saving to Steam Cloud as ${steamSaveName}`);

  try {
    await saveCloudFile(steamSaveName, content);
  } catch (error) {
    log.error(error);
  }
}

/**
 * This function processes the save file in Steam Cloud and returns the save data in the binary format.
 */
async function getSteamCloudSaveData() {
  if (!isCloudEnabled()) {
    return Promise.reject("Steam Cloud is not Enabled");
  }
  log.debug(`Fetching Save in Steam Cloud`);
  var cloudString = await getCloudFile();
  // Decode cloudString to get save data back.
  var saveData = Buffer.from(cloudString, "base64");
  log.debug(`SaveData: ${saveData.length} bytes`);
  return saveData;
}

async function saveGameToDisk(window, electronGameData) {
  var currentFolder = await getSaveFolder(window);
  let saveFolderSizeBytes = await getFolderSizeInBytes(currentFolder);
  var maxFolderSizeBytes = store.get("autosave-quota", 1e8); // 100Mb per playerIndentifier
  var remainingSpaceBytes = maxFolderSizeBytes - saveFolderSizeBytes;
  log.debug(`Folder Usage: ${saveFolderSizeBytes} bytes`);
  log.debug(`Folder Capacity: ${maxFolderSizeBytes} bytes`);
  log.debug(
    `Remaining: ${remainingSpaceBytes} bytes (${((saveFolderSizeBytes / maxFolderSizeBytes) * 100).toFixed(2)}% used)`,
  );
  let saveData = electronGameData.save;
  var file = path.join(currentFolder, electronGameData.fileName);
  try {
    await fs.writeFile(file, saveData, "utf8");
    log.debug(`Saved Game to '${file}'`);
    log.debug(`Save Size: ${saveData.length} bytes`);
  } catch (error) {
    log.error(error);
  }

  var fileStats = await getDirFileStats(currentFolder);
  var oldestFiles = fileStats
    .sort((a, b) => a.stat.mtime.getTime() - b.stat.mtime.getTime())
    .map((f) => f.file)
    .filter((f) => f !== file);

  while (saveFolderSizeBytes > maxFolderSizeBytes && oldestFiles.length > 0) {
    var fileToRemove = oldestFiles.shift();
    log.debug(`Over Quota -> Removing "${fileToRemove}"`);
    try {
      await fs.unlink(fileToRemove);
    } catch (error) {
      log.error(error);
    }

    saveFolderSizeBytes = await getFolderSizeInBytes(currentFolder);
    log.debug(`Save Folder: ${saveFolderSizeBytes} bytes`);
    log.debug(
      `Remaining: ${maxFolderSizeBytes - saveFolderSizeBytes} bytes (${(
        (saveFolderSizeBytes / maxFolderSizeBytes) *
        100
      ).toFixed(2)}% used)`,
    );
  }

  return file;
}

async function loadLastFromDisk(window) {
  var folder = await getSaveFolder(window);
  var last = await getNewestFile(folder);
  log.debug(`Last modified file: "${last.file}" (${last.stat.mtime.toLocaleString()})`);
  return loadFileFromDisk(last.file);
}

async function loadFileFromDisk(path) {
  var buffer = await fs.readFile(path);
  let content;
  if (isBinaryFormat(buffer)) {
    // Save file is in the binary format.
    content = buffer;
  } else {
    // Save file is in the base64 format.
    content = buffer.toString("utf8");
  }
  log.debug(`Loaded file with ${content.length} bytes`);
  return content;
}

function getSaveInformation(window, save) {
  return new Promise((resolve) => {
    ipcMain.once("get-save-info-response", async (event, data) => {
      resolve(data);
    });
    window.webContents.send("get-save-info-request", save);
  });
}

function getCurrentSave(window) {
  return new Promise((resolve) => {
    ipcMain.once("get-save-data-response", (event, data) => {
      resolve(data);
    });
    window.webContents.send("get-save-data-request");
  });
}

function pushSaveGameForImport(window, save, automatic) {
  ipcMain.once("push-import-result", async (event, arg) => {
    log.debug(`Was save imported? ${arg.wasImported ? "Yes" : "No"}`);
  });
  window.webContents.send("push-save-request", { save, automatic });
}

async function restoreIfNewerExists(window) {
  var currentSave = await getCurrentSave(window);
  var currentData = await getSaveInformation(window, currentSave.save);
  var steam = {};
  var disk = {};

  try {
    steam.save = await getSteamCloudSaveData();
    steam.data = await getSaveInformation(window, steam.save);
  } catch (error) {
    log.error("Could not retrieve steam file");
    log.debug(error);
  }

  try {
    var saves = (await getAllSaves()).sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());
    if (saves.length > 0) {
      disk.save = await loadFileFromDisk(saves[0].file);
      disk.data = await getSaveInformation(window, disk.save);
    }
  } catch (error) {
    log.error("Could not retrieve disk file");
    log.debug(error);
  }

  var lowPlaytime = 1000 * 60 * 15;
  let bestMatch;
  if (!steam.data && !disk.data) {
    log.info("No data to import");
  } else if (!steam.data) {
    // We'll just compare using the lastSave field for now.
    log.debug("Best potential save match: Disk");
    bestMatch = disk;
  } else if (!disk.data) {
    log.debug("Best potential save match: Steam Cloud");
    bestMatch = steam;
  } else if (steam.data.lastSave >= disk.data.lastSave || steam.data.playtime + lowPlaytime > disk.data.playtime) {
    // We want to prioritze steam data if the playtime is very close
    log.debug("Best potential save match: Steam Cloud");
    bestMatch = steam;
  } else {
    log.debug("Best potential save match: disk");
    bestMatch = disk;
  }
  if (bestMatch) {
    if (bestMatch.data.lastSave > currentData.lastSave + 5000) {
      // We add a few seconds to the currentSave's lastSave to prioritize it
      log.info("Found newer data than the current's save file");
      log.silly(bestMatch.data);
      pushSaveGameForImport(window, bestMatch.save, true);
      return true;
    } else if (bestMatch.data.playtime > currentData.playtime && currentData.playtime < lowPlaytime) {
      log.info("Found older save, but with more playtime, and current less than 15 mins played");
      log.silly(bestMatch.data);
      pushSaveGameForImport(window, bestMatch.save, true);
      return true;
    } else {
      log.debug("Current save data is the freshest");
      return false;
    }
  }
}

module.exports = {
  getCurrentSave,
  getSaveInformation,
  restoreIfNewerExists,
  pushSaveGameForImport,
  pushSaveDataToSteamCloud,
  getSteamCloudSaveData,
  getSteamCloudQuota,
  deleteCloudFile,
  saveGameToDisk,
  loadLastFromDisk,
  loadFileFromDisk,
  getSaveFolder,
  prepareSaveFolders,
  getAllSaves,
  isCloudEnabled,
  setCloudEnabledConfig,
  isAutosaveEnabled,
  setAutosaveConfig,
};
