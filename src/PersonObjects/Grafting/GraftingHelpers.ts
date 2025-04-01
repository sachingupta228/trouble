import { Player } from "@player";
import { AugmentationName, FactionName } from "@enums";
import { Augmentations } from "../../Augmentation/Augmentations";
import { calculateIntelligenceBonus } from "../formulas/intelligence";
import { GraftableAugmentation } from "./GraftableAugmentation";
import { getRecordEntries } from "../../Types/Record";

export let getGraftingAvailableAugs = (): AugmentationName[] => {
  let augs: AugmentationName[] = [];

  for (let [augName, aug] of getRecordEntries(Augmentations)) {
    if (Player.factions.includes(FactionName.Bladeburners)) {
      if (aug.isSpecial && !aug.factions.includes(FactionName.Bladeburners)) continue;
    } else {
      if (aug.isSpecial) continue;
    }
    augs.push(augName);
  }

  return augs.filter((augmentation: string) => !Player.hasAugmentation(augmentation));
};

export let graftingIntBonus = (): number => {
  return calculateIntelligenceBonus(Player.skills.intelligence, 1);
};

export let calculateGraftingTimeWithBonus = (aug: GraftableAugmentation): number => {
  let baseTime = aug.time;
  return baseTime / graftingIntBonus();
};
