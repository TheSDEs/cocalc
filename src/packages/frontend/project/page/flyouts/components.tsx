/*
 *  This file is part of CoCalc: Copyright © 2023 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import {
  green as ANTD_GREEN,
  orange as ANTD_ORANGE,
  yellow as ANTD_YELLOW,
} from "@ant-design/colors";

import { CSS } from "@cocalc/frontend/app-framework";
import { Icon } from "@cocalc/frontend/components";
import { COLORS } from "@cocalc/util/theme";
import { hexColorToRGBA } from "@cocalc/util/misc";
import { server_time } from "@cocalc/util/relative-time";
import { Tooltip } from "antd";

export const FILE_ITEM_OPENED_STYLE: CSS = {
  fontWeight: "bold",
  color: COLORS.PROJECT.FIXED_LEFT_ACTIVE,
  backgroundColor: COLORS.GRAY_LL,
} as const;

const FILE_ITEM_STYLE: CSS = {
  flex: "1 1 auto",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;

const FILE_ITEM_LINE_STYLE: CSS = {
  display: "flex",
  flexDirection: "row",
  width: "100%",
  cursor: "pointer",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  paddingBottom: "5px",
  paddingTop: "5px",
  paddingLeft: "5px",
  paddingRight: "5px",
  color: COLORS.GRAY_D,
} as const;

const ICON_STYLE: CSS = { fontSize: "120%", marginRight: "5px" } as const;

interface Item {
  isopen?: boolean;
  name: string;
}

interface FileListItemProps {
  onClick: (e: React.MouseEvent) => void;
  onClose: (e: React.MouseEvent | undefined, name: string) => void;
  itemStyle?: CSS;
  item: Item;
  renderIcon: (item: Item, style: CSS) => JSX.Element;
  tooltip?: JSX.Element | string;
}

export function FileListItem({
  onClick,
  onClose,
  item,
  renderIcon,
  itemStyle,
  tooltip,
}: FileListItemProps): JSX.Element {
  function renderCloseItem(item: Item): JSX.Element {
    const { name } = item;
    return (
      <Icon
        name="times-circle"
        style={{ flex: "0", fontSize: "120%" }}
        onClick={(e) => onClose(e, name)}
      />
    );
  }

  function renderItem(): JSX.Element {
    const el = (
      <div style={FILE_ITEM_STYLE} onClick={onClick}>
        {item.name}
      </div>
    );

    if (!tooltip) return el;

    return (
      <Tooltip title={tooltip} placement="rightTop">
        {el}
      </Tooltip>
    );
  }

  return (
    <div
      className="cc-project-flyout-file-item"
      style={{
        ...FILE_ITEM_LINE_STYLE,
        ...(item.isopen ? FILE_ITEM_OPENED_STYLE : {}),
        ...itemStyle,
      }}
    >
      {renderIcon(item, ICON_STYLE)} {renderItem()}
      {item.isopen ? renderCloseItem(item) : null}
    </div>
  );
}

// Depending on age, highlight  entries from the past past 24 hours and week
export function itemAgeStyle(time: number = 0): CSS {
  const diff = server_time().getTime() - time;
  const days = Math.max(0, diff / 1000 / 60 / 60 / 24);
  let col = "rgba(1, 1, 1, 0)";
  if (days < 1 / 24) {
    col = hexColorToRGBA(ANTD_GREEN[3], 1);
  } else if (days < 1) {
    const opacity = 1 - days / 2;
    col = hexColorToRGBA(ANTD_ORANGE[3], opacity);
  } else if (days < 7) {
    const opacity = 1 - (days - 1) / 7;
    col = hexColorToRGBA(ANTD_YELLOW[5], opacity);
  }
  return {
    borderLeft: `4px solid ${col}`,
  };
}