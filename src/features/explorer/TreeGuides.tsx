const INDENT_PX = 12;
const BASE_PADDING_PX = 8;
const GUIDE_OFFSET_PX = 14;

type TreeGuidesProps = {
  depth: number;
};

export const treeIndent = (depth: number) => BASE_PADDING_PX + depth * INDENT_PX;

export const TreeGuides = ({ depth }: TreeGuidesProps) =>
  Array.from({ length: depth }, (_, level) => (
    <span
      key={level}
      className="absolute top-0 bottom-0 w-px bg-border"
      style={{ left: GUIDE_OFFSET_PX + level * INDENT_PX }}
    />
  ));
