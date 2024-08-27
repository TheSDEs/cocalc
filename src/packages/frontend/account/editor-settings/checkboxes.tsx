/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Map } from "immutable";
import { Checkbox } from "@cocalc/frontend/antd-bootstrap";
import { Component, Rendered } from "@cocalc/frontend/app-framework";
import { capitalize, is_different, keys } from "@cocalc/util/misc";
import { JUPYTER_CLASSIC_MODERN } from "@cocalc/util/theme";
import { A } from "@cocalc/frontend/components";

const EDITOR_SETTINGS_CHECKBOXES: { [setting: string]: string | Rendered } = {
  extra_button_bar:
    "customizable button bar below menu bar with shortcuts to menu items",
  line_wrapping: "wrap long lines",
  line_numbers: "show line numbers",
  jupyter_line_numbers: "show line numbers in Jupyter notebooks",
  code_folding: "fold code using control+Q",
  smart_indent: "context sensitive indentation",
  electric_chars: "sometimes reindent current line",
  match_brackets: "highlight matching brackets near cursor",
  auto_close_brackets: "automatically close brackets",
  match_xml_tags: "automatically match XML tags",
  auto_close_xml_tags: "automatically close XML tags",
  auto_close_latex: "automatically close LaTeX environments",
  strip_trailing_whitespace: "remove whenever file is saved",
  show_trailing_whitespace: "show spaces at ends of lines",
  spaces_instead_of_tabs: "send spaces when the tab key is pressed",
  build_on_save: "build LaTex/Rmd files whenever it is saved to disk",
  show_exec_warning: "warn that certain files are not directly executable",
  ask_jupyter_kernel: "ask which kernel to use for a new Jupyter Notebook",
  disable_jupyter_virtualization:
    "render entire notebook instead of just visible part (slower and not recommended)",
  jupyter_classic: (
    <span>
      <A href="https://github.com/sagemathinc/cocalc/issues/7706">
        <b>DEPRECATED -- will to be removed after Aug 2024</b>
      </A>{" "}
      (see <A href={JUPYTER_CLASSIC_MODERN}>the docs</A>).
    </span>
  ),
  /* commented out since we are never using this.
  disable_jupyter_windowing:
    "never use windowing with Jupyter notebooks (windowing is sometimes used on the Chrome browser to make very large notebooks render quickly, but can lead to trouble)",*/
} as const;

interface Props {
  editor_settings: Map<string, any>;
  email_address?: string;
  on_change: Function;
}

export class EditorSettingsCheckboxes extends Component<Props> {
  public shouldComponentUpdate(props): boolean {
    return is_different(this.props, props, [
      "editor_settings",
      "email_address",
    ]);
  }

  private label_checkbox(name: string, desc: string | Rendered): Rendered {
    return (
      <span>
        {capitalize(
          name
            .replace(/_/g, " ")
            .replace(/-/g, " ")
            .replace("xml", "XML")
            .replace("latex", "LaTeX"),
        ) + ": "}
        {desc}
      </span>
    );
  }

  private render_checkbox(name: string, desc: string | Rendered): Rendered {
    if (
      this.props.email_address?.indexOf("minervaproject.com") != -1 &&
      name === "jupyter_classic"
    ) {
      // Special case -- minerva doesn't get the jupyter classic option, to avoid student confusion.
      return;
    }
    return (
      <Checkbox
        checked={!!this.props.editor_settings.get(name)}
        key={name}
        onChange={(e) => this.props.on_change(name, e.target.checked)}
      >
        {this.label_checkbox(name, desc)}
      </Checkbox>
    );
  }

  public render(): JSX.Element {
    return (
      <span>
        {keys(EDITOR_SETTINGS_CHECKBOXES).map((name) =>
          this.render_checkbox(name, EDITOR_SETTINGS_CHECKBOXES[name]),
        )}
      </span>
    );
  }
}
