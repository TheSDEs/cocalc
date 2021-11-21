/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

/*
A table of a list of public paths.
*/

import { Space, Table } from "antd";
import { PublicPath } from "lib/share/types";
import A from "components/misc/A";
import SanitizedMarkdown from "components/misc/sanitized-markdown";

function Description({ description }: { description: string }) {
  if (!description?.trim()) return null;
  return (
    <div
      style={{
        maxWidth: "50ex",
        maxHeight: "4em",
        overflow: "auto",
        border: "1px solid #eee",
        borderRadius: "3px",
        padding: "5px",
      }}
    >
      <SanitizedMarkdown value={description} />
    </div>
  );
}

function LastEdited({ last_edited }: { last_edited: string }) {
  return <>{`${new Date(parseFloat(last_edited)).toLocaleString()}`}</>;
}

function Title({ id, title }: { id: string; title: string }) {
  return <A href={`/share/public_paths/${id}`}>{title}</A>;
}

function Visibility({ id, disabled, unlisted, vhost }) {
  if (disabled) {
    return (
      <b>
        <A href={`/share/public_paths/${id}`}>Private</A>
      </b>
    );
  }
  if (unlisted) {
    return <>Unlisted</>;
  }
  if (vhost) {
    return <>Virtual Host: {vhost}</>;
  }
  return <>Listed</>;
}

// I'm using any[]'s below since it's too much of a pain dealing with TS for this.

const COLUMNS0: any[] = [
  {
    title: "Path",
    dataIndex: "path",
    key: "path",
    render: (title, record) => <Title id={record.id} title={title} />,
    responsive: ["sm"] as any,
  },
  {
    title: "Description",
    dataIndex: "description",
    key: "description",
    render: (description) => <Description description={description} />,
    responsive: ["sm"] as any,
  },
  {
    title: "Date Modified",
    dataIndex: "last_edited",
    key: "last_edited",
    render: (last_edited) => <LastEdited last_edited={last_edited} />,
    responsive: ["sm"] as any,
  },
];

const COLUMNS: any[] = COLUMNS0.concat([
  {
    title: "Documents",
    responsive: ["xs"] as any,
    key: "path",
    render: (_, record) => {
      const { path, last_edited, id, description } = record;
      return (
        <Space direction="vertical">
          <Title title={path} id={id} />
          <Description description={description} />
          <LastEdited last_edited={last_edited} />
        </Space>
      );
    },
  },
]);

const COLUMNS_WITH_VISIBILITY: any[] = COLUMNS.concat([
  {
    title: "Visibility",
    dataIndex: "disabled",
    key: "disabled",
    render: (_, record) => (
      <Visibility
        id={record.id}
        disabled={record.disabled}
        unlisted={record.unlisted}
        vhost={record.vhost}
      />
    ),
    responsive: ["sm"] as any,
  },
  {
    title: "Documents",
    responsive: ["xs"] as any,
    key: "path",
    render: (_, record) => {
      const { path, last_edited, id, description } = record;
      return (
        <Space direction="vertical">
          <Title title={path} id={id} />
          <Description description={description} />
          <LastEdited last_edited={last_edited} />
          <Visibility
            id={record.id}
            disabled={record.disabled}
            unlisted={record.unlisted}
            vhost={record.vhost}
          />
        </Space>
      );
    },
  },
]);

interface Props {
  publicPaths?: PublicPath[];
}

export default function PublicPaths({ publicPaths }: Props): JSX.Element {
  let showVisibility = false;
  if (publicPaths) {
    for (const path of publicPaths) {
      const { disabled, unlisted } = path;
      if (disabled || unlisted) {
        showVisibility = true;
        break;
      }
    }
  }
  return (
    <Table
      pagination={false}
      rowKey={"id"}
      loading={publicPaths == null}
      dataSource={publicPaths}
      columns={showVisibility ? COLUMNS_WITH_VISIBILITY : COLUMNS}
      style={{ overflowX: "auto" }}
    />
  );
}
