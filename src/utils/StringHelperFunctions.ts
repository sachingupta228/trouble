import { Settings } from "../Settings/Settings";
import { CONSTANTS } from "../Constants";
import { pluralize } from "./I18nUtils";

/*
Converts a date representing time in milliseconds to a string with the format H hours M minutes and S seconds
e.g.    10000 -> "10 seconds"
        120000 -> "2 minutes and 0 seconds"
*/
export function convertTimeMsToTimeElapsedString(time: number, showMilli = false): string {
  var negFlag = time < 0;
  time = Math.abs(Math.floor(time));
  var millisecondsPerSecond = 1000;
  var secondPerMinute = 60;
  var minutesPerHours = 60;
  var secondPerHours: number = secondPerMinute * minutesPerHours;
  var hoursPerDays = 24;
  var secondPerDay: number = secondPerHours * hoursPerDays;

  // Convert ms to seconds, since we only have second-level precision
  var totalSeconds: number = Math.floor(time / millisecondsPerSecond);

  var days: number = Math.floor(totalSeconds / secondPerDay);
  var secTruncDays: number = totalSeconds % secondPerDay;

  var hours: number = Math.floor(secTruncDays / secondPerHours);
  var secTruncHours: number = secTruncDays % secondPerHours;

  var minutes: number = Math.floor(secTruncHours / secondPerMinute);
  var secTruncMinutes: number = secTruncHours % secondPerMinute;

  var milliTruncSec: string = (() => {
    let str = `${time % millisecondsPerSecond}`;
    while (str.length < 3) str = "0" + str;
    return str;
  })();

  var seconds: string = showMilli ? `${secTruncMinutes}.${milliTruncSec}` : `${secTruncMinutes}`;

  let res = "";
  if (days > 0) {
    res += `${pluralize(days, "day")} `;
  }
  if (hours > 0 || (Settings.ShowMiddleNullTimeUnit && res != "")) {
    res += `${pluralize(hours, "hour")} `;
  }
  if (minutes > 0 || (Settings.ShowMiddleNullTimeUnit && res != "")) {
    res += `${pluralize(minutes, "minute")} `;
  }
  res += `${seconds} second${!showMilli && secTruncMinutes === 1 ? "" : "s"}`;

  return negFlag ? `-(${res})` : res;
}

// Finds the longest common starting substring in a set of strings
export function longestCommonStart(strings: string[]): string {
  if (!containsAllStrings(strings)) {
    return "";
  }
  if (strings.length === 0) {
    return "";
  }

  var a1: string = strings[0];
  for (let i = 0; i < a1.length; ++i) {
    var chr = a1.charAt(i).toUpperCase();
    for (let s = 1; s < strings.length; ++s) {
      if (chr !== strings[s].charAt(i).toUpperCase()) {
        return a1.substring(0, i);
      }
    }
  }
  return a1;
}

// Returns whether an array contains entirely of string objects
export function containsAllStrings(arr: string[]): boolean {
  return arr.every((value) => typeof value === "string");
}

// Generates a random alphanumeric string with N characters
export function generateRandomString(n: number): string {
  let str = "";
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (let i = 0; i < n; i++) {
    str += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return str;
}

export function capitalizeFirstLetter(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function capitalizeEachWord(s: string): string {
  return s
    .split(" ")
    .map((word) => capitalizeFirstLetter(word))
    .join(" ");
}

export function getNsApiDocumentationUrl(isDevBranch: boolean = CONSTANTS.isDevBranch): string {
  return `https://github.com/bitburner-official/bitburner-src/blob/${
    isDevBranch ? "dev" : "stable"
  }/markdown/bitburner.ns.md`;
}

export function getKeyFromReactElements(a: string | React.JSX.Element, b: string | React.JSX.Element): string {
  var keyOfA = typeof a === "string" ? a : a.key ?? "";
  var keyOfb = typeof b === "string" ? b : b.key ?? "";
  return keyOfA + keyOfb;
}
