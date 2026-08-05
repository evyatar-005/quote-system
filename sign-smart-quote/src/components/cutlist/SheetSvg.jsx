import { mm } from './format.js';

/**
 * Renders one sheet layout as an SVG whose user units are millimetres - no
 * scale factor anywhere, placements go straight into x/y/width/height.
 * Colors are literal hex (never CSS vars / Tailwind classes) and the font is
 * a system sans-serif, both because html2canvas serializes this SVG to a
 * data-URL <img> where :root CSS vars and webfonts are unavailable.
 * `layout.sheetW/H` is the USABLE area (the soma band was already deducted by
 * the caller before solving), so the drawing re-adds the band around it to show
 * the real physical plate the user buys, with the soma strip marked in red.
 * @param {{layout: import('./solver/types.js').SheetLayout, colorMap: Map<string,string>,
 *   showLabels: boolean, showCuts: boolean, somaSheetBand?: number, className?: string}} props
 */
export default function SheetSvg({ layout, colorMap, strokeMap, showLabels, showCuts, somaSheetBand = 0, somaPartBand = 0, className }) {
  const W = layout.sheetW;
  const H = layout.sheetH;
  const band = somaSheetBand > 0 ? somaSheetBand : 0;
  const outerW = W + 2 * band;
  const outerH = H + 2 * band;
  const M = Math.max(outerW, outerH) * 0.07;
  const fsBase = Math.max(outerW, outerH) * 0.02;
  const hp = Math.max(outerW, outerH) / 60;

  // Screens are far wider than they are tall, so a portrait plate rendered
  // upright ends up tiny with huge empty margins beside it. Turn those a
  // quarter-turn so the plate's long side runs across the screen.
  const rotateView = outerH > outerW;
  const dispW = rotateView ? outerH : outerW;
  const dispH = rotateView ? outerW : outerH;
  const vb = `${-M} ${-M} ${dispW + 2 * M} ${dispH + 2 * M}`;

  return (
    <svg
      viewBox={vb}
      className={className || 'w-full h-auto max-h-[80vh] mx-auto block'}
      dir="ltr"
      style={{ aspectRatio: `${dispW + 2 * M} / ${dispH + 2 * M}` }}
      preserveAspectRatio="xMidYMid meet"
    >
      <g transform={rotateView ? `translate(${outerH}, 0) rotate(90)` : undefined}>
        {/* soma (CNC registration mark) strip - fills the full plate; the usable
            area is painted over it below, leaving exactly a `band`-wide red edge */}
        {band > 0 && <rect x={0} y={0} width={outerW} height={outerH} fill="#fca5a5" />}

        <g transform={band > 0 ? `translate(${band}, ${band})` : undefined}>
          {/* waste base - plain light fill, no hatching (it used to bleed through
              the translucent part fills and muddy their color) */}
          <rect x={0} y={0} width={W} height={H} fill="#f1f5f9" />

          {/* largest reusable offcut */}
          {layout.largestOffcut && layout.largestOffcut.w > 0 && layout.largestOffcut.h > 0 && (
            <OffcutLabel rect={layout.largestOffcut} fsBase={fsBase} />
          )}

          {/* parts */}
          {layout.placements.map((p, i) => (
            <PartRect
              key={i}
              p={p}
              color={colorMap.get(p.partId) || '#cbd5e1'}
              stroke={strokeMap?.get(p.partId) || '#475569'}
              fsBase={fsBase}
              showLabels={showLabels}
              somaPartBand={somaPartBand}
            />
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
        </g>
      </g>

      {/* main plate outline - drawn last so nothing paints over it */}
      <rect
        x={0}
        y={0}
        width={dispW}
        height={dispH}
        fill="none"
        stroke="#0f172a"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />

      {/* dimension chrome - labels the plate as displayed */}
      <DimChrome W={dispW} H={dispH} M={M} fsBase={fsBase} />
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
        fill="#e2e8f0"
        stroke="#94a3b8"
        strokeWidth={1}
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

function PartRect({ p, color, stroke, fsBase, showLabels, somaPartBand = 0 }) {
  // p.w/p.h include the per-part soma band (it was added before solving), so
  // the real cut piece is inset by `band` on every edge. Draw the footprint in
  // red (the soma strip) with the actual part painted inside it.
  const band = somaPartBand > 0 ? somaPartBand : 0;
  const innerX = p.x + band;
  const innerY = p.y + band;
  const innerW = Math.max(0, p.w - 2 * band);
  const innerH = Math.max(0, p.h - 2 * band);

  const cx = innerX + innerW / 2;
  const cy = innerY + innerH / 2;
  const vertical = innerH > innerW * 1.15;
  const along = vertical ? innerH : innerW;
  const across = vertical ? innerW : innerH;

  let fs = Math.min(fsBase, across * 0.3, along * 0.16);
  const nameLine = p.name;
  // Label the piece the operator actually cuts, not the soma-inflated footprint.
  const dimLine = `${mm(innerW)} × ${mm(innerH)}${p.rotated ? ' ↻' : ''}`;
  const twoLines = across >= fs * 2.6;
  const longest = Math.max(nameLine.length, dimLine.length);
  const needed = longest * 0.55 * fs;
  if (needed > along * 0.92 && needed > 0) fs *= (along * 0.92) / needed;

  const labelMode = !showLabels || fs < fsBase * 0.22 ? 'none' : !twoLines ? 'dimsOnly' : 'full';

  return (
    <g>
      {band > 0 && <rect x={p.x} y={p.y} width={p.w} height={p.h} fill="#fca5a5" />}
      {/* opaque fill: anything translucent picks up the red soma underneath and
          reads as purple instead of the intended cool tone */}
      <rect
        x={innerX}
        y={innerY}
        width={innerW}
        height={innerH}
        fill={color}
        stroke={stroke}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
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
