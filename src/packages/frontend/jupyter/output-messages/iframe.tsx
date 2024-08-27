/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Handle iframe output messages involving a src doc.
*/

import { delay } from "awaiting";
import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import useIsMountedRef from "@cocalc/frontend/app-framework/is-mounted-hook";
import useCounter from "@cocalc/frontend/app-framework/counter-hook";
import { get_blob_url } from "../server-urls";
import HTML from "./mime-types/html";

// This impact loading the iframe data from the backend project (via the sha1 hash).
// Doing retries is useful, e.g., since the project might not be running.
const MAX_ATTEMPTS = 10;
const MAX_WAIT = 5000;
const BACKOFF = 1.3;

const HEIGHT = "70vh";
const WIDTH = "100vw";

interface Props {
  sha1: string;
  project_id: string;
  cacheId?: string;
  index?: number;
  trust?: boolean;
}

export default function IFrame(props: Props) {
  // we only use cached iframe if the iframecontext is setup, e.g., it is in Jupyter notebooks, but not in whiteboards.
  if (props.cacheId == null || !props.trust) {
    return <NonCachedIFrame {...props} />;
  } else {
    const src = get_blob_url(props.project_id, "html", props.sha1);
    return (
      <HTML
        id={props.cacheId}
        index={props.index}
        trust={props.trust}
        value={`<iframe src="${src}" style="border:0;height:${HEIGHT};width:${WIDTH}"/>`}
      />
    );
  }
}

function NonCachedIFrame({ sha1, project_id }: Props) {
  const { val: attempts, inc: incAttempts } = useCounter();
  const [failed, setFailed] = useState<boolean>(false);
  const delayRef = useRef<number>(500);
  const isMountedRef = useIsMountedRef();
  const iframeRef = useRef(null);

  useEffect(() => {
    const elt: any = ReactDOM.findDOMNode(iframeRef.current);
    if (elt == null) return;
    elt.onload = function () {
      elt.style.height = elt.contentWindow.document.body.scrollHeight + "px";
    };
  }, []);

  async function load_error(): Promise<void> {
    if (attempts >= MAX_ATTEMPTS) {
      setFailed(true);
      return;
    }
    await delay(delayRef.current);
    if (!isMountedRef.current) return;
    delayRef.current = Math.max(MAX_WAIT, delayRef.current * BACKOFF);
    incAttempts();
  }

  if (failed) {
    return <div>Failed to load iframe contents</div>;
  }

  return (
    <iframe
      ref={iframeRef}
      src={get_blob_url(project_id, "html", sha1) + `&attempts=${attempts}`}
      onError={load_error}
      style={{ border: 0, width: WIDTH, minHeight: HEIGHT }}
    />
  );
}
