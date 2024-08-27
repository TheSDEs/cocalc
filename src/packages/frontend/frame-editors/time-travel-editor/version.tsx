/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { TimeAgo } from "@cocalc/frontend/components";

interface Props {
  date: Date;
  number: number;
  max: number;
}

export function Version({ date, number, max }: Props) {
  if (max == 0) return <span />;
  return (
    <span>
      <span
        style={{
          fontWeight: "bold",
          fontSize: "12pt",
          color: "#666",
          whiteSpace: "nowrap",
        }}
      >
        <TimeAgo date={date} />
      </span>
      ,{" "}
      <span style={{ whiteSpace: "nowrap" }}>
        revision {number} (of {max})
      </span>
    </span>
  );
}

interface RangeProps {
  version0: number;
  version1: number;
  max: number;
}

export function VersionRange({ version0, version1, max }: RangeProps) {
  if (max == 0) {
    return <span />;
  }
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      Versions {version0 + 1} to {version1 + 1} (of {max})
    </span>
  );
}
