import { setPlayer } from "@player";
import { GoOpponent, GoColor } from "@enums";
import { boardStateFromSimpleBoard } from "../../../src/Go/boardAnalysis/boardAnalysis";
import { getMove } from "../../../src/Go/boardAnalysis/goAI";
import { PlayerObject } from "../../../src/PersonObjects/Player/PlayerObject";
import "../../../src/Faction/Factions";

jest.mock("../../../src/Faction/Factions", () => ({
  Factions: {},
}));

setPlayer(new PlayerObject());

describe("Go AI tests", () => {
  it("prioritizes capture for Black Hand", async () => {
    let board = ["XO...", ".....", ".....", ".....", "....."];
    let boardState = boardStateFromSimpleBoard(board, GoOpponent.TheBlackHand);
    let move = await getMove(boardState, GoColor.white, GoOpponent.TheBlackHand);

    expect([move.x, move.y]).toEqual([1, 0]);
  });

  it("prioritizes defense for Slum Snakes", async () => {
    let board = ["OX...", ".....", ".....", ".....", "....."];
    let boardState = boardStateFromSimpleBoard(board, GoOpponent.SlumSnakes);
    let move = await getMove(boardState, GoColor.white, GoOpponent.SlumSnakes);

    expect([move.x, move.y]).toEqual([1, 0]);
  });

  it("prioritizes eye creation moves for Illuminati", async () => {
    let board = ["...O...", "OOOO...", ".......", ".......", ".......", ".......", "......."];
    let boardState = boardStateFromSimpleBoard(board, GoOpponent.Daedalus);
    let move = await getMove(boardState, GoColor.white, GoOpponent.Daedalus, false, 0);

    expect([move.x, move.y]).toEqual([0, 1]);
  });
});
