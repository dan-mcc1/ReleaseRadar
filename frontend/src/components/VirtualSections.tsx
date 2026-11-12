import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { POSTER_COLS, type ColBreakpoint } from "./VirtualGrid";

function colsForWidth(breakpoints: ColBreakpoint[], width: number): number {
  return (breakpoints.find((bp) => width >= bp.minWidth) ?? breakpoints[breakpoints.length - 1]).cols;
}

export interface GridSection<T> {
  key: string;
  /** Drawn above the section's items; a section without one has no heading. */
  title?: string;
  /** Beside the title, e.g. "9 titles". */
  note?: string;
  items: T[];
}

interface Props<T> {
  sections: GridSection<T>[];
  renderItem: (item: T) => React.ReactNode;
  itemKey: (item: T) => string;
  colBreakpoints?: ColBreakpoint[];
  /** px gap between rows */
  rowGap?: number;
  /** px gap between columns */
  colGap?: number;
  /** Height of an item below its 2:3 poster, for the first estimate. */
  captionHeight?: number;
  className?: string;
}

type Row<T> =
  | { kind: "heading"; key: string; title: string; note?: string; first: boolean }
  | { kind: "items"; key: string; items: T[] };

const HEADING_HEIGHT = 57;
const SECTION_GAP = 40;

/**
 * VirtualGrid with headed sections: a heading, then that section's items in
 * rows, then the next. Only the rows near the screen are rendered.
 */
export default function VirtualSections<T>({
  sections,
  renderItem,
  itemKey,
  colBreakpoints = POSTER_COLS,
  rowGap = 20,
  colGap = 12,
  captionHeight = 24,
  className,
}: Props<T>) {
  // The React Compiler would cache getVirtualItems(): the virtualizer is one
  // object that changes inside, so the rows would never follow the scroll.
  "use no memo";
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    const ro = new ResizeObserver(() => setViewportWidth(window.innerWidth));
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const numCols = colsForWidth(colBreakpoints, viewportWidth);

  const rows = useMemo(() => {
    const out: Row<T>[] = [];
    sections.forEach((section, s) => {
      if (section.title) {
        out.push({
          kind: "heading",
          key: `h-${section.key}`,
          title: section.title,
          note: section.note,
          first: s === 0,
        });
      }
      for (let i = 0; i < section.items.length; i += numCols) {
        const items = section.items.slice(i, i + numCols);
        out.push({ kind: "items", key: `${section.key}-${itemKey(items[0])}`, items });
      }
    });
    return out;
  }, [sections, numCols, itemKey]);

  // Distance from the page top to the grid, which useWindowVirtualizer needs.
  // Measured after every render (what's above, like a filter panel, can
  // change height) and on resize; setting an unchanged number is a no-op.
  const measureMargin = useCallback(() => {
    if (containerRef.current) {
      setScrollMargin(
        Math.round(containerRef.current.getBoundingClientRect().top + window.scrollY),
      );
    }
  }, []);
  useLayoutEffect(measureMargin);
  useEffect(() => {
    window.addEventListener("resize", measureMargin);
    return () => window.removeEventListener("resize", measureMargin);
  }, [measureMargin]);

  const gridWidth = containerWidth || viewportWidth;
  const cellWidth = (gridWidth - colGap * (numCols - 1)) / numCols;
  const itemRowHeight = Math.round(cellWidth * 1.5) + captionHeight + rowGap;

  const estimateSize = useCallback(
    (index: number) => {
      const row = rows[index];
      if (row.kind === "items") return itemRowHeight;
      return HEADING_HEIGHT + (row.first ? 0 : SECTION_GAP);
    },
    [rows, itemRowHeight],
  );

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize,
    overscan: 3,
    scrollMargin,
    getItemKey: (index) => rows[index].key,
  });

  return (
    <div ref={containerRef} className={className}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const row = rows[vRow.index];
          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${vRow.start - scrollMargin}px)` }}
            >
              {row.kind === "heading" ? (
                <div className={row.first ? "" : "pt-10"}>
                  <div className="flex items-baseline gap-3 pb-3 mb-4 border-b border-neutral-800">
                    <h2 className="text-title font-semibold text-neutral-100">{row.title}</h2>
                    {row.note && <span className="text-label text-neutral-400">{row.note}</span>}
                  </div>
                </div>
              ) : (
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: `repeat(${numCols}, minmax(0, 1fr))`,
                    columnGap: colGap,
                    paddingBottom: rowGap,
                  }}
                >
                  {row.items.map((item) => (
                    <div key={itemKey(item)} className="min-w-0">
                      {renderItem(item)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
