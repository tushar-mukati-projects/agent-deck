export const scrollIntoViewNearest = (element: Element | null) =>
  element?.scrollIntoView({ block: "nearest", inline: "nearest" });
