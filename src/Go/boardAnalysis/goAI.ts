import type { Board, BoardState, EyeMove, Move, MoveOptions, MoveType, Play, PointState } from "../Types";

import { Player } from "@player";
import { AugmentationName, GoColor, GoOpponent, GoPlayType } from "@enums";
import { opponentDetails } from "../Constants";
import { findNeighbors, isNotNullish, makeMove, passTurn } from "../boardState/boardState";
import {
  evaluateIfMoveIsValid,
  evaluateMoveResult,
  findEffectiveLibertiesOfNewMove,
  findEnemyNeighborChainWithFewestLiberties,
  findMinLibertyCountOfAdjacentChains,
  getAllChains,
  getAllEyes,
  getAllEyesByChainId,
  getAllNeighboringChains,
  getPreviousMoveDetails,
} from "./boardAnalysis";
import { findDisputedTerritory } from "./controlledTerritory";
import { findAnyMatchedPatterns } from "./patternMatching";
import { WHRNG } from "../../Casino/RNG";
import { Go, GoEvents } from "../Go";
import { exceptionAlert } from "../../utils/helpers/exceptionAlert";

type PlayerPromise = {
  nextTurn: Promise<Play>;
  resolver: ((play?: Play) => void) | null;
};

const gameOver: Play = { type: GoPlayType.gameOver, x: null, y: null } as const;
const playerPromises: Record<GoColor.black | GoColor.white, PlayerPromise> = {
  [GoColor.black]: { nextTurn: Promise.resolve(gameOver), resolver: null },
  [GoColor.white]: { nextTurn: Promise.resolve(gameOver), resolver: null },
};
// The promises aren't in a fully working state until we do this.
// It is OK to reset the AI multiple times in a row.
resetAI();

export function getNextTurn(color: GoColor.black | GoColor.white): Promise<Play> {
  return playerPromises[color].nextTurn;
}

export function resetGoPromises(): void {
  resetAI();
  handleNextTurn().catch((error) => exceptionAlert(error, true));
}

/**
 * Does common processing in response to a move being made.
 *
 * Due to asynchronous and/or timer-based functions, this function might be
 * called multiple times per turn. Therefore, it is (and must be) idempotent.
 * It is also used to handle the first turn of the game, and post-load
 * processing.
 * On the AI's turn, it starts AI processing. On all turns, it does promise
 * handling and dispatches common events.
 * @returns the nextTurn promise for the player who just moved
 */
export function handleNextTurn(boardState: BoardState = Go.currentGame, useOfflineCycles = true): Promise<Play> {
  const previousColor = boardState.previousPlayer;
  if (previousColor === null) {
    // The game is over. We shouldn't get here in most circumstances,
    // because when the game ends resetAI() will be called to resolve promises.
    // Return an already-resolved promise until a new game is started.
    return Promise.resolve(gameOver);
  }
  const currentColor = previousColor === GoColor.black ? GoColor.white : GoColor.black;
  // Promises are indexed by who wants to wait on them, not by who triggers them.
  // So the index color is reversed here.
  const previousPromise = playerPromises[currentColor];
  const currentPromise = playerPromises[currentColor === GoColor.black ? GoColor.white : GoColor.black];
  // If we've already handled this turn, return the existing promise.
  if (previousPromise.resolver === null) {
    return currentPromise.nextTurn;
  }
  previousPromise.resolver();
  previousPromise.resolver = null;
  GoEvents.emit();

  // If an AI is in use, find the faction's move in response, and recursively call handleNextTurn to resolve the nextTurn promise once it is found and played.
  if (boardState.ai !== GoOpponent.none && currentColor == GoColor.white) {
    const currentMoveCount = Go.currentGame.previousBoards.length;
    getMove(boardState, currentColor, Go.currentGame.ai, useOfflineCycles)
      .then(async (play) => {
        if (currentMoveCount !== Go.currentGame.previousBoards.length || boardState !== Go.currentGame) {
          //Stale game
          return;
        }

        // Handle AI passing
        if (play.type === GoPlayType.pass) {
          passTurn(boardState, currentColor);
          return handleNextTurn(boardState, useOfflineCycles);
        }

        // Handle AI making a move
        await waitCycle(useOfflineCycles);

        if (currentMoveCount !== Go.currentGame.previousBoards.length || boardState !== Go.currentGame) {
          console.warn("AI move attempted, but the board state has changed.");
          return;
        }

        const aiUpdatedBoard = makeMove(boardState, play.x, play.y, currentColor);

        // Handle the AI breaking. This shouldn't ever happen.
        if (!aiUpdatedBoard) {
          boardState.previousPlayer = currentColor;
          console.error(`Invalid AI move attempted: ${play.x}, ${play.y}. This should not happen.`);
        }
        // Recursively update promises for the next turn. This can't create an
        // infinite loop because the recursion is happenning asynchronously from a
        // delayed promise.
        return handleNextTurn(boardState, useOfflineCycles);
      })
      .catch((error) => exceptionAlert(error));
  }

  // If we haven't resolved currentPromise yet (for instance, at game start),
  // we should continue to use it instead of resolving it and creating a new one.
  if (!currentPromise.resolver) {
    createPromise(currentPromise);
  }
  return currentPromise.nextTurn;
}

/**
 * Reset the promises for white and black turns.
 * This will notify scripts waiting on the old promises with gameOver,
 * potentially even when it is not their turn.
 * If the game has already ended, it won't re-notify (that was handled in
 * endGoGame()), which is why it is important to call this *before* resetting
 * the board state.
 */
export function resetAI(endOfGame = false): void {
  for (const playerPromise of Object.values(playerPromises)) {
    if (playerPromise.resolver) {
      playerPromise.resolver(gameOver);
      playerPromise.resolver = null;
    }
    if (!endOfGame && !playerPromise.resolver) {
      createPromise(playerPromise);
    }
  }
}

// Returns a promise that resolves with the previous move details when the other player / script / AI makes a move
function createPromise(promiseObj: PlayerPromise): void {
  promiseObj.resolver?.();
  promiseObj.nextTurn = new Promise((resolve) => {
    promiseObj.resolver = (play?: Play) => resolve(play ?? getPreviousMoveDetails());
  });
}

/*
  Basic GO AIs, each with some personality and weaknesses

  The AIs are aware of chains of connected pieces, their liberties, and their eyes.
  They know how to lok for moves that capture or threaten capture, moves that create eyes, and moves that take
     away liberties from their opponent, as well as some pattern matching on strong move ideas.

  They do not know about larger jump moves, nor about frameworks on the board. Also, they each have a tendancy to
     over-focus on a different type of move, giving each AI a different playstyle and weakness to exploit.
 */

/**
 * Finds an array of potential moves based on the current board state, then chooses one
 * based on the given opponent's personality and preferences. If no preference is given by the AI,
 * will choose one from the reasonable moves at random.
 *
 * @returns a promise that will resolve with a move (or pass) from the designated AI opponent.
 */
export async function getMove(
  boardState: BoardState,
  player: GoColor,
  opponent: GoOpponent,
  useOfflineCycles = true,
  rngOverride?: number,
): Promise<Play & { type: GoPlayType.move | GoPlayType.pass }> {
  await waitCycle(useOfflineCycles);
  const rng = new WHRNG(rngOverride || Player.totalPlaytime);
  const smart = isSmart(opponent, rng.random());
  const moves = getMoveOptions(boardState, player, rng.random(), smart);

  const priorityMove = await getFactionMove(moves, opponent, rng.random());
  if (priorityMove) {
    return {
      type: GoPlayType.move,
      x: priorityMove.x,
      y: priorityMove.y,
    };
  }

  // If no priority move is chosen, pick one of the reasonable moves
  const moveOptions = [
    moves.growth()?.point,
    moves.surround()?.point,
    moves.defend()?.point,
    moves.expansion()?.point,
    (await moves.pattern())?.point,
    moves.eyeMove()?.point,
    moves.eyeBlock()?.point,
  ]
    .filter(isNotNullish)
    .filter((point) => evaluateIfMoveIsValid(boardState, point.x, point.y, player, false));

  const chosenMove = moveOptions[Math.floor(rng.random() * moveOptions.length)];
  await waitCycle(useOfflineCycles);

  if (chosenMove) {
    //console.debug(`Non-priority move chosen: ${chosenMove.x} ${chosenMove.y}`);
    return { type: GoPlayType.move, x: chosenMove.x, y: chosenMove.y };
  }
  // Pass if no valid moves were found
  return { type: GoPlayType.pass, x: null, y: null };
}

/**
 * Given a group of move options, chooses one based on the given opponent's personality (if any fit their priorities)
 */
async function getFactionMove(moves: MoveOptions, faction: GoOpponent, rng: number): Promise<PointState | null> {
  if (faction === GoOpponent.Netburners) {
    return getNetburnersPriorityMove(moves, rng);
  }
  if (faction === GoOpponent.SlumSnakes) {
    return getSlumSnakesPriorityMove(moves, rng);
  }
  if (faction === GoOpponent.TheBlackHand) {
    return getBlackHandPriorityMove(moves, rng);
  }
  if (faction === GoOpponent.Tetrads) {
    return getTetradPriorityMove(moves, rng);
  }
  if (faction === GoOpponent.Daedalus) {
    return getDaedalusPriorityMove(moves, rng);
  }

  return getIlluminatiPriorityMove(moves, rng);
}

/**
 * Determines if certain failsafes and mistake avoidance are enabled for the given move
 */
function isSmart(faction: GoOpponent, rng: number) {
  if (faction === GoOpponent.Netburners) {
    return false;
  }
  if (faction === GoOpponent.SlumSnakes) {
    return rng < 0.3;
  }
  if (faction === GoOpponent.TheBlackHand) {
    return rng < 0.8;
  }

  return true;
}

/**
 * Netburners mostly just put random points around the board, but occasionally have a smart move
 */
async function getNetburnersPriorityMove(moves: MoveOptions, rng: number): Promise<PointState | null> {
  if (rng < 0.2) {
    return getIlluminatiPriorityMove(moves, rng);
  } else if (rng < 0.4 && moves.expansion()) {
    return moves.expansion()?.point ?? null;
  } else if (rng < 0.6 && moves.growth()) {
    return moves.growth()?.point ?? null;
  } else if (rng < 0.75) {
    return moves.random()?.point ?? null;
  }

  return null;
}

/**
 * Slum snakes prioritize defending their pieces and building chains that snake around as much of the bord as possible.
 */
async function getSlumSnakesPriorityMove(moves: MoveOptions, rng: number): Promise<PointState | null> {
  if (await moves.defendCapture()) {
    return (await moves.defendCapture())?.point ?? null;
  }

  if (rng < 0.2) {
    return getIlluminatiPriorityMove(moves, rng);
  } else if (rng < 0.6 && moves.growth()) {
    return moves.growth()?.point ?? null;
  } else if (rng < 0.65) {
    return moves.random()?.point ?? null;
  }

  return null;
}

/**
 * Black hand just wants to smOrk. They always capture or smother the opponent if possible.
 */
async function getBlackHandPriorityMove(moves: MoveOptions, rng: number): Promise<PointState | null> {
  if (await moves.capture()) {
    //console.debug("capture: capture move chosen");
    return (await moves.capture())?.point ?? null;
  }

  const surround = moves.surround();

  if (surround && surround.point && (surround.newLibertyCount ?? 999) <= 1) {
    //console.debug("surround move chosen");
    return surround.point;
  }

  if (await moves.defendCapture()) {
    //console.debug("defend capture: defend move chosen");
    return (await moves.defendCapture())?.point ?? null;
  }

  if (surround && surround.point && (surround?.newLibertyCount ?? 999) <= 2) {
    //console.debug("surround move chosen");
    return surround.point;
  }

  if (rng < 0.3) {
    return getIlluminatiPriorityMove(moves, rng);
  } else if (rng < 0.75 && surround) {
    return surround.point;
  } else if (rng < 0.8) {
    return moves.random()?.point ?? null;
  }

  return null;
}

/**
 * Tetrads really like to be up close and personal, cutting and circling their opponent
 */
async function getTetradPriorityMove(moves: MoveOptions, rng: number): Promise<PointState | null> {
  if (await moves.capture()) {
    //console.debug("capture: capture move chosen");
    return (await moves.capture())?.point ?? null;
  }

  if (await moves.defendCapture()) {
    //console.debug("defend capture: defend move chosen");
    return (await moves.defendCapture())?.point ?? null;
  }

  if (await moves.pattern()) {
    //console.debug("pattern match move chosen");
    return (await moves.pattern())?.point ?? null;
  }

  const surround = moves.surround();
  if (surround && surround.point && (surround?.newLibertyCount ?? 9) <= 1) {
    //console.debug("surround move chosen");
    return surround.point;
  }

  if (rng < 0.4) {
    return getIlluminatiPriorityMove(moves, rng);
  }

  return null;
}

/**
 * Daedalus almost always picks the Illuminati move, but very occasionally gets distracted.
 */
async function getDaedalusPriorityMove(moves: MoveOptions, rng: number): Promise<PointState | null> {
  if (rng < 0.9) {
    return await getIlluminatiPriorityMove(moves, rng);
  }

  return null;
}

/**
 * First prioritizes capturing of opponent pieces.
 * Then, preventing capture of their own pieces.
 * Then, creating "eyes" to solidify their control over the board
 * Then, finding opportunities to capture on their next move
 * Then, blocking the opponent's attempts to create eyes
 * Finally, will match any of the predefined local patterns indicating a strong move.
 */
async function getIlluminatiPriorityMove(moves: MoveOptions, rng: number): Promise<PointState | null> {
  if (await moves.capture()) {
    //console.debug("capture: capture move chosen");
    return (await moves.capture())?.point ?? null;
  }

  if (await moves.defendCapture()) {
    //console.debug("defend capture: defend move chosen");
    return (await moves.defendCapture())?.point ?? null;
  }

  if (moves.eyeMove()) {
    //console.debug("Create eye move chosen");
    return moves.eyeMove()?.point ?? null;
  }

  const surround = moves.surround();
  if (surround && surround.point && (surround?.newLibertyCount ?? 9) <= 1) {
    //console.debug("surround move chosen");
    return surround.point;
  }

  if (moves.eyeBlock()) {
    //console.debug("Block eye move chosen");
    return moves.eyeBlock()?.point ?? null;
  }

  if (moves.corner()) {
    //console.debug("Corner move chosen");
    return moves.corner()?.point ?? null;
  }

  const hasMoves = [moves.eyeMove(), moves.eyeBlock(), moves.growth(), moves.defend(), surround].filter(
    (m) => m,
  ).length;
  const usePattern = rng > 0.25 || !hasMoves;

  if ((await moves.pattern()) && usePattern) {
    //console.debug("pattern match move chosen");
    return (await moves.pattern())?.point ?? null;
  }

  if (rng > 0.4 && moves.jump()) {
    //console.debug("Jump move chosen");
    return moves.jump()?.point ?? null;
  }

  if (rng < 0.6 && surround && surround.point && (surround?.newLibertyCount ?? 9) <= 2) {
    //console.debug("surround move chosen");
    return surround.point;
  }

  return null;
}

/**
 * Get a move that places a piece to influence (and later control) a corner
 */
function getCornerMove(board: Board) {
  const boardEdge = board[0].length - 1;
  const cornerMax = boardEdge - 2;
  if (isCornerAvailableForMove(board, cornerMax, cornerMax, boardEdge, boardEdge)) {
    return board[cornerMax][cornerMax];
  }
  if (isCornerAvailableForMove(board, 0, cornerMax, 2, boardEdge)) {
    return board[2][cornerMax];
  }
  if (isCornerAvailableForMove(board, 0, 0, 2, 2)) {
    return board[2][2];
  }
  if (isCornerAvailableForMove(board, cornerMax, 0, boardEdge, 2)) {
    return board[cornerMax][2];
  }
  return null;
}

/**
 * Find all non-offline nodes in a given area
 */
function findLiveNodesInArea(board: Board, x1: number, y1: number, x2: number, y2: number) {
  const foundPoints: PointState[] = [];
  board.forEach((column) =>
    column.forEach(
      (point) => point && point.x >= x1 && point.x <= x2 && point.y >= y1 && point.y <= y2 && foundPoints.push(point),
    ),
  );
  return foundPoints;
}

/**
 * Determine if a corner is largely intact and currently empty, and thus a good target for corner takeover moves
 */
function isCornerAvailableForMove(board: Board, x1: number, y1: number, x2: number, y2: number) {
  const foundPoints = findLiveNodesInArea(board, x1, y1, x2, y2);
  const foundPieces = foundPoints.filter((point) => point.color !== GoColor.empty);
  return foundPoints.length >= 7 ? foundPieces.length === 0 : false;
}

/**
 * Select a move from the list of open-area moves
 */
function getExpansionMove(board: Board, availableSpaces: PointState[], rng: number, moveArray?: Move[]) {
  const moveOptions = moveArray ?? getExpansionMoveArray(board, availableSpaces);
  const randomIndex = Math.floor(rng * moveOptions.length);
  return moveOptions[randomIndex];
}

/**
 * Get a move in open space that is nearby a friendly piece
 */
function getJumpMove(board: Board, player: GoColor, availableSpaces: PointState[], rng: number, moveArray?: Move[]) {
  const moveOptions = (moveArray ?? getExpansionMoveArray(board, availableSpaces)).filter(({ point }) =>
    [
      board[point.x]?.[point.y + 2],
      board[point.x + 2]?.[point.y],
      board[point.x]?.[point.y - 2],
      board[point.x - 2]?.[point.y],
    ].some((point) => point?.color === player),
  );

  const randomIndex = Math.floor(rng * moveOptions.length);
  return moveOptions[randomIndex];
}

/**
 * Finds a move in an open area to expand influence and later build on
 */
export function getExpansionMoveArray(board: Board, availableSpaces: PointState[]): Move[] {
  // Look for any empty spaces fully surrounded by empty spaces to expand into
  const emptySpaces = availableSpaces.filter((space) => {
    const neighbors = findNeighbors(board, space.x, space.y);
    return (
      [neighbors.north, neighbors.east, neighbors.south, neighbors.west].filter(
        (point) => point && point.color === GoColor.empty,
      ).length === 4
    );
  });

  // Once no such empty areas exist anymore, instead expand into any disputed territory
  // to gain a few more points in endgame
  const disputedSpaces = emptySpaces.length ? [] : getDisputedTerritoryMoves(board, availableSpaces, 1);

  const moveOptions = [...emptySpaces, ...disputedSpaces];

  return moveOptions.map((point) => {
    return {
      point: point,
      newLibertyCount: -1,
      oldLibertyCount: -1,
    };
  });
}

function getDisputedTerritoryMoves(board: Board, availableSpaces: PointState[], maxChainSize = 99) {
  const chains = getAllChains(board).filter((chain) => chain.length <= maxChainSize);

  return availableSpaces.filter((space) => {
    const chain = chains.find((chain) => chain[0].chain === space.chain) ?? [];
    const playerNeighbors = getAllNeighboringChains(board, chain, chains);
    const hasWhitePieceNeighbor = playerNeighbors.find((neighborChain) => neighborChain[0]?.color === GoColor.white);
    const hasBlackPieceNeighbor = playerNeighbors.find((neighborChain) => neighborChain[0]?.color === GoColor.black);

    return hasWhitePieceNeighbor && hasBlackPieceNeighbor;
  });
}

/**
 * Finds all moves that increases the liberties of the player's pieces, making them harder to capture and occupy more space on the board.
 */
function getLibertyGrowthMoves(board: Board, player: GoColor, availableSpaces: PointState[]) {
  const friendlyChains = getAllChains(board).filter((chain) => chain[0].color === player);

  if (!friendlyChains.length) {
    return [];
  }

  // Get all liberties of friendly chains as potential growth move options
  const liberties = friendlyChains
    .map((chain) =>
      chain[0].liberties?.filter(isNotNullish).map((liberty) => ({
        libertyPoint: liberty,
        oldLibertyCount: chain[0].liberties?.length,
      })),
    )
    .flat()
    .filter(isNotNullish)
    .filter((liberty) =>
      availableSpaces.find((point) => liberty.libertyPoint.x === point.x && liberty.libertyPoint.y === point.y),
    );

  // Find a liberty where playing a piece increases the liberty of the chain (aka expands or defends the chain)
  return liberties
    .map((liberty) => {
      const move = liberty.libertyPoint;

      const newLibertyCount = findEffectiveLibertiesOfNewMove(board, move.x, move.y, player).length;

      // Get the smallest liberty count of connected chains to represent the old state
      const oldLibertyCount = findMinLibertyCountOfAdjacentChains(board, move.x, move.y, player);

      return {
        point: move,
        oldLibertyCount: oldLibertyCount,
        newLibertyCount: newLibertyCount,
      };
    })
    .filter((move) => move.newLibertyCount > 1 && move.newLibertyCount >= move.oldLibertyCount);
}

/**
 * Find a move that increases the player's liberties by the maximum amount
 */
function getGrowthMove(board: Board, player: GoColor, availableSpaces: PointState[], rng: number) {
  const growthMoves = getLibertyGrowthMoves(board, player, availableSpaces);

  const maxLibertyCount = Math.max(...growthMoves.map((l) => l.newLibertyCount - l.oldLibertyCount));

  const moveCandidates = growthMoves.filter((l) => l.newLibertyCount - l.oldLibertyCount === maxLibertyCount);
  return moveCandidates[Math.floor(rng * moveCandidates.length)];
}

/**
 * Find a move that specifically increases a chain's liberties from 1 to more than 1, preventing capture
 */
function getDefendMove(board: Board, player: GoColor, availableSpaces: PointState[]) {
  const growthMoves = getLibertyGrowthMoves(board, player, availableSpaces);
  const libertyIncreases =
    growthMoves?.filter((move) => move.oldLibertyCount <= 1 && move.newLibertyCount > move.oldLibertyCount) ?? [];

  const maxLibertyCount = Math.max(...libertyIncreases.map((l) => l.newLibertyCount - l.oldLibertyCount));

  if (maxLibertyCount < 1) {
    return null;
  }

  const moveCandidates = libertyIncreases.filter((l) => l.newLibertyCount - l.oldLibertyCount === maxLibertyCount);
  return moveCandidates[Math.floor(Math.random() * moveCandidates.length)];
}

/**
 * Find a move that reduces the opponent's liberties as much as possible,
 *   capturing (or making it easier to capture) their pieces
 */
function getSurroundMove(board: Board, player: GoColor, availableSpaces: PointState[], smart = true) {
  const opposingPlayer = player === GoColor.black ? GoColor.white : GoColor.black;
  const enemyChains = getAllChains(board).filter((chain) => chain[0].color === opposingPlayer);

  if (!enemyChains.length || !availableSpaces.length) {
    return null;
  }

  const enemyLiberties = enemyChains
    .map((chain) => chain[0].liberties)
    .flat()
    .filter((liberty) => availableSpaces.find((point) => liberty?.x === point.x && liberty?.y === point.y))
    .filter(isNotNullish);

  const captureMoves: Move[] = [];
  const atariMoves: Move[] = [];
  const surroundMoves: Move[] = [];

  enemyLiberties.forEach((move) => {
    const newLibertyCount = findEffectiveLibertiesOfNewMove(board, move.x, move.y, player).length;

    const weakestEnemyChain = findEnemyNeighborChainWithFewestLiberties(
      board,
      move.x,
      move.y,
      player === GoColor.black ? GoColor.white : GoColor.black,
    );
    const weakestEnemyChainLength = weakestEnemyChain?.length ?? 99;

    const enemyChainLibertyCount = weakestEnemyChain?.[0]?.liberties?.length ?? 99;

    const enemyLibertyGroups = [
      ...(weakestEnemyChain?.[0]?.liberties ?? []).reduce(
        (chainIDs, point) => chainIDs.add(point?.chain ?? ""),
        new Set<string>(),
      ),
    ];

    // Do not suggest moves that do not capture anything and let your opponent immediately capture
    if (newLibertyCount <= 2 && enemyChainLibertyCount > 2) {
      return;
    }

    // If a neighboring enemy chain has only one liberty, the current move suggestion will capture
    if (enemyChainLibertyCount <= 1) {
      captureMoves.push({
        point: move,
        oldLibertyCount: enemyChainLibertyCount,
        newLibertyCount: enemyChainLibertyCount - 1,
      });
    }

    // If the move puts the enemy chain in threat of capture, it forces the opponent to respond.
    // Only do this if your piece cannot be captured, or if the enemy group is surrounded and vulnerable to losing its only interior space
    else if (
      enemyChainLibertyCount === 2 &&
      (newLibertyCount >= 2 || (enemyLibertyGroups.length === 1 && weakestEnemyChainLength > 3) || !smart)
    ) {
      atariMoves.push({
        point: move,
        oldLibertyCount: enemyChainLibertyCount,
        newLibertyCount: enemyChainLibertyCount - 1,
      });
    }

    // If the move will not immediately get re-captured, and limit's the opponent's liberties
    else if (newLibertyCount >= 2) {
      surroundMoves.push({
        point: move,
        oldLibertyCount: enemyChainLibertyCount,
        newLibertyCount: enemyChainLibertyCount - 1,
      });
    }
  });

  return [...captureMoves, ...atariMoves, ...surroundMoves][0];
}

/**
 * Finds all moves that would create an eye for the given player.
 *
 * An "eye" is empty point(s) completely surrounded by a single player's connected pieces.
 * If a chain has multiple eyes, it cannot be captured by the opponent (since they can only fill one eye at a time,
 *  and suiciding your own pieces is not legal unless it captures the opponents' first)
 */
function getEyeCreationMoves(board: Board, player: GoColor, availableSpaces: PointState[], maxLiberties = 99) {
  const allEyes = getAllEyesByChainId(board, player);
  const currentEyes = getAllEyes(board, player, allEyes);

  const currentLivingGroupIDs = Object.keys(allEyes).filter((chainId) => allEyes[chainId].length >= 2);
  const currentLivingGroupsCount = currentLivingGroupIDs.length;
  const currentEyeCount = currentEyes.filter((eye) => eye.length).length;

  const chains = getAllChains(board);
  const friendlyLiberties = chains
    .filter((chain) => chain[0].color === player)
    .filter((chain) => chain.length > 1)
    .filter((chain) => chain[0].liberties && chain[0].liberties?.length <= maxLiberties)
    .filter((chain) => !currentLivingGroupIDs.includes(chain[0].chain))
    .map((chain) => chain[0].liberties)
    .flat()
    .filter(isNotNullish)
    .filter((point) =>
      availableSpaces.find((availablePoint) => availablePoint.x === point.x && availablePoint.y === point.y),
    )
    .filter((point: PointState) => {
      const neighbors = findNeighbors(board, point.x, point.y);
      const neighborhood = [neighbors.north, neighbors.east, neighbors.south, neighbors.west];
      return (
        neighborhood.filter((point) => !point || point?.color === player).length >= 2 &&
        neighborhood.some((point) => point?.color === GoColor.empty)
      );
    });

  const eyeCreationMoves = friendlyLiberties.reduce((moveOptions: EyeMove[], point: PointState) => {
    const evaluationBoard = evaluateMoveResult(board, point.x, point.y, player);
    const newEyes = getAllEyes(evaluationBoard, player);
    const newLivingGroupsCount = newEyes.filter((eye) => eye.length >= 2).length;
    const newEyeCount = newEyes.filter((eye) => eye.length).length;
    if (
      newLivingGroupsCount > currentLivingGroupsCount ||
      (newEyeCount > currentEyeCount && newLivingGroupsCount === currentLivingGroupsCount)
    ) {
      moveOptions.push({
        point: point,
        createsLife: newLivingGroupsCount > currentLivingGroupsCount,
      });
    }
    return moveOptions;
  }, []);

  return eyeCreationMoves.sort((moveA, moveB) => +moveB.createsLife - +moveA.createsLife);
}

function getEyeCreationMove(board: Board, player: GoColor, availableSpaces: PointState[]) {
  return getEyeCreationMoves(board, player, availableSpaces)[0];
}

/**
 * If there is only one move that would create two eyes for the opponent, it should be blocked if possible
 */
function getEyeBlockingMove(board: Board, player: GoColor, availablePoints: PointState[]) {
  const opposingPlayer = player === GoColor.white ? GoColor.black : GoColor.white;
  const opponentEyeMoves = getEyeCreationMoves(board, opposingPlayer, availablePoints, 5);
  const twoEyeMoves = opponentEyeMoves.filter((move) => move.createsLife);
  const oneEyeMoves = opponentEyeMoves.filter((move) => !move.createsLife);

  if (twoEyeMoves.length === 1) {
    return twoEyeMoves[0];
  }
  if (!twoEyeMoves.length && oneEyeMoves.length === 1) {
    return oneEyeMoves[0];
  }
  return null;
}

/**
 * Gets a group of reasonable moves based on the current board state, to be passed to the factions' AI to decide on
 */
function getMoveOptions(boardState: BoardState, player: GoColor, rng: number, smart = true) {
  const board = boardState.board;
  const availableSpaces = findDisputedTerritory(boardState, player, smart);
  const contestedPoints = getDisputedTerritoryMoves(board, availableSpaces);
  const expansionMoves = getExpansionMoveArray(board, availableSpaces);

  // If the player is passing, and all territory is surrounded by a single color: do not suggest moves that
  // needlessly extend the game, unless they actually can change the score
  const endGameAvailable = !contestedPoints.length && boardState.passCount;

  const moveOptions: { [s in MoveType]: Move | null | undefined } = {
    capture: undefined,
    defendCapture: undefined,
    eyeMove: undefined,
    eyeBlock: undefined,
    pattern: undefined,
    growth: undefined,
    expansion: undefined,
    jump: undefined,
    defend: undefined,
    surround: undefined,
    corner: undefined,
    random: undefined,
  };

  const moveOptionGetters: MoveOptions = {
    capture: async () => {
      const surroundMove = await retrieveMoveOption("surround");
      return surroundMove && surroundMove?.newLibertyCount === 0 ? surroundMove : null;
    },
    defendCapture: async () => {
      const defendMove = await retrieveMoveOption("defend");
      return defendMove &&
        defendMove.oldLibertyCount == 1 &&
        defendMove?.newLibertyCount &&
        defendMove?.newLibertyCount > 1
        ? defendMove
        : null;
    },
    eyeMove: () => (endGameAvailable ? null : getEyeCreationMove(board, player, availableSpaces) ?? null),
    eyeBlock: () => (endGameAvailable ? null : getEyeBlockingMove(board, player, availableSpaces) ?? null),
    pattern: async () => {
      const point = endGameAvailable ? null : await findAnyMatchedPatterns(board, player, availableSpaces, smart, rng);
      return point ? { point } : null;
    },
    growth: () => (endGameAvailable ? null : getGrowthMove(board, player, availableSpaces, rng) ?? null),
    expansion: () => getExpansionMove(board, availableSpaces, rng, expansionMoves) ?? null,
    jump: () => getJumpMove(board, player, availableSpaces, rng, expansionMoves) ?? null,
    defend: () => getDefendMove(board, player, availableSpaces) ?? null,
    surround: () => getSurroundMove(board, player, availableSpaces, smart) ?? null,
    corner: () => {
      const point = getCornerMove(board);
      return point ? { point } : null;
    },
    random: () => {
      // Only offer a random move if there are some contested spaces on the board.
      // (Random move should not be picked if the AI would otherwise pass turn.)
      const point = contestedPoints.length ? availableSpaces[Math.floor(rng * availableSpaces.length)] : null;
      return point ? { point } : null;
    },
  } as const;

  async function retrieveMoveOption(id: MoveType): Promise<Move | null> {
    await waitCycle();
    if (moveOptions[id] !== undefined) {
      return moveOptions[id] ?? null;
    }

    const move = (await moveOptionGetters[id]()) ?? null;
    moveOptions[id] = move;
    return move;
  }

  return moveOptionGetters;
}

/**
 * Gets the starting score for white.
 */
export function getKomi(state: BoardState): number {
  if (state.komiOverride !== null) {
    return state.komiOverride;
  }
  return opponentDetails[state.ai].komi;
}

/**
 * Allows time to pass
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spend some time waiting to allow the UI & CSS to render smoothly
 * If bonus time is available, significantly decrease the length of the wait
 */
function waitCycle(useOfflineCycles = true): Promise<void> {
  if (useOfflineCycles && Go.storedCycles > 0) {
    Go.storedCycles -= 2;
    return sleep(40);
  }
  return sleep(200);
}

export function showWorldDemon() {
  return Player.hasAugmentation(AugmentationName.TheRedPill, true) && Player.activeSourceFileLvl(1);
}
