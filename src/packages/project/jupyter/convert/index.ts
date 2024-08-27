/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Node.js interface to nbconvert.
*/

import { executeCode } from "@cocalc/backend/execute-code";
import ipynbToHtml, { htmlPath } from "./ipynb-to-html";
import htmlToPDF from "./html-to-pdf";
import { parseSource, parseTo } from "./util";
import { join } from "path";
import { getLogger } from "@cocalc/project/logger";
import { sanitize_nbconvert_path } from "@cocalc/util/sanitize-nbconvert";
import type { NbconvertParams } from "@cocalc/jupyter/types/nbconvert";

const log = getLogger("jupyter-nbconvert");

export async function nbconvert(opts: NbconvertParams): Promise<void> {
  log.debug("start", opts);
  try {
    if (!opts.timeout) {
      opts.timeout = 60;
    }

    let { j, to } = parseTo(opts.args);

    if (to == "cocalc-html" || to == "cocalc-pdf") {
      // We use our own internal cocalc conversion, since I'm tired of weird subtle issues
      // with upstream nbconvert, and we can also be much faster.
      const ipynb = join(opts.directory ?? "", parseSource(opts.args)); // make relative to home directory
      const html = await ipynbToHtml(ipynb);
      if (to == "cocalc-html") {
        return;
      }
      if (to == "cocalc-pdf") {
        await htmlToPDF(html, opts.timeout);
        return;
      }
      throw Error("impossible");
    }

    let convertToPDF = false;
    const originalSource = parseSource(opts.args); // before any mangling for the benefit of nbconvert.
    if (to == "lab-pdf") {
      for (let i = 0; i < opts.args.length; i++) {
        if (opts.args[i] == "lab-pdf") {
          opts.args[i] = "html";
          break;
        }
      }
      to = "html";
      convertToPDF = true;
    } else if (to == "classic-pdf") {
      for (let i = 0; i < opts.args.length; i++) {
        if (opts.args[i] == "classic-pdf") {
          opts.args[i] = "html";
          break;
        }
      }
      to = "html";
      convertToPDF = true;
      // Put --template argument at beginning -- path must be at the end.
      opts.args = ["--template", "classic"].concat(opts.args);
    }

    let command: string;
    let args: string[];
    if (to === "sagews") {
      // support sagews converter, which is its own script, not in nbconvert.
      // NOTE that if to is set, then j must be set.
      command = "smc-ipynb2sagews";
      args = opts.args.slice(0, j).concat(opts.args.slice(j + 3)); // j+3 cuts out --to and --.
    } else {
      command = "jupyter";
      args = ["nbconvert"].concat(opts.args);
      // This is the **one and only case** where we sanitize the input filename.  Doing so when not calling
      // nbconvert would actually break everything.
      args[args.length - 1] = sanitize_nbconvert_path(args[args.length - 1]);
    }

    log.debug("running ", { command, args });
    // Note about bash/ulimit_timeout below.  This is critical since nbconvert
    // could launch things like pdflatex that might run forever and without
    // ulimit they do not get killed properly; this has happened in production!
    const output = await executeCode({
      command,
      args,
      path: opts.directory,
      err_on_exit: false,
      timeout: opts.timeout, // in seconds
      ulimit_timeout: true,
      bash: true,
    });
    if (output.exit_code != 0) {
      throw Error(output.stderr);
    }

    if (convertToPDF) {
      // Important to use *unmangled* source here!
      await htmlToPDF(htmlPath(join(opts.directory ?? "", originalSource)));
    }
  } finally {
    log.debug("finished");
  }
}
