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

/** Animate and commit a disappearing row without allowing focus or layout to move the page. */
export function preserveScrollDuring<T>(origin: HTMLElement, action: () => T): void {
  if (typeof window === "undefined") {
    action();
    return;
  }

  const snapshots = scrollableAncestors(origin);
  const anchorElements = Array.from(
    new Set([document.documentElement, document.body, ...snapshots.map(({ element }) => element)])
  );
  const anchorSnapshots: AnchorSnapshot[] = anchorElements.map((element) => ({
    element,
    overflowAnchor: element.style.overflowAnchor,
  }));
  const stableRegion = origin.closest<HTMLElement>("[data-stable-removal-region]");
  const removalItem = origin.closest<HTMLElement>("[data-removal-item]") ??
    origin.closest<HTMLElement>("li");
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

  const restoreScroll = () => {
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
  const commitRemoval = () => {
    flushSync(() => {
      action();
    });
    restoreScroll();
    nextFrame(() => {
      anchorSnapshots.forEach(({ element, overflowAnchor }) => {
        element.style.overflowAnchor = overflowAnchor;
      });
    });
  };

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (!removalItem || typeof removalItem.animate !== "function" || reduceMotion) {
    commitRemoval();
    return;
  }

  if (removalItem.dataset.removalAnimating === "true") return;
  removalItem.dataset.removalAnimating = "true";
  removalItem.style.pointerEvents = "none";
  const height = Math.ceil(removalItem.getBoundingClientRect().height);
  const animation = removalItem.animate(
    [
      {
        height: `${height}px`,
        opacity: 1,
        transform: "translateX(0) scale(1)",
        backgroundColor: "rgba(220, 38, 38, 0)",
      },
      {
        height: `${height}px`,
        opacity: 0.9,
        transform: "translateX(4px) scale(0.995)",
        backgroundColor: "rgba(220, 38, 38, 0.12)",
        offset: 0.35,
      },
      {
        height: "0px",
        minHeight: "0px",
        paddingTop: "0px",
        paddingBottom: "0px",
        marginTop: "0px",
        marginBottom: "0px",
        borderWidth: "0px",
        opacity: 0,
        transform: "translateX(20px) scale(0.98)",
        backgroundColor: "rgba(220, 38, 38, 0.08)",
      },
    ],
    {
      duration: 260,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "forwards",
    }
  );

  void animation.finished.then(commitRemoval, commitRemoval);
}
