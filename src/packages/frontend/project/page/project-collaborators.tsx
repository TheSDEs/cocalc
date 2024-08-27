/*
 *  This file is part of CoCalc: Copyright © 2023 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { useProjectContext } from "@cocalc/frontend/project/context";
import { Alert } from "@cocalc/frontend/antd-bootstrap";
import { useTypedRedux } from "@cocalc/frontend/app-framework";
import {
  AddCollaborators,
  CurrentCollaboratorsPanel,
} from "@cocalc/frontend/collaborators";
import {
  Icon,
  Loading,
  Paragraph,
  SettingBox,
  Title,
} from "@cocalc/frontend/components";
import { getStudentProjectFunctionality } from "@cocalc/frontend/course";
import { ICON_USERS, ROOT_STYLE, TITLE_USERS } from "../servers/consts";
import { useProject } from "./common";
import { SandboxProjectSettingsWarning } from "../settings/settings";

export function ProjectCollaboratorsPage(): JSX.Element {
  const { project_id } = useProjectContext();
  const user_map = useTypedRedux("users", "user_map");
  const student = getStudentProjectFunctionality(project_id);
  const { project, group } = useProject(project_id);

  function renderSettings() {
    if (project == null) {
      return <Loading theme="medium" />;
    }
    return (
      <>
        <CurrentCollaboratorsPanel
          key="current-collabs"
          project={project}
          user_map={user_map}
        />
        {!student.disableCollaborators && (
          <SettingBox title="Add New Collaborators" icon="UserAddOutlined">
            <AddCollaborators
              project_id={project.get("project_id")}
              where="project-settings"
            />
          </SettingBox>
        )}
      </>
    );
  }

  function renderAdmin() {
    if (group !== "admin") return;
    return (
      <Alert bsStyle="warning" style={{ margin: "10px" }}>
        <h4>
          <strong>
            Warning: you are editing the project settings as an administrator.
          </strong>
        </h4>
      </Alert>
    );
  }

  if (group != "admin" && group != "owner" && project?.get("sandbox")) {
    return <SandboxProjectSettingsWarning />;
  }

  return (
    <div
      style={{
        ...ROOT_STYLE,
        width: "1000px",
        maxWidth: "100%",
        margin: "auto",
      }}
    >
      <Title level={2}>
        <Icon name={ICON_USERS} /> {TITLE_USERS}
      </Title>
      <Paragraph>{COLLABS_INFO_TEXT}</Paragraph>
      {renderAdmin()}
      {renderSettings()}
    </div>
  );
}

export const COLLABS_INFO_TEXT =
  "Collaborators are people who can access this project. They can view and edit the same files as you.";
