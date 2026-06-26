type AnchorScrollBlock = "start" | "center";

function isScrollable(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return (
    /(auto|scroll|overlay)/.test(style.overflowY) &&
    element.scrollHeight > element.clientHeight
  );
}

function nearestScrollParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent) {
    if (isScrollable(parent)) return parent;
    parent = parent.parentElement;
  }
  return null;
}

export function scrollAnchorIntoView(
  element: HTMLElement | null,
  {
    behavior = "smooth",
    block = "start",
  }: {
    behavior?: ScrollBehavior;
    block?: AnchorScrollBlock;
  } = {}
) {
  if (!element) return;
  const scrollParent = nearestScrollParent(element);
  if (!scrollParent) {
    element.scrollIntoView({ behavior, block });
    return;
  }

  const parentRect = scrollParent.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const topWithinParent = elementRect.top - parentRect.top;
  const targetOffset =
    block === "center"
      ? elementRect.height < scrollParent.clientHeight
        ? (scrollParent.clientHeight - elementRect.height) / 2
        : Math.min(140, Math.max(72, scrollParent.clientHeight * 0.18))
      : 24;
  const nextTop = scrollParent.scrollTop + topWithinParent - targetOffset;
  scrollParent.scrollTo({
    top: Math.max(0, nextTop),
    behavior,
  });
}
