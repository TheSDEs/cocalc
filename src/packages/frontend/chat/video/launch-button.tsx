import { Button, Popconfirm, Popover } from "antd";
import { debounce } from "lodash";
import type { CSSProperties, ReactNode } from "react";
import { useInterval } from "react-interval-hook";

import {
  React,
  useRef,
  useState,
  useTypedRedux,
} from "@cocalc/frontend/app-framework";
import { Icon } from "@cocalc/frontend/components";
import { CancelText } from "@cocalc/frontend/i18n/components";
import { user_activity } from "@cocalc/frontend/tracker";
import { VideoChat } from "./video-chat";

const VIDEO_UPDATE_INTERVAL_MS = 30 * 1000;
// jit.si doesn't seem to have a limit...?
const VIDEO_CHAT_LIMIT = 99999;

interface Props {
  project_id: string;
  path: string;
  sendChat?: (string) => void;
  style?: CSSProperties;
  label?: ReactNode;
}

export default function VideoChatButton({
  project_id,
  path,
  sendChat,
  style: style0,
  label,
}: Props) {
  // to know if somebody else has video chat opened for this file
  // @ts-ignore
  const file_use = useTypedRedux("file_use", "file_use");

  // so we can exclude ourselves
  const account_id: string = useTypedRedux("account", "account_id");

  const [counter, set_counter] = useState<number>(0); // to force updates periodically.
  useInterval(() => set_counter(counter + 1), VIDEO_UPDATE_INTERVAL_MS / 2);

  const video_chat = useRef(new VideoChat(project_id, path, account_id));

  const click_video_button = debounce(
    () => {
      if (video_chat.current.we_are_chatting()) {
        // we are chatting, so stop chatting
        video_chat.current.stop_chatting();
        user_activity("side_chat", "stop_video");
      } else {
        video_chat.current.start_chatting(); // not chatting, so start
        user_activity("side_chat", "start_video");
        if (sendChat != null) {
          sendChat(
            `${
              video_chat.current.get_user_name() ?? "User"
            } joined [the video chat](${video_chat.current.url()}).`,
          );
        }
      }
    },
    750,
    { leading: true },
  );

  function render_num_chatting(
    num_users_chatting: number,
  ): JSX.Element | undefined {
    if (num_users_chatting > 0) {
      return (
        <span>
          <hr />
          There following {num_users_chatting} people are using video chat:
          <br />
          {video_chat.current.get_user_names().join(", ")}
        </span>
      );
    }
  }

  function render_join(num_users_chatting: number): JSX.Element {
    if (video_chat.current.we_are_chatting()) {
      return (
        <span>
          Click to <b>leave</b> this video chatroom.
        </span>
      );
    } else {
      if (num_users_chatting < VIDEO_CHAT_LIMIT) {
        return (
          <span>
            Click to{" "}
            {num_users_chatting == 0 ? "start a new " : "join the current"}{" "}
            video chat.
          </span>
        );
      } else {
        return (
          <span>
            At most {VIDEO_CHAT_LIMIT} people can use the video chat at once.
          </span>
        );
      }
    }
  }

  const num_users_chatting: number =
    video_chat.current.num_users_chatting() ?? 0;
  const style: React.CSSProperties = { cursor: "pointer" };
  if (num_users_chatting > 0) {
    style.color = "#c9302c";
  }

  const body = (
    <>
      <Icon name="video-camera" />
      {num_users_chatting > 0 && (
        <span style={{ marginLeft: "5px" }}>{num_users_chatting}</span>
      )}
      <span style={{ marginLeft: "5px" }}>{label ?? "Video Chat"}</span>
    </>
  );

  return (
    <Popconfirm
      title={`${
        num_users_chatting ? "Join the current" : "Start a new"
      } video chat session about this document?`}
      onConfirm={click_video_button}
      okText={`${num_users_chatting ? "Join" : "Start"} video chat`}
      cancelText={<CancelText />}
    >
      <Popover
        mouseEnterDelay={0.8}
        title={() => (
          <span>
            {render_join(num_users_chatting)}
            {render_num_chatting(num_users_chatting)}
          </span>
        )}
      >
        <Button style={{ ...style, ...style0 }}>{body}</Button>
      </Popover>
    </Popconfirm>
  );
}
