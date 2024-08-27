/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { List, fromJS, Map as immutableMap } from "immutable";

import { Store, redux } from "@cocalc/frontend/app-framework";
import type { HashtagState } from "@cocalc/frontend/editors/task-editor/types";
import { ChatMessages, MentionList } from "./types";
import { getReplyToRoot } from "./actions";

export interface ChatState {
  project_id?: string;
  path?: string;
  height: number; // 0 means not rendered; otherwise is the height of the chat editor
  input: string; // content of the input box
  message_plain_text: string; // What the user sees in the chat box eg. stripped of internal mention markup
  is_preview?: boolean; // currently displaying preview of the main input chat
  messages?: ChatMessages;
  drafts?: Map<string, any>;
  offset?: number; // information about where on screen the chat editor is located
  position?: number; // more info about where chat editor is located
  use_saved_position?: boolean; //   whether or not to maintain last saved scroll position (used when unmounting then remounting, e.g., due to tab change)
  saved_position?: number;
  search: string;
  selectedHashtags: immutableMap<string, HashtagState>;
  add_collab: boolean;
  is_saving: boolean;
  has_uncommitted_changes: boolean;
  has_unsaved_changes: boolean;
  unsent_user_mentions: MentionList;
  is_uploading: boolean;
  font_size: number;
  // whenever this changes and is defined, do a scroll.
  //  scrollToBottom = 0 -- scroll to the bottom
  //  scrollToBottom = ms since epoch -- scroll to the bottom of that thread
  scrollToBottom?: number | null;
  filterRecentH: number;
  llm_cost_room?: [number, number] | null;
  llm_cost_reply?: [number, number] | null;
}

export class ChatStore extends Store<ChatState> {
  getInitialState = () => {
    return {
      height: 0,
      input: "",
      message_plain_text: "",
      is_preview: undefined,
      messages: undefined,
      drafts: undefined,
      offset: undefined,
      position: undefined,
      use_saved_position: undefined,
      saved_position: undefined,
      search: "",
      selectedHashtags: fromJS({}) as any,
      add_collab: false,
      is_saving: false,
      has_uncommitted_changes: false,
      has_unsaved_changes: false,
      unsent_user_mentions: List() as any,
      is_uploading: false,
      font_size: redux.getStore("account").get("font_size"),
      filterRecentH: 0,
    };
  };

  getThreadRootDate = (date: number): number => {
    const messages = this.get("messages") ?? (fromJS({}) as ChatMessages);
    const message = messages.get(`${date}`)?.toJS();
    if (message == null) {
      return 0;
    }
    const d = getReplyToRoot(message, messages);
    return d?.valueOf() ?? 0;
  };
}
