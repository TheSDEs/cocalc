/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
History viewer for Jupyter notebooks
*/

import { fromJS, List, Map } from "immutable";

import { Redux, useTypedRedux } from "@cocalc/frontend/app-framework";
import { ErrorDisplay } from "@cocalc/frontend/components";
import * as cell_utils from "@cocalc/jupyter/util/cell-utils";
import { SyncDB } from "@cocalc/sync/editor/db/sync";
import { path_split } from "@cocalc/util/misc";
import { createRoot } from "react-dom/client";
import { CellList } from "./cell-list";
import { cm_options } from "./cm_options";
import { ERROR_STYLE } from "./main";

function get_cells(doc): { cells: Map<string, any>; cell_list: List<string> } {
  let cells = Map<string, any>();
  const othercells = doc.get({ type: "cell" });
  if (othercells != null) {
    othercells.forEach(
      (cell: any) => (cells = cells.set(cell.get("id"), cell)),
    );
  }
  const cell_list = cell_utils.sorted_cell_list(cells);
  return { cells, cell_list };
}

export function HistoryViewer({ project_id, path, doc, font_size }) {
  const default_font_size =
    font_size ?? useTypedRedux("account", "font_size") ?? 14;
  const { head: directory } = path_split(path);
  const { cells, cell_list } = get_cells(doc);

  const options = fromJS({
    markdown: undefined,
    options: cm_options(),
  });

  const kernel_error = doc.get_one({ type: "settings" })?.get("kernel_error");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowY: "hidden",
      }}
    >
      {kernel_error && (
        <ErrorDisplay
          bsStyle="warning"
          error={kernel_error}
          style={ERROR_STYLE}
        />
      )}
      <CellList
        cell_list={cell_list}
        cells={cells}
        font_size={font_size ?? default_font_size}
        mode="escape"
        cm_options={options}
        project_id={project_id}
        directory={directory}
        trust={false}
      />
    </div>
  );
}

// The following is just for integrating the history viewer.
import { export_to_ipynb } from "@cocalc/jupyter/ipynb/export-to-ipynb";
import json_stable from "json-stable-stringify";

export function to_ipynb(doc): object {
  return export_to_ipynb(get_cells(doc));
}

export function jupyter_history_viewer_jquery_shim(syncdb: SyncDB) {
  const elt = $("<div class='smc-vfill'></div>");
  const root = createRoot(elt[0]);
  return {
    element: elt,
    show() {
      elt.show();
    },
    hide() {
      elt.hide();
    },
    remove() {
      root.unmount();
    },
    set_version(_version) {
      root.render(
        <Redux>
          <div>Jupyter Classic is Deprecated</div>
        </Redux>,
      );
    },
    to_str(version) {
      const ipynb = to_ipynb(syncdb.version(version));
      return json_stable(ipynb, { space: 1 });
    },
  };
}
