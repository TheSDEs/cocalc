import getLogger from "@cocalc/backend/logger";
import { db } from "@cocalc/database";
import connectToProject from "@cocalc/server/projects/connection";

import { BaseProject } from "./base";
import kubernetes from "./kubernetes";
import kucalc from "./kucalc";
import multiUser from "./multi-user";
import singleUser from "./single-user";

export const COCALC_MODES = [
  "single-user",
  "multi-user",
  "kucalc",
  "kubernetes",
] as const;

export type CocalcMode = (typeof COCALC_MODES)[number];

export type ProjectControlFunction = (project_id: string) => BaseProject;

// NOTE: you can't *change* the mode -- caching just caches what you first set.
let cached: ProjectControlFunction | undefined = undefined;

export default function init(mode?: CocalcMode): ProjectControlFunction {
  const winston = getLogger("project-control");
  winston.debug("init", mode);
  if (cached !== undefined) {
    winston.info("using cached project control client");
    return cached;
  }
  if (!mode) {
    mode = process.env.COCALC_MODE as CocalcMode;
  }
  if (!mode) {
    throw Error(
      "you can only call projects/control with no mode argument AFTER it has been initialized by the hub or if you set the COCALC_MODE env var"
    );
  }
  winston.info("creating project control client");

  let getProject;
  switch (mode) {
    case "single-user":
      getProject = singleUser;
      break;
    case "multi-user":
      getProject = multiUser;
      break;
    case "kucalc":
      getProject = kucalc;
      break;
    case "kubernetes":
      getProject = kubernetes;
      break;
    default:
      throw Error(`invalid mode "${mode}"`);
  }
  winston.info(`project controller created with mode ${mode}`);
  const database = db();
  database.compute_server = getProject;

  // This is used by the database when handling certain writes to make sure
  // that the there is a connection to the corresponding project, so that
  // the project can respond.
  database.ensure_connection_to_project = async (
    project_id: string,
    cb?: Function
  ): Promise<void> => {
    winston.debug("ensure_connection_to_project --", project_id);
    try {
      await connectToProject(project_id);
      cb?.();
    } catch (err) {
      winston.debug("WARNING: unable to make a connection to", project_id, err);
      cb?.(err);
    }
  };

  cached = getProject;
  return getProject;
}

export const getProject: ProjectControlFunction = (project_id: string) => {
  if (cached == null) {
    if (process.env["COCALC_MODE"]) {
      return init(process.env["COCALC_MODE"] as CocalcMode)(project_id);
    }
    throw Error(
      "must call init first or set the environment variable COCALC_MODE"
    );
  }
  return cached(project_id);
};
