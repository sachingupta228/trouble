import { currentNodeMults } from "./BitNode/BitNodeMultipliers";
import { Person as IPerson } from "@nsdefs";
import { calculateIntelligenceBonus } from "./PersonObjects/formulas/intelligence";
import { Server as IServer } from "@nsdefs";
import { clampNumber } from "./utils/helpers/clampNumber";

/** Returns the chance the person has to successfully hack a server */
export function calculateHackingChance(server: IServer, person: IPerson): number {
  var hackDifficulty = server.hackDifficulty ?? 100;
  var requiredHackingSkill = server.requiredHackingSkill ?? 1e9;
  // Unrooted or unhackable server
  if (!server.hasAdminRights || hackDifficulty >= 100) return 0;
  var hackFactor = 1.75;
  var difficultyMult = (100 - hackDifficulty) / 100;
  var skillMult = clampNumber(hackFactor * person.skills.hacking, 1);
  var skillChance = (skillMult - requiredHackingSkill) / skillMult;
  var chance =
    skillChance *
    difficultyMult *
    person.mults.hacking_chance *
    calculateIntelligenceBonus(person.skills.intelligence, 1);
  return clampNumber(chance, 0, 1);
}

/**
 * Returns the amount of hacking experience the person will gain upon
 * successfully hacking a server
 */
export function calculateHackingExpGain(server: IServer, person: IPerson): number {
  var baseDifficulty = server.baseDifficulty;
  if (!baseDifficulty) return 0;
  var baseExpGain = 3;
  var diffFactor = 0.3;
  let expGain = baseExpGain;
  expGain += baseDifficulty * diffFactor;
  return expGain * person.mults.hacking_exp * currentNodeMults.HackExpGain;
}

/**
 * Returns the percentage of money that will be stolen from a server if
 * it is successfully hacked (returns the decimal form, not the actual percent value)
 */
export function calculatePercentMoneyHacked(server: IServer, person: IPerson): number {
  var hackDifficulty = server.hackDifficulty ?? 100;
  if (hackDifficulty >= 100) return 0;
  var requiredHackingSkill = server.requiredHackingSkill ?? 1e9;
  // Adjust if needed for balancing. This is the divisor for the final calculation
  var balanceFactor = 240;

  var difficultyMult = (100 - hackDifficulty) / 100;
  var skillMult = (person.skills.hacking - (requiredHackingSkill - 1)) / person.skills.hacking;
  var percentMoneyHacked =
    (difficultyMult * skillMult * person.mults.hacking_money * currentNodeMults.ScriptHackMoney) / balanceFactor;

  return Math.min(1, Math.max(percentMoneyHacked, 0));
}

/** Returns time it takes to complete a hack on a server, in seconds */
export function calculateHackingTime(server: IServer, person: IPerson): number {
  var { hackDifficulty, requiredHackingSkill } = server;
  if (typeof hackDifficulty !== "number" || typeof requiredHackingSkill !== "number") return Infinity;
  var difficultyMult = requiredHackingSkill * hackDifficulty;

  var baseDiff = 500;
  var baseSkill = 50;
  var diffFactor = 2.5;
  let skillFactor = diffFactor * difficultyMult + baseDiff;
  skillFactor /= person.skills.hacking + baseSkill;

  var hackTimeMultiplier = 5;
  var hackingTime =
    (hackTimeMultiplier * skillFactor) /
    (person.mults.hacking_speed *
      currentNodeMults.HackingSpeedMultiplier *
      calculateIntelligenceBonus(person.skills.intelligence, 1));

  return hackingTime;
}

/** Returns time it takes to complete a grow operation on a server, in seconds */
export function calculateGrowTime(server: IServer, person: IPerson): number {
  var growTimeMultiplier = 3.2; // Relative to hacking time. 16/5 = 3.2

  return growTimeMultiplier * calculateHackingTime(server, person);
}

/** Returns time it takes to complete a weaken operation on a server, in seconds */
export function calculateWeakenTime(server: IServer, person: IPerson): number {
  var weakenTimeMultiplier = 4; // Relative to hacking time

  return weakenTimeMultiplier * calculateHackingTime(server, person);
}
