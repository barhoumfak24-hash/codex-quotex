import { flushSync } from "react-dom";

type ScrollSnapshot = {
  element: HTMLElement;
  left: number;
  top: number;
};

function scrollableAncestors(origin: HTMLElement): ScrollSnapshot[] {
  const snapshots: ScrollSnapshot[] = [];
  let element = origin.parentElement;

  while (element) {
    const style = window.getComputedStyle(element);
    const canScroll = /(auto|scroll|overlay)/.test(
      `${style.overflow} ${style.overflowX} ${style.overflowY}`
    );
    if (canScroll) {
      snapshots.push({
        element,
        left: element.scrollLeft,
        top: element.scrollTop,
      });
    }
    element = element.parentElement;
  }

  return snapshots;
}

/** Commit a disappearing row without allowing focus or layout to move the page. */
export function preserveScrollDuring<T>(origin: HTMLElement, action: () => T): T {
  if (typeof window === "undefined") return action();

  const snapshots = scrollableAncestors(origin);
  const windowLeft = window.scrollX;
  const windowTop = window.scrollY;
  origin.blur();

  let result!: T;
  flushSync(() => {
    result = action();
  });

  const restore = () => {
    snapshots.forEach(({ element, left, top }) => {
      if (element.scrollLeft !== left) element.scrollLeft = left;
      if (element.scrollTop !== top) element.scrollTop = top;
    });
    if (window.scrollX !== windowLeft || window.scrollY !== windowTop) {
      window.scrollTo({ left: windowLeft, top: windowTop, behavior: "auto" });
    }
  };

  const nextFrame = window.requestAnimationFrame?.bind(window) ??
    ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));

  restore();
  nextFrame(() => {
    restore();
    nextFrame(restore);
  });

  return result;
}
