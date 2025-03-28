import { Paper, Typography } from "@mui/material";
import React, { useState } from "react";
import { AugmentationName } from "@enums";
import { Player } from "@player";
import { Arrow, downArrowSymbol, getArrow, leftArrowSymbol, rightArrowSymbol, upArrowSymbol } from "../utils";
import { interpolate } from "./Difficulty";
import { GameTimer } from "./GameTimer";
import { IMinigameProps } from "./IMinigameProps";
import { KeyHandler } from "./KeyHandler";
import { randomInRange } from "../../utils/helpers/randomInRange";

interface Difficulty {
  [key: string]: number;
  timer: number;
  min: number;
  max: number;
}

const difficulties: {
  Trivial: Difficulty;
  Normal: Difficulty;
  Hard: Difficulty;
  Impossible: Difficulty;
} = {
  Trivial: { timer: 13000, min: 6, max: 8 },
  Normal: { timer: 7000, min: 7, max: 8 },
  Hard: { timer: 5000, min: 8, max: 9 },
  Impossible: { timer: 3000, min: 9, max: 10 },
};

export function CheatCodeGame(props: IMinigameProps): React.ReactElement {
  const difficulty: Difficulty = { timer: 0, min: 0, max: 0 };
  interpolate(difficulties, props.difficulty, difficulty);
  const timer = difficulty.timer;
  const [code] = useState(generateCode(difficulty));
  const [index, setIndex] = useState(0);
  const hasAugment = Player.hasAugmentation(AugmentationName.TrickeryOfHermes, true);

  function press(this: Document, event: KeyboardEvent): void {
    event.preventDefault();
    if (code[index] !== getArrow(event)) {
      props.onFailure();
      return;
    }
    setIndex(index + 1);
    if (index + 1 >= code.length) props.onSuccess();
  }

  return (
    <>
      <GameTimer millis={timer} onExpire={props.onFailure} />
      <Paper sx={{ display: "grid", justifyItems: "center" }}>
        <Typography variant="h4">Enter the Code!</Typography>
        <Typography variant="h4">
          <div
            style={{
              display: "grid",
              gap: "2rem",
              gridTemplateColumns: `repeat(${code.length}, 1fr)`,
              textAlign: "center",
            }}
          >
            {code.map((arrow, i) => {
              return (
                <span key={i} style={i !== index ? { opacity: 0.4 } : {}}>
                  {i > index && !hasAugment ? "?" : arrow}
                </span>
              );
            })}
          </div>
        </Typography>
        <KeyHandler onKeyDown={press} onFailure={props.onFailure} />
      </Paper>
    </>
  );
}

function generateCode(difficulty: Difficulty): Arrow[] {
  const arrows: Arrow[] = [leftArrowSymbol, rightArrowSymbol, upArrowSymbol, downArrowSymbol];
  const code: Arrow[] = [];
  for (let i = 0; i < randomInRange(difficulty.min, difficulty.max); i++) {
    let arrow = arrows[Math.floor(4 * Math.random())];
    while (arrow === code[code.length - 1]) arrow = arrows[Math.floor(4 * Math.random())];
    code.push(arrow);
  }
  return code;
}
