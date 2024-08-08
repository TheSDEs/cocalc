/*
Create stable unsafe HTML DOM node.  This is a way to render HTML that stays stable
irregardless of it being unmounted/remounted.

This supports virtualization, window splitting, etc., without loss of state,
unless there are too many of them, then we delete the oldest.

By default, the HTML is just directly put into the DOM exactly as is, except that
we *do* process links so internal references work and math using katex.

Unsafe is in the name since there is NO SANITIZATION.  Only use this on trusted
documents.

Elements only get re-rendered when for IDLE_TIMEOUT_S, both:

- the underlying react element does not exist, AND
- the parent is not scrolled at all.

OR

- if there are more than MAX_ELEMENTS, then the oldest are removed (to avoid catastrophic memory usage).

If for any reason the react element exists or the parent is scrolled, then
the idle timeout is reset.
*/

import { useCallback, useEffect, useRef } from "react";
import $ from "jquery";
import { useFrameContext } from "@cocalc/frontend/frame-editors/frame-tree/frame-context";
import { useIFrameContext } from "@cocalc/frontend/jupyter/cell-list";
import { sha1 } from "@cocalc/util/misc";
import TTL from "@isaacs/ttlcache";

// AFter this many seconds, an element that hasn't been in the react dom and whose
// parent hasn't been scrolled, will get un-rendered.
const IDLE_TIMEOUT_S = 10 * 60; // 10 minutes
// If there are more than this many elements, old ones are un-rendered.
const MAX_ELEMENTS = 500; // max items
// Rough assumption about size of scrollbar.
const SCROLL_WIDTH = 30;
// we have to put the html on top of the notebook to be visible.  This is the z-index we use.
const Z_INDEX = 1;
// no matter what when the html is in the REACT dom, it will have its position updated this frequently.
// it also gets updated on scroll of the cell list.
const POSITION_WHEN_MOUNTED_INTERVAL_MS = 500;

const cache = new TTL<string, any>({
  ttl: IDLE_TIMEOUT_S * 1000,
  max: MAX_ELEMENTS,
  updateAgeOnGet: true,
  dispose: (elt) => {
    elt.empty();
    elt.remove();
  },
});

// make it really standout:
// const PADDING = 5;
// const STYLE = {
//   border: "1px solid #ccc",
//   borderRadius: "5px",
//   padding: `${PADDING}px`,
//   background: "#eee",
// } as const;

// make it blend in
const PADDING = 0;
const STYLE = {} as const;

interface Props {
  docId: string;
  html: string;
  zIndex?: number;
}

export default function StableUnsafeHtml({
  docId,
  html,
  zIndex = Z_INDEX, // todo: support changing?
}: Props) {
  const divRef = useRef<any>(null);
  const intervalRef = useRef<any>(null);
  const { isVisible, project_id, path, id } = useFrameContext();
  const iframeContext = useIFrameContext();

  const globalKey = sha1(`${project_id}-${id}-${docId}-${path}-${html}`);

  const position = useCallback(() => {
    // make it so elt is exactly positioned on top of divRef.current using CSS
    if (divRef.current == null) {
      return;
    }
    const jElt = getElt();
    const elt = jElt[0];
    const eltRect = elt.getBoundingClientRect();
    const divRect = divRef.current.getBoundingClientRect();

    // position our immortal html element
    let deltaTop = divRect.top - eltRect.top;
    if (deltaTop) {
      if (elt.style.top) {
        deltaTop += parseFloat(elt.style.top.slice(0, -2));
      }
      elt.style.top = `${deltaTop + PADDING}px`;
    }
    let deltaLeft = divRect.left - eltRect.left;
    if (deltaLeft) {
      if (elt.style.left) {
        deltaLeft += parseFloat(elt.style.left.slice(0, -2));
      }
      elt.style.left = `${deltaLeft + PADDING}px`;
    }

    // set the size of the actual react div that is in place
    divRef.current.style.height = `${
      eltRect.bottom - eltRect.top + 2 * PADDING
    }px`;
    //     divRef.current.style.width = `${
    //       eltRect.right - eltRect.left + 2 * PADDING
    //     }px`;

    // clip our immortal html so it isn't visible outside the parent
    const parent = $(iframeContext.cellListDivRef?.current)[0];
    if (parent != null) {
      const parentRect = parent.getBoundingClientRect();
      // Calculate the overlap area
      const top = Math.max(0, parentRect.top - eltRect.top);
      // leave 30px on right so to not block scrollbar
      const right = Math.min(
        eltRect.width,
        parentRect.right - SCROLL_WIDTH - eltRect.left,
      );
      const bottom = Math.min(eltRect.height, parentRect.bottom - eltRect.top);
      const left = Math.max(0, parentRect.left - eltRect.left);

      // Apply clip-path to elt to make it visible only inside of parentRect:
      elt.style.clipPath = `polygon(${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px)`;

      // Set widht, so it possible to scroll horizontally and see whatever widget is in the output.
      const w = $(divRef.current).width();
      if (w) {
        elt.style.width = `${w}px`;
      }

      // if its an iframe resize it
      if (html.toLowerCase().startsWith("<iframe")) {
        const iframe = jElt.find("iframe");
        if (iframe.length > 0) {
          var iframeBody = iframe.contents().find("body");
          if (iframeBody.length > 0) {
            // Get dimensions of the iframe's body
            const height = iframeBody.outerHeight();
            iframe[0].style.height = `${height}px`;
          }
        }
      }
    }
  }, []);

  const getElt = () => {
    if (!cache.has(globalKey)) {
      const elt = $(
        `<div id="${globalKey}" style="border:0;position:absolute;overflow:auto;z-index:${zIndex}"/>${html}</div>`,
      );
      // @ts-ignore
      elt.process_smc_links();
      // @ts-ignore
      elt.katex({ preProcess: true });
      cache.set(globalKey, elt);
      $("body").append(elt);
      return elt;
    } else {
      return cache.get(globalKey);
    }
  };

  const show = () => {
    if (divRef.current == null) {
      return;
    }
    const elt = getElt();
    elt.show();
    position();
  };

  const hide = () => {
    // unmounting so hide
    const elt = getElt();
    elt.hide();
  };

  useEffect(() => {
    if (isVisible) {
      show();
      return hide;
    }
  }, [isVisible]);

  useEffect(() => {
    // TOOD: can we get rid of interval by using a resize observer on
    // this iframeContext.cellListDivRef?
    intervalRef.current = setInterval(
      position,
      POSITION_WHEN_MOUNTED_INTERVAL_MS,
    );
    if (iframeContext.iframeOnScrolls != null) {
      iframeContext.iframeOnScrolls[globalKey] = async () => {
        position();
        await new Promise(requestAnimationFrame);
        position();
      };
    }
    position();
    setTimeout(position, 0);

    return () => {
      delete iframeContext.iframeOnScrolls?.[globalKey];
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return <div ref={divRef} style={STYLE}></div>;
}
