import { Player } from "@player";
import { calculateServerGrowth, calculateGrowMoney } from "../Server/formulas/grow";
import { numCycleForGrowthCorrected } from "../Server/ServerHelpers";
import {
  calculateMoneyGainRate,
  calculateLevelUpgradeCost,
  calculateRamUpgradeCost,
  calculateCoreUpgradeCost,
  calculateNodeCost,
} from "../Hacknet/formulas/HacknetNodes";
import {
  calculateHashGainRate as HScalculateHashGainRate,
  calculateLevelUpgradeCost as HScalculateLevelUpgradeCost,
  calculateRamUpgradeCost as HScalculateRamUpgradeCost,
  calculateCoreUpgradeCost as HScalculateCoreUpgradeCost,
  calculateCacheUpgradeCost as HScalculateCacheUpgradeCost,
  calculateServerCost as HScalculateServerCost,
} from "../Hacknet/formulas/HacknetServers";
import { HacknetNodeConstants, HacknetServerConstants } from "../Hacknet/data/Constants";
import { calculateSkill, calculateExp } from "../PersonObjects/formulas/skill";
import {
  calculateHackingChance,
  calculateHackingExpGain,
  calculatePercentMoneyHacked,
  calculateHackingTime,
  calculateGrowTime,
  calculateWeakenTime,
} from "../Hacking";
import { CityName, CompletedProgramName, FactionWorkType, GymType, LocationName, UniversityClassType } from "@enums";
import { Formulas as IFormulas, Player as IPlayer, Person as IPerson } from "@nsdefs";
import {
  calculateRespectGain,
  calculateWantedLevelGain,
  calculateMoneyGain,
  calculateWantedPenalty,
  calculateAscensionMult,
  calculateAscensionPointsGain,
} from "../Gang/formulas/formulas";
import { favorToRep as calculateFavorToRep, repToFavor as calculateRepToFavor } from "../Faction/formulas/favor";
import { repFromDonation, donationForRep } from "../Faction/formulas/donation";
import { InternalAPI, NetscriptContext, setRemovedFunctions } from "../Netscript/APIWrapper";
import { helpers } from "../Netscript/NetscriptHelpers";
import { calculateCrimeWorkStats } from "../Work/Formulas";
import { calculateCompanyWorkStats } from "../Work/Formulas";
import { Companies } from "../Company/Companies";
import { calculateClassEarnings } from "../Work/Formulas";
import { calculateFactionExp, calculateFactionRep } from "../Work/Formulas";

import { defaultMultipliers } from "../PersonObjects/Multipliers";
import { findEnumMember } from "../utils/helpers/enum";
import { getEnumHelper } from "../utils/EnumHelper";
import { CompanyPositions } from "../Company/CompanyPositions";
import { findCrime } from "../Crime/CrimeHelpers";
import { Skills } from "../Bladeburner/data/Skills";
import type { PositiveNumber } from "../types";

export function NetscriptFormulas(): InternalAPI<IFormulas> {
  const checkFormulasAccess = function (ctx: NetscriptContext): void {
    if (!Player.hasProgram(CompletedProgramName.formulas)) {
      throw helpers.errorMessage(ctx, `Requires Formulas.exe to run.`);
    }
  };
  const formulasFunctions: InternalAPI<IFormulas> = {
    mockServer: () => () => ({
      cpuCores: 0,
      ftpPortOpen: false,
      hasAdminRights: false,
      hostname: "",
      httpPortOpen: false,
      ip: "",
      isConnectedTo: false,
      maxRam: 0,
      organizationName: "",
      ramUsed: 0,
      smtpPortOpen: false,
      sqlPortOpen: false,
      sshPortOpen: false,
      purchasedByPlayer: false,
      backdoorInstalled: false,
      baseDifficulty: 0,
      hackDifficulty: 0,
      minDifficulty: 0,
      moneyAvailable: 0,
      moneyMax: 0,
      numOpenPortsRequired: 0,
      openPortCount: 0,
      requiredHackingSkill: 0,
      serverGrowth: 0,
    }),
    mockPlayer: () => (): IPlayer => ({
      // Person
      hp: { current: 0, max: 0 },
      skills: { hacking: 0, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0, intelligence: 0 },
      exp: { hacking: 0, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0, intelligence: 0 },
      mults: defaultMultipliers(),
      city: CityName.Sector12,
      // Player-specific
      numPeopleKilled: 0,
      money: 0,
      location: LocationName.TravelAgency,
      totalPlaytime: 0,
      jobs: {},
      factions: [],
      entropy: 0,
      karma: 0,
    }),
    mockPerson: () => (): IPerson => ({
      hp: { current: 0, max: 0 },
      skills: { hacking: 0, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0, intelligence: 0 },
      exp: { hacking: 0, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0, intelligence: 0 },
      mults: defaultMultipliers(),
      city: CityName.Sector12,
    }),
    reputation: {
      calculateFavorToRep: (ctx) => (_favor) => {
        const favor = helpers.number(ctx, "favor", _favor);
        checkFormulasAccess(ctx);
        return calculateFavorToRep(favor);
      },
      calculateRepToFavor: (ctx) => (_rep) => {
        const rep = helpers.number(ctx, "rep", _rep);
        checkFormulasAccess(ctx);
        return calculateRepToFavor(rep);
      },
      repFromDonation: (ctx) => (_amount, _player) => {
        const amount = helpers.number(ctx, "amount", _amount);
        const person = helpers.person(ctx, _player);
        checkFormulasAccess(ctx);
        return repFromDonation(amount, person);
      },
      donationForRep: (ctx) => (_reputation, _player) => {
        const reputation = helpers.number(ctx, "reputation", _reputation);
        const person = helpers.person(ctx, _player);
        checkFormulasAccess(ctx);
        return donationForRep(reputation, person);
      },
    },
    skills: {
      calculateSkill:
        (ctx) =>
        (_exp, _mult = 1) => {
          const exp = helpers.number(ctx, "exp", _exp);
          const mult = helpers.number(ctx, "mult", _mult);
          checkFormulasAccess(ctx);
          return calculateSkill(exp, mult);
        },
      calculateExp:
        (ctx) =>
        (_skill, _mult = 1) => {
          const skill = helpers.number(ctx, "skill", _skill);
          const mult = helpers.number(ctx, "mult", _mult);
          checkFormulasAccess(ctx);
          return calculateExp(skill, mult);
        },
    },
    hacking: {
      hackChance: (ctx) => (_server, _player) => {
        const server = helpers.server(ctx, _server);
        const person = helpers.person(ctx, _player);
        checkFormulasAccess(ctx);
        return calculateHackingChance(server, person);
      },
      hackExp: (ctx) => (_server, _player) => {
        const server = helpers.server(ctx, _server);
        const person = helpers.person(ctx, _player);
        checkFormulasAccess(ctx);
        return calculateHackingExpGain(server, person);
      },
      hackPercent: (ctx) => (_server, _player) => {
        const server = helpers.server(ctx, _server);
        const person = helpers.person(ctx, _player);
        checkFormulasAccess(ctx);
        return calculatePercentMoneyHacked(server, person);
      },
      /* TODO 2.3: Remove growPercent, add growMultiplier function?
      Much better name given the output. Not sure if removedFunction error dialog/editing script will be too annoying.
      Changing the function name also allows reordering params as server, player, etc. like other formulas functions */
      growPercent:
        (ctx) =>
        (_server, _threads, _player, _cores = 1) => {
          const server = helpers.server(ctx, _server);
          const person = helpers.person(ctx, _player);
          const threads = helpers.number(ctx, "threads", _threads);
          const cores = helpers.number(ctx, "cores", _cores);
          checkFormulasAccess(ctx);
          return calculateServerGrowth(server, threads, person, cores);
        },
      growThreads:
        (ctx) =>
        (_server, _player, _targetMoney, _cores = 1) => {
          const server = helpers.server(ctx, _server);
          const player = helpers.person(ctx, _player);
          const targetMoney = helpers.number(ctx, "targetMoney", _targetMoney);
          const startMoney = helpers.number(ctx, "server.moneyAvailable", server.moneyAvailable);
          const cores = helpers.number(ctx, "cores", _cores);
          checkFormulasAccess(ctx);
          return numCycleForGrowthCorrected(server, targetMoney, startMoney, cores, player);
        },
      growAmount:
        (ctx) =>
        (_server, _player, _threads, _cores = 1) => {
          const server = helpers.server(ctx, _server);
          const person = helpers.person(ctx, _player);
          const threads = helpers.number(ctx, "threads", _threads);
          const cores = helpers.number(ctx, "cores", _cores);
          checkFormulasAccess(ctx);
          return calculateGrowMoney(server, threads, person, cores);
        },
      hackTime: (ctx) => (_server, _player) => {
        const server = helpers.server(ctx, _server);
        const person = helpers.person(ctx, _player);
        checkFormulasAccess(ctx);
        return calculateHackingTime(server, person) * 1000;
      },
      growTime: (ctx) => (_server, _player) => {
        const server = helpers.server(ctx, _server);
        const person = helpers.person(ctx, _player);
        checkFormulasAccess(ctx);
        return calculateGrowTime(server, person) * 1000;
      },
      weakenTime: (ctx) => (_server, _player) => {
        const server = helpers.server(ctx, _server);
        const person = helpers.person(ctx, _player);
        checkFormulasAccess(ctx);
        return calculateWeakenTime(server, person) * 1000;
      },
    },
    hacknetNodes: {
      moneyGainRate:
        (ctx) =>
        (_level, _ram, _cores, _mult = 1) => {
          const level = helpers.number(ctx, "level", _level);
          const ram = helpers.number(ctx, "ram", _ram);
          const cores = helpers.number(ctx, "cores", _cores);
          const mult = helpers.number(ctx, "mult", _mult);
          checkFormulasAccess(ctx);
          return calculateMoneyGainRate(level, ram, cores, mult);
        },
      levelUpgradeCost:
        (ctx) =>
        (_startingLevel, _extraLevels = 1, _costMult = 1) => {
          const startingLevel = helpers.number(ctx, "startingLevel", _startingLevel);
          const extraLevels = helpers.number(ctx, "extraLevels", _extraLevels);
          const costMult = helpers.number(ctx, "costMult", _costMult);
          checkFormulasAccess(ctx);
          return calculateLevelUpgradeCost(startingLevel, extraLevels, costMult);
        },
      ramUpgradeCost:
        (ctx) =>
        (_startingRam, _extraLevels = 1, _costMult = 1) => {
          const startingRam = helpers.number(ctx, "startingRam", _startingRam);
          const extraLevels = helpers.number(ctx, "extraLevels", _extraLevels);
          const costMult = helpers.number(ctx, "costMult", _costMult);
          checkFormulasAccess(ctx);
          return calculateRamUpgradeCost(startingRam, extraLevels, costMult);
        },
      coreUpgradeCost:
        (ctx) =>
        (_startingCore, _extraCores = 1, _costMult = 1) => {
          const startingCore = helpers.number(ctx, "startingCore", _startingCore);
          const extraCores = helpers.number(ctx, "extraCores", _extraCores);
          const costMult = helpers.number(ctx, "costMult", _costMult);
          checkFormulasAccess(ctx);
          return calculateCoreUpgradeCost(startingCore, extraCores, costMult);
        },
      hacknetNodeCost: (ctx) => (_n, _mult) => {
        const n = helpers.number(ctx, "n", _n);
        const mult = helpers.number(ctx, "mult", _mult);
        checkFormulasAccess(ctx);
        return calculateNodeCost(n, mult);
      },
      constants: (ctx) => () => {
        checkFormulasAccess(ctx);
        return Object.assign({}, HacknetNodeConstants);
      },
    },
    hacknetServers: {
      hashGainRate:
        (ctx) =>
        (_level, _ramUsed, _maxRam, _cores, _mult = 1) => {
          const level = helpers.number(ctx, "level", _level);
          const ramUsed = helpers.number(ctx, "ramUsed", _ramUsed);
          const maxRam = helpers.number(ctx, "maxRam", _maxRam);
          const cores = helpers.number(ctx, "cores", _cores);
          const mult = helpers.number(ctx, "mult", _mult);
          checkFormulasAccess(ctx);
          return HScalculateHashGainRate(level, ramUsed, maxRam, cores, mult);
        },
      levelUpgradeCost:
        (ctx) =>
        (_startingLevel, _extraLevels = 1, _costMult = 1) => {
          const startingLevel = helpers.number(ctx, "startingLevel", _startingLevel);
          const extraLevels = helpers.number(ctx, "extraLevels", _extraLevels);
          const costMult = helpers.number(ctx, "costMult", _costMult);
          checkFormulasAccess(ctx);
          return HScalculateLevelUpgradeCost(startingLevel, extraLevels, costMult);
        },
      ramUpgradeCost:
        (ctx) =>
        (_startingRam, _extraLevels = 1, _costMult = 1) => {
          const startingRam = helpers.number(ctx, "startingRam", _startingRam);
          const extraLevels = helpers.number(ctx, "extraLevels", _extraLevels);
          const costMult = helpers.number(ctx, "costMult", _costMult);
          checkFormulasAccess(ctx);
          return HScalculateRamUpgradeCost(startingRam, extraLevels, costMult);
        },
      coreUpgradeCost:
        (ctx) =>
        (_startingCore, _extraCores = 1, _costMult = 1) => {
          const startingCore = helpers.number(ctx, "startingCore", _startingCore);
          const extraCores = helpers.number(ctx, "extraCores", _extraCores);
          const costMult = helpers.number(ctx, "costMult", _costMult);
          checkFormulasAccess(ctx);
          return HScalculateCoreUpgradeCost(startingCore, extraCores, costMult);
        },
      cacheUpgradeCost:
        (ctx) =>
        (_startingCache, _extraCache = 1) => {
          const startingCache = helpers.number(ctx, "startingCache", _startingCache);
          const extraCache = helpers.number(ctx, "extraCache", _extraCache);
          checkFormulasAccess(ctx);
          return HScalculateCacheUpgradeCost(startingCache, extraCache);
        },
      hashUpgradeCost: (ctx) => (_upgName, _level) => {
        const upgName = helpers.string(ctx, "upgName", _upgName);
        const level = helpers.number(ctx, "level", _level);
        checkFormulasAccess(ctx);
        const upg = Player.hashManager.getUpgrade(upgName);
        if (!upg) {
          throw helpers.errorMessage(ctx, `Invalid Hash Upgrade: ${upgName}`);
        }
        return upg.getCost(level);
      },
      hacknetServerCost:
        (ctx) =>
        (_n, _mult = 1) => {
          const n = helpers.number(ctx, "n", _n);
          const mult = helpers.number(ctx, "mult", _mult);
          checkFormulasAccess(ctx);
          return HScalculateServerCost(n, mult);
        },
      constants: (ctx) => () => {
        checkFormulasAccess(ctx);
        return Object.assign({}, HacknetServerConstants);
      },
    },
    gang: {
      wantedPenalty: (ctx) => (_gang) => {
        const gang = helpers.gang(ctx, _gang);
        checkFormulasAccess(ctx);
        return calculateWantedPenalty(gang);
      },
      respectGain: (ctx) => (_gang, _member, _task) => {
        const gang = helpers.gang(ctx, _gang);
        const member = helpers.gangMember(ctx, _member);
        const task = helpers.gangTask(ctx, _task);
        checkFormulasAccess(ctx);
        return calculateRespectGain(gang, member, task);
      },
      wantedLevelGain: (ctx) => (_gang, _member, _task) => {
        const gang = helpers.gang(ctx, _gang);
        const member = helpers.gangMember(ctx, _member);
        const task = helpers.gangTask(ctx, _task);
        checkFormulasAccess(ctx);
        return calculateWantedLevelGain(gang, member, task);
      },
      moneyGain: (ctx) => (_gang, _member, _task) => {
        const gang = helpers.gang(ctx, _gang);
        const member = helpers.gangMember(ctx, _member);
        const task = helpers.gangTask(ctx, _task);
        checkFormulasAccess(ctx);
        return calculateMoneyGain(gang, member, task);
      },
      ascensionPointsGain: (ctx) => (_exp) => {
        const exp = helpers.number(ctx, "exp", _exp);
        checkFormulasAccess(ctx);
        return calculateAscensionPointsGain(exp);
      },
      ascensionMultiplier: (ctx) => (_points) => {
        const points = helpers.number(ctx, "points", _points);
        checkFormulasAccess(ctx);
        return calculateAscensionMult(points);
      },
    },
    work: {
      crimeSuccessChance: (ctx) => (_person, _crimeType) => {
        checkFormulasAccess(ctx);
        const person = helpers.person(ctx, _person);
        const crime = findCrime(helpers.string(ctx, "crimeType", _crimeType));
        if (!crime) throw new Error(`Invalid crime type: ${_crimeType}`);
        return crime.successRate(person);
      },
      crimeGains: (ctx) => (_person, _crimeType) => {
        checkFormulasAccess(ctx);
        const person = helpers.person(ctx, _person);
        const crime = findCrime(helpers.string(ctx, "crimeType", _crimeType));
        if (!crime) throw new Error(`Invalid crime type: ${_crimeType}`);
        return calculateCrimeWorkStats(person, crime);
      },
      gymGains: (ctx) => (_person, _classType, _locationName) => {
        checkFormulasAccess(ctx);
        const person = helpers.person(ctx, _person);
        const classType = findEnumMember(GymType, helpers.string(ctx, "classType", _classType));
        if (!classType) throw new Error(`Invalid gym training type: ${_classType}`);
        const locationName = getEnumHelper("LocationName").nsGetMember(ctx, _locationName);
        return calculateClassEarnings(person, classType, locationName);
      },
      universityGains: (ctx) => (_person, _classType, _locationName) => {
        checkFormulasAccess(ctx);
        const person = helpers.person(ctx, _person);
        const classType = findEnumMember(UniversityClassType, helpers.string(ctx, "classType", _classType));
        if (!classType) throw new Error(`Invalid university class type: ${_classType}`);
        const locationName = getEnumHelper("LocationName").nsGetMember(ctx, _locationName);
        return calculateClassEarnings(person, classType, locationName);
      },
      factionGains: (ctx) => (_player, _workType, _favor) => {
        checkFormulasAccess(ctx);
        const player = helpers.person(ctx, _player);
        const workType = findEnumMember(FactionWorkType, helpers.string(ctx, "_workType", _workType));
        if (!workType) throw new Error(`Invalid faction work type: ${_workType}`);
        const favor = helpers.number(ctx, "favor", _favor);
        const exp = calculateFactionExp(player, workType);
        const rep = calculateFactionRep(player, workType, favor);
        exp.reputation = rep;
        return exp;
      },
      companyGains: (ctx) => (_person, _companyName, _positionName, _favor) => {
        checkFormulasAccess(ctx);
        const person = helpers.person(ctx, _person);
        const companyName = getEnumHelper("CompanyName").nsGetMember(ctx, _companyName);
        const company = Companies[companyName];
        const positionName = getEnumHelper("JobName").nsGetMember(ctx, _positionName);
        const position = CompanyPositions[positionName];
        const favor = helpers.number(ctx, "favor", _favor);
        return calculateCompanyWorkStats(person, company, position, favor);
      },
    },
    bladeburner: {
      skillMaxUpgradeCount: (ctx) => (_name, _level, _skillPoints) => {
        checkFormulasAccess(ctx);
        const name = getEnumHelper("BladeburnerSkillName").nsGetMember(ctx, _name, "name");
        const level = helpers.number(ctx, "level", _level);
        if (!Number.isFinite(level) || level < 0) {
          throw new Error(`Level must be a finite, non-negative number. Its value is ${level}.`);
        }
        const skillPoints = helpers.number(ctx, "skillPoints", _skillPoints);
        if (!Number.isFinite(skillPoints) || skillPoints < 0) {
          throw new Error(`SkillPoints must be a finite, non-negative number. Its value is ${skillPoints}.`);
        }
        const skill = Skills[name];
        if (level >= skill.maxLvl) {
          return 0;
        }
        if (skillPoints === 0) {
          return 0;
        }
        return skill.calculateMaxUpgradeCount(level, skillPoints as PositiveNumber);
      },
    },
  };

  // Removed functions
  setRemovedFunctions(formulasFunctions.work, {
    classGains: { version: "2.2.0", replacement: "formulas.work.universityGains or formulas.work.gymGains" },
  });
  return formulasFunctions;
}
