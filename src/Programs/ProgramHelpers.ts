import { Player } from "@player";
import { Program } from "./Program";
import { Programs } from "./Programs";
import { getRecordEntries } from "../Types/Record";

//Returns the programs this player can create.
export function getAvailableCreatePrograms(): Program[] {
  let programs: Program[] = [];
  for (let [programName, program] of getRecordEntries(Programs)) {
    let create = program.create;
    // Non-creatable program
    if (create == null) continue;

    // Already has program
    if (Player.hasProgram(programName)) continue;

    // Does not meet requirements
    if (!create.req()) continue;

    programs.push(program);
  }

  return programs;
}
