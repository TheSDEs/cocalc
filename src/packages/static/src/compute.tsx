/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import "./webapp-libraries";
import { init } from "@cocalc/frontend/compute-entry-point";
import { startedUp } from "./webapp-error";

init();
startedUp();
