import { flushSync } from "react-dom";

type ScrollSnapshot = {
  element: HTMLElement;
  left: number;
  top: number;
};

type AnchorSnapshot = {
  element: HTMLElement;
  overflowAnchor: string;
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
  const anchorElements = Array.from(
    new Set([document.documentElement, document.body, ...snapshots.map(({ element }) => element)])
  );
  const anchorSnapshots: AnchorSnapshot[] = anchorElements.map((element) => ({
    element,
    overflowAnchor: element.style.overflowAnchor,
  }));
  const stableRegion = origin.closest<HTMLElement>("[data-stable-removal-region]");
  const windowLeft = window.scrollX;
  const windowTop = window.scrollY;

  if (stableRegion && !stableRegion.dataset.removalHeightLocked) {
    stableRegion.style.minHeight = `${Math.ceil(stableRegion.getBoundingClientRect().height)}px`;
    stableRegion.dataset.removalHeightLocked = "true";
  }
  anchorSnapshots.forEach(({ element }) => {
    element.style.overflowAnchor = "none";
  });
  origin.blur();

  let result!: T;
  flushSync(() => {
    result = action();
  });

  snapshots.forEach(({ element, left, top }) => {
      if (element.scrollLeft !== left) element.scrollLeft = left;
      if (element.scrollTop !== top) element.scrollTop = top;
  });
  if (window.scrollX !== windowLeft || window.scrollY !== windowTop) {
    window.scrollTo({ left: windowLeft, top: windowTop, behavior: "auto" });
  }

  const nextFrame = window.requestAnimationFrame?.bind(window) ??
    ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  nextFrame(() => {
    anchorSnapshots.forEach(({ element, overflowAnchor }) => {
      element.style.overflowAnchor = overflowAnchor;
    });
  });

  return result;
}
