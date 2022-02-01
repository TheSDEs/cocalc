/*
Editing bar for editing one (or more) selected elements.
*/

import { useState } from "react";
import { Tooltip, Button } from "antd";
import { Element } from "../types";
import { PANEL_STYLE } from "./panel";
import { Icon } from "@cocalc/frontend/components/icon";
import { useFrameContext } from "@cocalc/frontend/frame-editors/frame-tree/frame-context";
import { Actions } from "../actions";
import { BrushPreview, maxRadius } from "./pen";
import ColorPicker from "@cocalc/frontend/components/color-picker";

interface Props {
  elements: Element[];
}

export default function EditBar({ elements }: Props) {
  const frame = useFrameContext();
  const actions = frame.actions as Actions;
  if (elements.length == 0) return null;
  return (
    <div
      style={{
        ...PANEL_STYLE,
        margin: 0,
        display: "flex",
        flexDirection: "column",
        height: "42px",
      }}
    >
      <div style={{ display: "flex" }}>
        <ColorButton actions={actions} elements={elements} />
        <DeleteButton actions={actions} elements={elements} />
      </div>
    </div>
  );
}

const BUTTON_STYLE = {
  fontSize: "22px",
  color: "#666",
  height: "42px",
  padding: "4px 5px",
};

interface ButtonProps {
  actions: Actions;
  elements: Element[];
}

function DeleteButton({ actions, elements }: ButtonProps) {
  return (
    <Tooltip title="Delete">
      <Button
        style={BUTTON_STYLE}
        type="text"
        onClick={() => {
          for (const { id } of elements) {
            actions.delete(id);
          }
          actions.syncstring_commit();
        }}
      >
        <Icon name="trash" />
      </Button>
    </Tooltip>
  );
}

function ColorButton({ actions, elements }: ButtonProps) {
  const [showPicker, setShowPicker] = useState<boolean>(false);
  const [color, setColor0] = useState<string | undefined>(getColor(elements));

  function setColor(color: string) {
    setColor0(color);
    for (const element of elements) {
      const data = { ...element.data, color };
      actions.setElement({ ...element, data }, false);
    }
    actions.syncstring_commit();
  }

  return (
    <>
      <Tooltip title="Color">
        <Button
          style={BUTTON_STYLE}
          type="text"
          onClick={() => setShowPicker(!showPicker)}
        >
          <BrushPreview radius={maxRadius} color={color ?? "black"} />
        </Button>
      </Tooltip>
      {showPicker && (
        <ColorPicker
          color={color}
          onChange={setColor}
          style={{
            background: "white",
            padding: "10px",
            border: "1px solid grey",
            boxShadow: "0 0 5px grey",
            borderRadius: "3px",
            position: "absolute",
            top: "50px" /* TODO: may want more intelligent positioning */,
          }}
        />
      )}
    </>
  );
}

function getColor(elements: Element[]): string | undefined {
  for (const element of elements) {
    if (element.data?.color) {
      return element.data?.color;
    }
  }
}
