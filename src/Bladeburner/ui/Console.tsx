import type { Bladeburner } from "../Bladeburner";

import React, { useState, useRef, useEffect } from "react";
import { KEY } from "../../utils/KeyboardEventKey";

import { Box, List, ListItem, Paper, TextField, Typography } from "@mui/material";
import { Theme } from "@mui/material/styles";
import { makeStyles } from "tss-react/mui";
import { useRerender } from "../../ui/React/hooks";

interface ILineProps {
  content: React.ReactNode;
}

const useStyles = makeStyles()((theme: Theme) => ({
  textfield: {
    margin: theme.spacing(0),
    width: "100%",
  },
  input: {
    backgroundColor: theme.colors.backgroundsecondary,
  },
  nopadding: {
    padding: theme.spacing(0),
  },
  preformatted: {
    whiteSpace: "pre-wrap",
    margin: theme.spacing(0),
  },
  list: {
    padding: theme.spacing(0),
    height: "100%",
  },
}));

function Line(props: ILineProps): React.ReactElement {
  return (
    <ListItem sx={{ p: 0 }}>
      <Typography>{props.content}</Typography>
    </ListItem>
  );
}

interface IProps {
  bladeburner: Bladeburner;
}

export function Console(props: IProps): React.ReactElement {
  const { classes } = useStyles();
  const [command, setCommand] = useState("");
  const consoleInput = useRef<HTMLInputElement>(null);
  useRerender(1000);

  function handleCommandChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setCommand(event.target.value);
  }

  const [consoleHistoryIndex, setConsoleHistoryIndex] = useState(props.bladeburner.consoleHistory.length);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === KEY.ENTER) {
      event.preventDefault();
      if (command.length > 0) {
        props.bladeburner.postToConsole("> " + command);
        props.bladeburner.executeConsoleCommands(command);
        setConsoleHistoryIndex(props.bladeburner.consoleHistory.length);
        setCommand("");
      }
    }

    const consoleHistory = props.bladeburner.consoleHistory;

    if (event.key === KEY.UP_ARROW) {
      // up
      let i = consoleHistoryIndex;
      const len = consoleHistory.length;
      if (len === 0) {
        return;
      }
      if (i < 0 || i > len) {
        setConsoleHistoryIndex(len);
      }

      if (i !== 0) {
        i = i - 1;
      }
      setConsoleHistoryIndex(i);
      const prevCommand = consoleHistory[i];
      event.currentTarget.value = prevCommand;
      setCommand(prevCommand);
    }

    if (event.key === KEY.DOWN_ARROW) {
      const i = consoleHistoryIndex;
      const len = consoleHistory.length;

      if (len == 0) {
        return;
      }
      if (i < 0 || i > len) {
        setConsoleHistoryIndex(len);
      }

      // Latest command, put nothing
      if (i == len || i == len - 1) {
        setConsoleHistoryIndex(len);
        event.currentTarget.value = "";
      } else {
        setConsoleHistoryIndex(consoleHistoryIndex + 1);
        const prevCommand = consoleHistory[consoleHistoryIndex + 1];
        event.currentTarget.value = prevCommand;
        setCommand(prevCommand);
      }
    }
  }

  function handleClick(): void {
    if (!consoleInput.current) return;
    consoleInput.current.focus();
  }

  return (
    <Paper sx={{ p: 1 }}>
      <Box
        sx={{
          height: "60vh",
          paddingBottom: "8px",
          display: "flex",
          alignItems: "stretch",
          whiteSpace: "pre-wrap",
        }}
        onClick={handleClick}
      >
        <Box>
          <Logs entries={[...props.bladeburner.consoleLogs]} />
        </Box>
      </Box>
      <TextField
        classes={{ root: classes.textfield }}
        autoFocus
        tabIndex={1}
        type="text"
        inputRef={consoleInput}
        value={command}
        onChange={handleCommandChange}
        onKeyDown={handleKeyDown}
        InputProps={{
          // for players to hook in
          className: classes.input,
          startAdornment: (
            <>
              <Typography>&gt;&nbsp;</Typography>
            </>
          ),
          spellCheck: false,
        }}
      />
    </Paper>
  );
}

interface ILogProps {
  entries: string[];
}

function Logs({ entries }: ILogProps): React.ReactElement {
  const scrollHook = useRef<HTMLUListElement>(null);

  // TODO unplanned: Text gets shifted up as new entries appear, if the user scrolled up it should attempt to keep the text focused
  function scrollToBottom(): void {
    if (!scrollHook.current) return;
    scrollHook.current.scrollTop = scrollHook.current.scrollHeight;
  }

  useEffect(() => {
    scrollToBottom();
  }, [entries.length]);

  return (
    <List sx={{ height: "100%", overflow: "auto", p: 1 }} ref={scrollHook}>
      {entries && entries.map((log: string, i: number) => <Line key={i} content={log} />)}
    </List>
  );
}
