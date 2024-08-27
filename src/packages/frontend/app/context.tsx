/*
 *  This file is part of CoCalc: Copyright © 2023 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { theme, ThemeConfig } from "antd";
import type { SizeType } from "antd/es/config-provider/SizeContext";
import { debounce } from "lodash";
import { createContext, ReactNode, useContext } from "react";
import { useIntl } from "react-intl";

import {
  CSS,
  useEffect,
  useMemo,
  useState,
  useTypedRedux,
} from "@cocalc/frontend/app-framework";
import { COLORS } from "@cocalc/util/theme";
import { IntlMessage, isIntlMessage } from "@cocalc/frontend/i18n";
import {
  FONT_SIZE_ICONS_NARROW,
  FONT_SIZE_ICONS_NORMAL,
  NARROW_THRESHOLD_PX,
  NAV_HEIGHT_NARROW_PX,
  NAV_HEIGHT_PX,
  PageStyle,
} from "./top-nav-consts";

export interface AppState {
  pageWidthPx: number;
  pageStyle: PageStyle;
  antdComponentSize?: SizeType;
  antdTheme?: ThemeConfig;
  formatIntl: (msg: IntlMessage | ReactNode | string) => ReactNode | string;
}

export const AppContext = createContext<AppState>({
  pageWidthPx: window.innerWidth,
  pageStyle: calcStyle(isNarrow()),
  formatIntl: () => "Loading…",
});

export function useAppContext() {
  return useContext(AppContext);
}

export function useAppContextProvider() {
  const intl = useIntl();

  const [pageWidthPx, setPageWidthPx] = useState<number>(window.innerWidth);

  const [narrow, setNarrow] = useState<boolean>(isNarrow());

  function update() {
    setNarrow(isNarrow());
    if (window.innerWidth != pageWidthPx) {
      setPageWidthPx(window.innerWidth);
    }
  }

  useEffect(() => {
    const handleResize = debounce(update, 50, {
      leading: false,
      trailing: true,
    });

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // avoid updating the style on every resize event
  const pageStyle: PageStyle = useMemo(() => {
    return calcStyle(narrow);
  }, [narrow]);

  function formatIntl(
    msg: IntlMessage | ReactNode | string,
  ): ReactNode | string {
    if (isIntlMessage(msg)) {
      return intl.formatMessage(msg);
    } else {
      return msg;
    }
  }

  return {
    formatIntl,
    pageWidthPx,
    pageStyle,
  };
}

export function useAntdStyleProvider() {
  const other_settings = useTypedRedux("account", "other_settings");
  const rounded = other_settings?.get("antd_rounded", true);
  const animate = other_settings?.get("antd_animate", true);
  const branded = other_settings?.get("antd_brandcolors", false);
  const compact = other_settings?.get("antd_compact", false);

  const borderStyle = rounded
    ? undefined
    : { borderRadius: 0, borderRadiusLG: 0, borderRadiusSM: 0 };

  const animationStyle = animate ? undefined : { motion: false };

  const brandedColors = branded
    ? { colorPrimary: COLORS.COCALC_BLUE }
    : undefined;

  const algorithm = compact ? { algorithm: theme.compactAlgorithm } : undefined;

  const antdTheme: ThemeConfig = {
    ...algorithm,
    token: {
      ...brandedColors,
      ...borderStyle,
      ...animationStyle,
    },
    components: {
      Button: {
        ...brandedColors,
      },
    },
  };

  return {
    antdTheme,
  };
}

function isNarrow(): boolean {
  return window.innerWidth != null && window.innerWidth <= NARROW_THRESHOLD_PX;
}

function calcStyle(isNarrow: boolean): PageStyle {
  const fontSizeIcons: string = isNarrow
    ? FONT_SIZE_ICONS_NARROW
    : FONT_SIZE_ICONS_NORMAL;
  const topPaddingIcons: string = isNarrow ? "2px" : "5px";
  const sidePaddingIcons: string = isNarrow ? "7px" : "14px";

  const height = isNarrow ? NAV_HEIGHT_NARROW_PX : NAV_HEIGHT_PX;

  const topBarStyle: CSS = {
    height: `${height}px`,
  } as const;

  const fileUseStyle: CSS = {
    background: "white",
    border: `2px solid ${COLORS.GRAY_DDD}`,
    borderRadius: "5px",
    boxShadow: "0 0 15px #aaa",
    fontSize: "10pt",
    height: "90%",
    margin: 0,
    overflowX: "hidden",
    overflowY: "auto",
    padding: "4px",
    position: "fixed",
    right: "5vw",
    top: `${height}px`,
    width: isNarrow ? "90vw" : "50vw",
    zIndex: 110,
  } as const;

  const projectsNavStyle: CSS | undefined = isNarrow
    ? {
        /* this makes it so the projects tabs are on a separate row; otherwise, there is literally no room for them at all... */
        width: "100vw",
        marginTop: "4px",
        height: `${height}px`,
        // no flex!
      }
    : {
        flex: "1 1 auto", // necessary to stretch out to the full width
      };

  return {
    topBarStyle,
    fileUseStyle,
    projectsNavStyle,
    isNarrow,
    sidePaddingIcons,
    topPaddingIcons,
    fontSizeIcons,
    height,
  };
}
