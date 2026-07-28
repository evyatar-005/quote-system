import { useId } from 'react';
import { mm } from './format.js';

/**
 * Renders one sheet layout as an SVG whose user units are millimetres - no
 * scale factor anywhere, placements go straight into x/y/width/height.
 * Colors are literal hex (never CSS vars / Tailwind classes) and the font is
 * a system sans-serif, both because html2canvas serializes this SVG to a
 * data-URL <img> where :root CSS vars and webfonts are unavailable.
 * @param {{layout: import('./solver/types.js').SheetLayout, colorMap: Map<string,string>,
 *   showLabels: boolean, showCuts: boolean, className?: string}} props
 */
export default function SheetSvg({ layout, colorMap, showLabels, showCuts, className }) {
  const uid = useId();
  const W = layout.sheetW;
  const H = layout.sheetH;
  const M = Math.max(W, H) * 0.07;
  const fsBase = Math.max(W, H) * 0.02;
  const hp = Math.max(W, H) / 60;
  const vb = `${-M} ${-M} ${W + 2 * M} ${H + 2 * M}`;

  return (
    <svg
      viewBox={vb}
      className={className || 'w-full h-auto block'}
      dir="ltr"
      style={{ aspectRatio: `${W + 2 * M} / ${H + 2 * M}` }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id={`hatch-${uid}`} width={hp} height={hp} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={hp} height={hp} fill="#f1f5f9" />
          <line x1={0} y1={0} x2={0} y2={hp} stroke="#cbd5e1" strokeWidth={hp * 0.22} />
        </pattern>
      </defs>

      {/* waste base */}
      <rect x={0} y={0} width={W} height={H} fill={`url(#hatch-${uid})`} />

      {/* largest reusable offcut */}
      {layout.largestOffcut && layout.largestOffcut.w > 0 && layout.largestOffcut.h > 0 && (
        <OffcutLabel rect={layout.largestOffcut} fsBase={fsBase} />
      )}

      {/* parts */}
      {layout.placements.map((p, i) => (
        <PartRect key={i} p={p} color={colorMap.get(p.partId) || '#94a3b8'} fsBase={fsBase} showLabels={showLabels} />
      ))}

      {/* cut lines (guillotine only) */}
      {showCuts &&
        layout.cuts.map((c, i) =>
          c.axis === 'x' ? (
            <line key={i} x1={c.pos} y1={c.a} x2={c.pos} y2={c.b} stroke="#0f172a" strokeOpacity={0.4} strokeDasharray={`${hp * 0.6} ${hp * 0.4}`} vectorEffect="non-scaling-stroke" />
          ) : (
            <line key={i} x1={c.a} y1={c.pos} x2={c.b} y2={c.pos} stroke="#0f172a" strokeOpacity={0.4} strokeDasharray={`${hp * 0.6} ${hp * 0.4}`} vectorEffect="non-scaling-stroke" />
          )
        )}

      {/* sheet outline */}
      <rect x={0} y={0} width={W} height={H} fill="none" stroke="#0f172a" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />

      {/* dimension chrome */}
      <DimChrome W={W} H={H} M={M} fsBase={fsBase} />
    </svg>
  );
}

function OffcutLabel({ rect, fsBase }) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const fs = Math.min(fsBase * 0.9, rect.w * 0.14, rect.h * 0.14);
  const showText = fs > fsBase * 0.35 && rect.w > fsBase * 4 && rect.h > fsBase * 2;
  return (
    <g>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        fill="#ffffff"
        fillOpacity={0.65}
        stroke="#64748b"
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      {showText && (
        <text
          x={cx}
          y={cy}
          fontSize={fs}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#334155"
          fontFamily="Arial, 'Segoe UI', sans-serif"
        >
          {`שארית: ${mm(rect.w)} × ${mm(rect.h)}`}
        </text>
      )}
    </g>
  );
}

function PartRect({ p, color, fsBase, showLabels }) {
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const vertical = p.h > p.w * 1.15;
  const along = vertical ? p.h : p.w;
  const across = vertical ? p.w : p.h;

  let fs = Math.min(fsBase, across * 0.3, along * 0.16);
  const nameLine = p.name;
  const dimLine = `${mm(p.w)} × ${mm(p.h)}${p.rotated ? ' ↻' : ''}`;
  const twoLines = across >= fs * 2.6;
  const longest = Math.max(nameLine.length, dimLine.length);
  const needed = longest * 0.55 * fs;
  if (needed > along * 0.92 && needed > 0) fs *= (along * 0.92) / needed;

  const labelMode = !showLabels || fs < fsBase * 0.22 ? 'none' : !twoLines ? 'dimsOnly' : 'full';

  return (
    <g>
      <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {labelMode !== 'none' && (
        <g transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}>
          <text x={cx} y={cy} fontSize={fs} textAnchor="middle" dominantBaseline="central" fill="#0f172a" fontFamily="Arial, 'Segoe UI', sans-serif" style={{ pointerEvents: 'none' }}>
            {labelMode === 'full' ? (
              <>
                <tspan x={cx} dy={-fs * 0.55} style={{ direction: 'rtl', unicodeBidi: 'plaintext' }}>
                  {nameLine}
                </tspan>
                <tspan x={cx} dy={fs * 1.15} style={{ direction: 'ltr', unicodeBidi: 'plaintext' }}>
                  {dimLine}
                </tspan>
              </>
            ) : (
              <tspan x={cx} style={{ direction: 'ltr', unicodeBidi: 'plaintext' }}>
                {dimLine}
              </tspan>
            )}
          </text>
        </g>
      )}
    </g>
  );
}

function DimChrome({ W, H, M, fsBase }) {
  const tick = M * 0.12;
  const barY = -M * 0.45;
  const barX = -M * 0.45;
  return (
    <g stroke="#475569" fill="none" vectorEffect="non-scaling-stroke">
      <line x1={0} y1={barY} x2={W} y2={barY} />
      <line x1={0} y1={barY - tick} x2={0} y2={barY + tick} />
      <line x1={W} y1={barY - tick} x2={W} y2={barY + tick} />
      <text x={W / 2} y={barY - M * 0.17} fontSize={fsBase} textAnchor="middle" fill="#334155" stroke="none" fontFamily="Arial, sans-serif">
        {mm(W)}
      </text>

      <line x1={barX} y1={0} x2={barX} y2={H} />
      <line x1={barX - tick} y1={0} x2={barX + tick} y2={0} />
      <line x1={barX - tick} y1={H} x2={barX + tick} y2={H} />
      <text x={barX - M * 0.17} y={H / 2} fontSize={fsBase} textAnchor="middle" fill="#334155" stroke="none" fontFamily="Arial, sans-serif" transform={`rotate(-90 ${barX - M * 0.17} ${H / 2})`}>
        {mm(H)}
      </text>
    </g>
  );
}
