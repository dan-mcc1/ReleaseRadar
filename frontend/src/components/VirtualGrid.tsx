import { useRef, useEffect, useState, useLayoutEffect, useCallback } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

export interface ColBreakpoint {
  minWidth: number;
  cols: number;
}

// Matches Tailwind sm/md/lg/xl breakpoints — override per page as needed.
export const POSTER_COLS: ColBreakpoint[] = [
  { minWidth: 1280, cols: 8 },
  { minWidth: 1024, cols: 7 },
  { minWidth: 768,  cols: 6 },
  { minWidth: 640,  cols: 5 },
  { minWidth: 0,    cols: 4 },
];

interface Props<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  colBreakpoints?: ColBreakpoint[];
  /** px gap between rows */
  rowGap?: number;
  /** px gap between columns */
  colGap?: number;
  className?: string;
}

function colsForWidth(breakpoints: ColBreakpoint[], width: number): number {
  for (const bp of breakpoints) {
    if (width >= bp.minWidth) return bp.cols;
  }
  return breakpoints[breakpoints.length - 1].cols;
}

export default function VirtualGrid<T>({
  items,
  renderItem,
  colBreakpoints = POSTER_COLS,
  rowGap = 20,
  colGap = 12,
  className,
}: Props<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Track viewport width for responsive column count.
  useEffect(() => {
    const ro = new ResizeObserver(() => setViewportWidth(window.innerWidth));
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, []);

  // scrollMargin = distance from page top to grid top, needed by useWindowVirtualizer.
  useLayoutEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setScrollMargin(containerRef.current.getBoundingClientRect().top + window.scrollY);
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [items.length]);

  const numCols = colsForWidth(colBreakpoints, viewportWidth);
  const numRows = Math.ceil(items.length / numCols);

  // Estimate row height: poster is aspect-[2/3], title is ~20px, gap on top of each row.
  // Container width minus inter-column gaps, divided by numCols → cell width.
  const containerWidth = containerRef.current?.clientWidth ?? viewportWidth;
  const cellWidth = (containerWidth - colGap * (numCols - 1)) / numCols;
  const estimatedRowHeight = Math.round(cellWidth * 1.5) + 24; // poster + title

  const estimateSize = useCallback(
    () => estimatedRowHeight + rowGap,
    [estimatedRowHeight, rowGap],
  );

  const virtualizer = useWindowVirtualizer({
    count: numRows,
    estimateSize,
    overscan: 3,
    scrollMargin,
  });

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div ref={containerRef} className={className}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualRows.map((vRow) => {
          const startIdx = vRow.index * numCols;
          const rowItems = items.slice(startIdx, startIdx + numCols);
          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${vRow.start - scrollMargin}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${numCols}, 1fr)`,
                columnGap: colGap,
                rowGap,
              }}
            >
              {rowItems.map((item, i) => renderItem(item, startIdx + i))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
