/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import * as base from "@jupyter-widgets/base";
import { createWidgetManager, is_unpack_models } from "@cocalc/widgets";
import type { WidgetEnvironment, Comm } from "@cocalc/widgets";
import {
  IpywidgetsState,
  ModelState,
} from "@cocalc/sync/editor/generic/ipywidgets-state";
import { once } from "@cocalc/util/async-utils";
import { copy, is_array, is_object, len } from "@cocalc/util/misc";
import { fromJS } from "immutable";
import { CellOutputMessage } from "@cocalc/frontend/jupyter/output-messages/message";
import React from "react";
import ReactDOM from "react-dom/client";
import { size } from "lodash";
import type { JupyterActions } from "@cocalc/frontend/jupyter/browser-actions";
import { FileContext } from "@cocalc/frontend/lib/file-context";

export type SendCommFunction = (string, data) => string;

const log = console.log;

export class WidgetManager {
  public ipywidgets_state: IpywidgetsState;
  public actions: JupyterActions;
  public manager;
  private last_changed: { [model_id: string]: { [key: string]: any } } = {};
  private state_lock: Set<string> = new Set();
  private watching: Set<string> = new Set();

  constructor({
    ipywidgets_state,
    actions,
  }: {
    ipywidgets_state: IpywidgetsState;
    actions: JupyterActions;
  }) {
    this.ipywidgets_state = ipywidgets_state;
    this.actions = actions;
    if (this.ipywidgets_state.get_state() == "closed") {
      throw Error("ipywidgets_state must not be closed");
    }
    const provider = new Environment(this);
    this.manager = createWidgetManager(provider);

    this.initAllModels();
    this.ipywidgets_state.on("change", async (keys) => {
      for (const key of keys) {
        const [, model_id, type] = JSON.parse(key);
        this.handleIpWidgetsChange({ model_id, type });
      }
    });
  }

  private initAllModels = async () => {
    if (this.ipywidgets_state.get_state() == "init") {
      await once(this.ipywidgets_state, "ready");
    }
    if (this.ipywidgets_state.get_state() != "ready") {
      return;
    }
    log("initAllModels");
    for (const { model_id, type } of this.ipywidgets_state.keys()) {
      if (type == "state") {
        log("initAllModels", model_id);
        (async () => {
          try {
            await this.manager.get_model(model_id);
            // also ensure any buffers are set, e.g., this is needed when loading
            // https://ipywidgets.readthedocs.io/en/latest/examples/Widget%20List.html#image
            // so don't have to evaluate the cell on first load.
            await this.ipywidgets_state_BuffersChange(model_id);
          } catch (err) {
            log("initAllModels", err);
          }
        })();
      }
    }
  };

  private handleIpWidgetsChange = async ({ model_id, type }) => {
    log("handleIpWidgetsChange", { model_id, type });
    switch (type) {
      case "state":
        await this.ipywidgets_state_StateChange(model_id);
        break;
      case "value":
        await this.ipywidgets_state_ValueChange(model_id);
        break;
      case "buffers":
        await this.ipywidgets_state_BuffersChange(model_id);
        break;
      case "message":
        // This is how custom comm messages would get delivered
        await this.ipywidgets_state_MessageChange(model_id);
        break;
      default:
        throw Error(`unknown state type '${type}'`);
    }
  };

  private ipywidgets_state_StateChange = async (model_id: string) => {
    log("handleStateChange: ", model_id);
    const state = this.ipywidgets_state.get_model_state(model_id);
    log("handleStateChange: state=", state);
    if (state == null) {
      return;
    }
    await this.updateModel(model_id, state!);
  };

  private updateModel = async (
    model_id: string,
    changed: ModelState,
  ): Promise<void> => {
    const model: base.DOMWidgetModel | undefined =
      await this.manager.get_model(model_id);
    log("updateModel", { model, changed });
    if (model == null) {
      return;
    }
    //log(`setting state of model "${model_id}" to `, change);
    if (changed.last_changed != null) {
      this.last_changed[model_id] = changed;
    }
    const success = await this.dereferenceModelLinks(changed);
    if (!success) {
      console.warn(
        "update model suddenly references not known models -- can't handle this yet (TODO!); ignoring update.",
      );
      return;
    }
    const state = await this.deserializeState(model, changed);
    if (state.hasOwnProperty("outputs") && state["outputs"] == null) {
      // It can definitely be 'undefined' but set, e.g., the 'out.clear_output()' example at
      // https://ipywidgets.readthedocs.io/en/latest/examples/Output%20Widget.html
      // causes this, which then totally breaks rendering (due to how the
      // upstream widget manager works).  This works around that.
      state["outputs"] = [];
    }

    log("set_state", state);
    model.set_state(state);
  };

  // ipywidgets_state_ValueChange is called when a value entry of the ipywidgets_state
  // table is changed, e.g., when the backend decides a model should change or another client
  // changes something, or even this client changes something.  When another client is
  // responsible for the change, we make the change to the ipywidgets model here.
  private ipywidgets_state_ValueChange = async (model_id: string) => {
    // log("handleValueChange: ", model_id);
    const changed = this.ipywidgets_state.get_model_value(model_id);
    log("handleValueChange: changed=", model_id, changed);
    if (
      this.last_changed[model_id] != null &&
      changed.last_changed != null &&
      changed.last_changed <= this.last_changed[model_id].last_changed
    ) {
      log(
        "handleValueChange: skipping due to last_changed sequence number -- i.e., change caused by this client",
        this.last_changed[model_id],
        changed.last_changed,
      );
      if (changed.last_changed < this.last_changed[model_id].last_changed) {
        log("handleValueChange: strict inequality, so saving again");
        // This is necessary since SyncTable has fairly week guarantees
        // when you try to write tons of changing rapidly to the *same*
        // key (in this case the value). SyncTable was mainly designed
        // for lots of different keys (without changes), as comes up
        // with file editing where you're storing a log.  It's also fine
        // for changing a single key NOT rapidly.
        this.ipywidgets_state.set_model_value(
          model_id,
          this.last_changed[model_id],
        );
        this.ipywidgets_state.save();
      }
      return;
    }
    if (changed.last_changed != null) {
      this.last_changed[model_id] = changed;
    }
    this.state_lock.add(model_id);
    log("handleValueChange: got model and now making this change -- ", changed);
    await this.updateModel(model_id, changed);
    const model = await this.manager.get_model(model_id);
    if (model != null) {
      await model.state_change;
    }
    this.state_lock.delete(model_id);
  };

  // Mutate state to account for any buffers.  We have to do
  // this any time we update the model via the updateModel
  // function; otherwise the state that is getting sync'd around
  // between clients will just forget the buffers that are set
  // via ipywidgets_state_BuffersChange!
  private setBuffers = async (
    model_id: string,
    state: ModelState,
  ): Promise<void> => {
    const { buffer_paths, buffers } =
      await this.ipywidgets_state.get_model_buffers(model_id);
    if (buffer_paths.length == 0) {
      return; // nothing to do
    }
    // convert each ArrayBuffer in buffers to a DataView.
    const paths: string[][] = [];
    const vals: any[] = [];
    for (let i = 0; i < buffers.length; i++) {
      if (state[buffer_paths[i][0]] == null) {
        continue;
      }
      vals.push(new DataView(buffers[i]));
      paths.push(buffer_paths[i]);
    }
    put_buffers(state, paths, vals);
  };

  private ipywidgets_state_BuffersChange = async (model_id: string) => {
    /*
    The data structures currently don't store which buffers changed, so we're
    updating all of them before, which is of course inefficient.

    We definitely do have to serialize, then pass to updateModel, so that
    the widget can properly deserialize again, as I learned with k3d, which
    processes everything.

    A simple example that uses buffers is this image one:
       https://ipywidgets.readthedocs.io/en/latest/examples/Widget%20List.html#image
    */
    const model = await this.manager.get_model(model_id);
    const { buffer_paths, buffers } =
      await this.ipywidgets_state.get_model_buffers(model_id);
    log("handleBuffersChange: ", model_id, buffer_paths);
    const deserialized_state = model.get_state(true);
    const serializers = (model.constructor as any).serializers;
    const change: { [key: string]: any } = {};
    for (let i = 0; i < buffer_paths.length; i++) {
      // TODO/concern: what if buffer_paths is deeper (length > 1)?
      // Will that break something?  We do set things properly later.
      const buffer = buffers[i];
      const key = buffer_paths[i][0];
      const value =
        serializers[key]?.serialize({ buffer, ...deserialized_state[key] }) ??
        deserialized_state[key] ??
        null; // must be null, not undefined, so can json.
      change[key] = value;
    }
    log("handleBuffersChange: ", model_id, change);
    model.set_state(change);
  };

  private ipywidgets_state_MessageChange = async (model_id: string) => {
    // does this needs to tie into openCommChannel in the Environment...?
    const message = this.ipywidgets_state.get_message(model_id);
    log("handleMessageChange: ", model_id, message);
    if (size(message) == 0) {
      // TODO: temporary until we have delete functionality (?)
      return;
    }
    const model = await this.manager.get_model(model_id);
    if (model == null) {
      log("handleMessageChange: no model yet");
      return;
    }
    model.trigger("msg:custom", message);
  };

  // [ ] TODO: maybe have to keep trying for a while until model exists!
  watchModel = async (model_id: string) => {
    if (this.watching.has(model_id)) {
      return;
    }
    // do this before anything else async, or we could end up watching it more
    // than once at a time.
    this.watching.add(model_id);
    const model = await this.manager.get_model(model_id);
    this.last_changed[model_id] = { last_changed: 0 };
    model.on("change", this.handleModelChange);

    // Also, setup comm channel.
    const comm = await this.openCommChannel({
      comm_id: model_id,
      target_name: "jupyter.widget",
    });
    model.comm = comm;
    model.comm_live = true;
    // TODO: we need to setup handling comm messages from
    // the kernel, which should call model._handle_comm_msg.
    // See ipywidgets/packages/base/src/widget.ts
  };

  // handleModelChange is called when an ipywidgets model changes.
  // This function serializes the change and saves it to
  // ipywidgets_state, so that it is gets sync'd to the backend
  // and any other clients.
  private handleModelChange = async (model): Promise<void> => {
    log("handleModelChange", model);
    const { model_id } = model;
    await model.state_change;
    if (this.state_lock.has(model_id)) {
      // log("handleModelChange: ignoring change due to state lock");
      return;
    }
    const changed: any = copy(model.serialize(model.changed));
    delete changed.children; // sometimes they are in there, but shouldn't be sync'ed.
    const { last_changed } = changed;
    delete changed.last_changed;
    if (len(changed) == 0) {
      return; // nothing
    }
    // increment sequence number.
    changed.last_changed =
      Math.max(last_changed ?? 0, this.last_changed[model_id].last_changed) + 1;
    this.last_changed[model_id] = changed;
    log("handleModelChange", changed);
    this.ipywidgets_state.set_model_value(model_id, changed, false);
    this.ipywidgets_state.save();
  };

  private deserializeState = async (
    model: base.DOMWidgetModel,
    serialized_state: ModelState,
  ): Promise<ModelState> => {
    // log("deserializeState", { model, serialized_state });
    // NOTE: this is a reimplementation of soemething in
    //     ipywidgets/packages/base/src/widget.ts
    // but we untagle unpacking and deserializing, which is
    // mixed up there.
    // This is used in an interesting way for the date picker, see:
    //     ipywidgets/packages/controls/src/widget_date.ts
    // in particular for when a date is set in the kernel.

    return await this._deserializeState(
      model.model_id,
      model.constructor,
      serialized_state,
    );
  };

  private _deserializeState = async (
    model_id: string,
    constructor: any,
    serialized_state: ModelState,
  ): Promise<ModelState> => {
    //     console.log("_deserialize_state", {
    //       model_id,
    //       constructor,
    //       serialized_state,
    //     });
    const { serializers } = constructor;

    if (serializers == null) {
      return serialized_state;
    }

    // We skip deserialize if the deserialize function is unpack_model,
    // since we do our own model unpacking, due to issues with ordering
    // and RTC.
    const deserialized: ModelState = {};
    await this.setBuffers(model_id, serialized_state);
    for (const k in serialized_state) {
      const deserialize = serializers[k]?.deserialize;
      if (deserialize != null && !is_unpack_models(deserialize)) {
        deserialized[k] = deserialize(serialized_state[k]);
      } else {
        deserialized[k] = serialized_state[k];
      }
    }

    return deserialized;
  };

  /*
  We do our own model dereferencing (partly replicating code in ipywidgets),
  so that models can be created in random
  order, rather than in exactly the order they are created by the kernel.
  This is important for realtime sync, multiple users, etc.

  Documention for IPY_MODEL_ reference spec:

      https://github.com/jupyter-widgets/ipywidgets/blob/master/packages/schema/jupyterwidgetmodels.v7-4.md#model-state

  TODO: there's no way I can see how to tell which values will be references,
  so we just search  everything for now, at least as a string (layout, style) or
  array of strings (children, axes, buttons).  I wish I knew that those 5 were the
  only keys to consider...  I'm also worried because what if some random value
  just happens to look like a reference?
  */

  // Returns undefined if it is not able to resolve the reference.  In
  // this case, we'll try again later after parsing everything else.
  private dereferenceModelLink = async (
    val: string,
  ): Promise<base.DOMWidgetModel | undefined> => {
    if (val.slice(0, 10) !== "IPY_MODEL_") {
      throw Error(`val (="${val}") is not a model reference.`);
    }

    const model_id = val.slice(10);
    return await this.manager.get_model(model_id);
  };

  private dereferenceModelLinks = async (state): Promise<boolean> => {
    // log("dereferenceModelLinks", "BEFORE", state);
    for (const key in state) {
      const val = state[key];
      if (typeof val === "string") {
        // single string
        if (val.slice(0, 10) === "IPY_MODEL_") {
          // that is a reference
          const model = await this.dereferenceModelLink(val);
          if (model != null) {
            state[key] = model;
          } else {
            return false; // something can't be resolved yet.
          }
        }
      } else if (is_array(val)) {
        // array of stuff
        for (const i in val) {
          if (
            typeof val[i] === "string" &&
            val[i].slice(0, 10) === "IPY_MODEL_"
          ) {
            // this one is a string reference
            const model = await this.dereferenceModelLink(val[i]);
            if (model != null) {
              val[i] = model;
            } else {
              return false;
            }
          }
        }
      } else if (is_object(val)) {
        for (const key in val) {
          const z = val[key];
          if (typeof z == "string" && z.slice(0, 10) == "IPY_MODEL_") {
            const model = await this.dereferenceModelLink(z);
            if (model != null) {
              val[key] = model;
            } else {
              return false;
            }
          }
        }
      }
    }
    // log("dereferenceModelLinks", "AFTER (success)", state);
    return true;
  };

  openCommChannel = async ({
    comm_id,
    target_name,
    data,
    buffers,
  }: {
    comm_id: string;
    target_name: string;
    data?: unknown;
    buffers?: ArrayBuffer[];
  }): Promise<Comm> => {
    log("openCommChannel", { comm_id, target_name, data, buffers });
    const { send_comm_message_to_kernel } = this.actions;
    const comm = {
      async send(data: unknown, opts?: { buffers?: ArrayBuffer[] }) {
        // TODO: buffers!  These need to get sent somehow.
        log("comm.send", data, opts);
        await send_comm_message_to_kernel({ comm_id, target_name, data });
      },

      close() {
        // nothing to actually do (?)
        log("Connection closed");
      },

      get messages() {
        // TODO:
        log("comm.message: Not Implemented");
        // upstream widgets handles these via
        //   comm.on_msg(this._handle_comm_msg.bind(this));
        // see ipywidgets/packages/base/src/widget.ts
        return {
          [Symbol.asyncIterator]: async function* () {},
        };
      },
    };

    if (data != null || buffers != null) {
      await comm.send(data, { buffers });
    }
    return comm;
  };
}

class Environment implements WidgetEnvironment {
  private manager: WidgetManager;
  constructor(manager) {
    this.manager = manager;
  }

  async getModelState(model_id) {
    // log("getModelState", model_id);
    if (this.manager.ipywidgets_state.get_state() != "ready") {
      await once(this.manager.ipywidgets_state, "ready");
    }
    let state = this.manager.ipywidgets_state.get_model_state(model_id);
    if (!state) {
      log("getModelState", model_id, "not yet known -- waiting");
      while (state == null) {
        await once(this.manager.ipywidgets_state, "change");
        state = this.manager.ipywidgets_state.get_model_state(model_id);
      }
    }
    if (state.hasOwnProperty("outputs") && state["outputs"] == null) {
      // It can definitely be 'undefined' but set, e.g., the 'out.clear_output()' example at
      // https://ipywidgets.readthedocs.io/en/latest/examples/Output%20Widget.html
      // causes this, which then totally breaks rendering (due to how the
      // upstream widget manager works).  This works around that.
      state["outputs"] = [];
    }
    setTimeout(() => this.manager.watchModel(model_id), 1);
    return {
      modelName: state._model_name,
      modelModule: state._model_module,
      modelModuleVersion: state._model_module_version,
      state,
    };
  }

  async openCommChannel(
    target_name: string,
    data?: unknown,
    buffers?: ArrayBuffer[],
  ): Promise<Comm> {
    log("Environment: openCommChannel", { target_name, data, buffers });
    throw Error("Not implemented!");
  }

  async renderOutput(outputItem: any, destination: Element): Promise<void> {
    // the gaussian plume notebook has example of this!
    log("renderOutput", { outputItem, destination });
    if (outputItem == null) {
      return;
    }
    const message = fromJS(outputItem);
    const myDiv = document.createElement("div");
    destination.appendChild(myDiv);
    const { actions } = this.manager;
    const { project_id } = actions;
    // NOTE: we are NOT caching iframes here, so iframes in output
    // widgets will refresh if you scroll them off the screen and back.
    const component = React.createElement(
      FileContext.Provider,
      {
        value: { noSanitize: actions.store.get("trust"), project_id },
      },
      React.createElement(
        CellOutputMessage,
        { message, actions, project_id },
        null,
      ),
    );
    const root = ReactDOM.createRoot(myDiv);
    root.render(component);
  }
}

import { WidgetModel } from "@jupyter-widgets/base";
// We do our own sync, but backbone calls this.
WidgetModel.prototype.sync = () => {};
// WidgetModel.prototype.sync = (method, model, options) => {
//   console.log("WidgetModel.sync ", { method, model, options });
// };

// We modify the upstream version from
// ipywidgets/packages/base/src/utils.ts
// to be non-fatal, so it's more flexible wrt to our realtime sync setup.
export function put_buffers(
  state,
  buffer_paths: (string | number)[][],
  buffers: any[],
): void {
  for (let i = 0; i < buffer_paths.length; i++) {
    const buffer_path = buffer_paths[i];
    // make sure the buffers are DataViews
    let buffer = buffers[i];
    if (!(buffer instanceof DataView)) {
      buffer = new DataView(
        buffer instanceof ArrayBuffer ? buffer : buffer.buffer,
      );
    }
    // say we want to set state[x][y][z] = buffer
    let obj = state as any;
    // we first get obj = state[x][y]
    for (let j = 0; j < buffer_path.length - 1; j++) {
      if (obj[buffer_path[j]] == null) {
        // doesn't exist, so create it.  This makes things work in
        // possibly more random order, rather than crashing.  I hit this,
        // e.g., when defining animations for k3d.
        obj[buffer_path[j]] = {};
      }
      obj = obj[buffer_path[j]];
    }
    // and then set: obj[z] = buffer
    obj[buffer_path[buffer_path.length - 1]] = buffer;
  }
}