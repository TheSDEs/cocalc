/*
Create an immortal DOM node.  This is a way to render HTML that stays stable
irregardless of it being unmounted/remounted.
This supports virtualization, window splitting, etc., without loss of state.
*/

import { useCallback, useEffect, useRef } from "react";
import $ from "jquery";
import { useFrameContext } from "@cocalc/frontend/frame-editors/frame-tree/frame-context";
import { useIFrameContext } from "@cocalc/frontend/jupyter/cell-list";

interface Props {
  globalKey: string;
  html: string;
  zIndex?: number;
}

const immortals: { [globalKey: string]: any } = {};

const Z_INDEX = 1;

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

export default function ImmortalDomNode({
  globalKey,
  html,
  zIndex = Z_INDEX, // todo: support changing?
}: Props) {
  const divRef = useRef<any>(null);
  const intervalRef = useRef<any>(null);
  const { isVisible } = useFrameContext();
  const iframeContext = useIFrameContext();

  const position = useCallback(() => {
    // make it so elt is exactly positioned on top of divRef.current using CSS
    if (divRef.current == null) {
      return;
    }
    const elt = getElt()[0];
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
    divRef.current.style.width = `${
      eltRect.right - eltRect.left + 2 * PADDING
    }px`;

    // clip our immortal html so it isn't visible outside the parent
    const parent = $(iframeContext.cellListDivRef?.current)[0];
    if (parent != null) {
      const parentRect = parent.getBoundingClientRect();
      console.log({ parentRect, eltRect });
      // Calculate the overlap area
      const top = Math.max(0, parentRect.top - eltRect.top);
      const right = Math.min(eltRect.width, parentRect.right - eltRect.left);
      const bottom = Math.min(eltRect.height, parentRect.bottom - eltRect.top);
      const left = Math.max(0, parentRect.left - eltRect.left);

      // Apply clip-path to elt to make it visible only inside of parentRect:
      elt.style.clipPath = `polygon(${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px)`;
    }
  }, []);

  const getElt = () => {
    if (immortals[globalKey] == null) {
      const elt = (immortals[globalKey] = $(
        `<div id="${globalKey}" style="border:0;position:absolute;z-index:${zIndex}"/>${html}</div>`,
      ));
      $("body").append(elt);
      return elt;
    } else {
      return immortals[globalKey];
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
    intervalRef.current = setInterval(position, 1000);

    if (iframeContext.iframeOnScrolls != null) {
      let count = 0;
      iframeContext.iframeOnScrolls[globalKey] = async () => {
        // We run position a lot whenever there is a scroll
        // in order to make it so the iframe doesn't appear
        // to just get "dragged along" nearly as much, as
        // onScroll is throttled.
        count = Math.min(100, count + 100);
        while (count > 0) {
          position();
          await new Promise(requestAnimationFrame);
          count -= 1;
        }
        // throw in an update when we're done.
        position();
      };
    }

    return () => {
      delete iframeContext.iframeOnScrolls?.[globalKey];
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return <div ref={divRef} style={STYLE}></div>;
}
