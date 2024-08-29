/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Watch A DIRECTORY for changes.  Use ./watcher.ts for a single file.


Slightly generalized fs.watch that works even when the directory doesn't exist,
but also doesn't provide any information about what changed.

NOTE: We could maintain the directory listing and just try to update info about the filename,
taking into account the type.  That's probably really hard to get right, and just
debouncing and computing the whole listing is going to be vastly easier and good
enough at least for first round of this.

We assume path is relative to HOME and contained inside of HOME.

The code below deals with two very different cases:
 - when that path doesn't exist: use fs.watch on the parent directory.
        NOTE: this case can't happen when path='', which exists, so we can assume to have read perms on parent.
 - when the path does exist: use fs.watch (hence inotify) on the path itself to report when it changes

NOTE: if you are running on a file system like NFS, inotify won't work well or not at all.
In that case, set the env variable COCALC_FS_WATCHER=poll to use polling instead.
You can configure the poll interval by setting COCALC_FS_WATCHER_POLL_INTERVAL_MS.

UPDATE: We are using polling in ALL cases.  We have subtle bugs
with adding and removing directories otherwise, and also
we are only ever watching a relatively small number of directories
with a long interval, so polling is not so bad.
*/

import Watchpack from "watchpack";
import { FSWatcher } from "fs";
import { join } from "path";
import { EventEmitter } from "events";
import { exists } from "@cocalc/backend/misc/async-utils-node";
import { close } from "@cocalc/util/misc";
import { getLogger } from "./logger";

const logger = getLogger("backend:path-watcher");

// const COCALC_FS_WATCHER = process.env.COCALC_FS_WATCHER ?? "inotify";
// if (!["inotify", "poll"].includes(COCALC_FS_WATCHER)) {
//   throw new Error(
//     `$COCALC_FS_WATCHER=${COCALC_FS_WATCHER} -- must be "inotify" or "poll"`,
//   );
// }
// const POLLING = COCALC_FS_WATCHER === "poll";

const POLLING = true;

const DEFAULT_POLL_MS = parseInt(
  process.env.COCALC_FS_WATCHER_POLL_INTERVAL_MS ?? "1500",
);

const WatchpackOptions = {
  aggregateTimeout: 1000,
  poll: DEFAULT_POLL_MS,
  followSymlinks: false, // don't wander about
} as const;

export class Watcher extends EventEmitter {
  private path: string;
  private exists: boolean;
  private watchContents?: FSWatcher;
  private watchExistence?: FSWatcher;
  private interval_ms: number;
  private debounce_ms: number;
  private log: Function;

  constructor(
    path: string,
    {
      debounce: debounce_ms = 0,
      interval: interval_ms,
    }: { debounce?: number; interval?: number } = {},
  ) {
    super();
    this.log = logger.extend(path).debug;
    this.log(`initializing: poll=${POLLING}`);
    if (process.env.HOME == null) {
      throw Error("bug -- HOME must be defined");
    }
    this.path = path.startsWith("/") ? path : join(process.env.HOME, path);
    this.debounce_ms = debounce_ms;
    this.interval_ms = interval_ms ?? DEFAULT_POLL_MS;
    this.init();
  }

  private async init(): Promise<void> {
    this.log("init watching", this.path);
    this.exists = await exists(this.path);
    if (this.path != "") {
      this.log("init watching", this.path, " for existence");
      this.initWatchExistence();
    }
    if (this.exists) {
      this.log("init watching", this.path, " contents");
      this.initWatchContents();
    }
  }

  private watchpackOptions = () => {
    return {
      ...WatchpackOptions,
      poll: this.interval_ms ?? WatchpackOptions.poll,
      aggregateTimeout: this.debounce_ms ?? WatchpackOptions.aggregateTimeout,
    };
  };

  private initWatchContents(): void {
    const w = new Watchpack(this.watchpackOptions());
    this.watchContents = w;
    w.watch({ directories: [this.path] });
    w.on("aggregated", this.change);
    w.on("error", (err) => {
      this.log(`error watching listings -- ${err}`);
    });
  }

  private async initWatchExistence(): Promise<void> {
    const w = new Watchpack(this.watchpackOptions());
    this.watchContents = w;
    w.watch({ missing: [this.path] });
    w.on("aggregated", this.change);
    w.on("error", (err) => {
      this.log(`error watching listings -- ${err}`);
    });
  }

  private change = (): void => {
    this.emit("change");
  };

  public close(): void {
    this.watchExistence?.close();
    this.watchContents?.close();
    close(this);
  }
}
