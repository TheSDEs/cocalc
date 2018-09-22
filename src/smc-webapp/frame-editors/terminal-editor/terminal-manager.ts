/*
Manage a collection of terminals in the frame tree.
*/

import { Actions } from "../code-editor/actions";
import { AppRedux } from "../../app-framework";
import { connect_to_server } from "./connect-to-server";
import * as tree_ops from "../frame-tree/tree-ops";
import { len } from "../generic/misc";

export class TerminalManager {
  protected terminals: { [key: string]: any } = {};
  private actions: Actions;
  private redux: AppRedux;

  constructor(actions: Actions, redux: AppRedux) {
    this.actions = actions;
    this.redux = redux;
  }

  close(): void {
    for (let id in this.terminals) {
      this.close_terminal(id);
    }
  }

  set_terminal(id: string, terminal: any): void {
    this.terminals[id] = terminal;

    /* All this complicated code starting here is just to get
       a stable number for this frame. Sorry it is so complicated! */
    let node = this.actions._get_frame_node(id);
    if (node === undefined) {
      // to satisfy typescript
      return;
    }
    let number = node.get("number");

    const numbers = {};
    for (let id0 in this.actions._get_leaf_ids()) {
      const node0 = tree_ops.get_node(this.actions._get_tree(), id0);
      if (node0 == null || node0.get("type") != "terminal") {
        continue;
      }
      let n = node0.get("number");
      if (n !== undefined) {
        if (numbers[n] && n === number) {
          number = undefined;
        }
        numbers[n] = true;
      }
    }
    for (let i = 0; i < len(numbers); i++) {
      if (!numbers[i]) {
        number = i;
        break;
      }
    }
    if (number === undefined) {
      number = len(numbers);
    }
    // Set number entry of this node.
    this.actions.set_frame_tree({ id, number });

    // OK, above got the stable number.  Now connect:
    try {
      connect_to_server(
        this.actions.project_id,
        this.actions.path,
        terminal,
        number
      );
    } catch (err) {
      this.actions.set_error(
        `Error connecting to server -- ${err} -- try closing and reopening or restarting project.`
      );
    }
    terminal.on("mesg", mesg => this.handle_mesg(id, mesg));
    terminal.on("title", title => this.actions.set_title(id, title));
    this.init_settings(terminal);
  }

  close_terminal(id: string): void {
    if (!this.terminals[id]) {
      // graceful no-op if no such terminal.
      return;
    }
    this.terminals[id].destroy();
    delete this.terminals[id];
  }

  get_terminal(id: string): any {
    return this.terminals[id];
  }

  handle_mesg(
    id: string,
    mesg: { cmd: string; rows?: number; cols?: number }
  ): void {
    console.log("handle_mesg", id, mesg);
    switch (mesg.cmd) {
      case "size":
        //this.handle_resize(mesg.rows, mesg.cols);
        break;
      case "burst":
        break;
      case "no-burst":
        break;
      case "no-ignore":
        break;
      case "close":
        break;
    }
  }

  init_settings(terminal: any): void {
    const account = this.redux.getStore("account");
    if (account == null) {
      return;
    }
    const settings = account.get_terminal_settings();
    if (settings == null) {
      return;
    }
    console.log("init_settings", terminal);

    // TODO:
    terminal.setOption("theme", {
      background: "#ffffff",
      foreground: "#000000",
      cursor: "#000000"
    });
    /* terminal.set_font_size(settings.font_size ? settings.font_size : 14);
    terminal.set_color_scheme(
      settings.color_scheme ? settings.color_scheme : "default"
    );
    terminal.set_font_family(settings.font ? settings.font : "monospace");
    */
  }
}
