import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Calculator, Eraser, LayoutGrid, Gem } from 'lucide-react';
import { Button } from '@/components/ui/button';
import LogoutButton from '@/components/LogoutButton';
import printellaLogo from '@/assets/printella-logo.png';

import CutlistGridSection from '@/components/cutlist/CutlistGridSection.jsx';
import CutlistOptionsSection from '@/components/cutlist/CutlistOptionsSection.jsx';
import ResultsPanel from '@/components/cutlist/ResultsPanel.jsx';
import { useCutListState } from '@/components/cutlist/useCutListState.js';
import { sampleInput } from '@/components/cutlist/presets.js';
import { optimize } from '@/components/cutlist/solver/optimize.js';
import { verifyLayout } from '@/components/cutlist/solver/stats.js';

export default function CutListOptimizer() {
  const state = useCutListState();
  const [result, setResult] = useState(null);
  const [computing, setComputing] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [showCuts, setShowCuts] = useState(true);

  const { input, errors, tooLarge } = state.normalized;
  const canCompute = errors.length === 0;

  const handleCompute = () => {
    setComputing(true);
    // Two nested rAFs: the first lets React commit the "computing" state,
    // the second guarantees a paint before the (possibly blocking) solve runs.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const res = optimize(input, {
          quality: state.quality,
          seed: state.seed,
          deterministic: state.deterministic,
        });
        if (import.meta.env.DEV) {
          const violations = verifyLayout(res, input);
          if (violations.length) console.error('[cutlist] invariant violations', violations);
        }
        setResult(res);
        setComputing(false);
      })
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir="rtl">
      <div className="cutlist-no-print sticky top-0 z-20 bg-white/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={printellaLogo} alt="Printella" className="h-16 object-contain" />
            <h1 className="font-semibold text-lg">ניצולת חיתוך לוחות</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/costs"
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-amber-600 transition-colors px-3 py-1.5 rounded-lg border border-black hover:border-amber-300"
            >
              <ArrowRight className="w-3.5 h-3.5" /> חזרה למחשבון
            </Link>
            <LogoutButton />
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-6">
        <div>
          {/* Dimensions + options - fixed flush against the true right edge of the
              viewport on large screens (not just the content column), so it never
              drifts inward as the window widens. Falls back to normal in-flow
              stacking on narrow/mobile screens. */}
          <aside className="cutlist-no-print space-y-3 mb-4 lg:mb-0 lg:fixed lg:top-20 lg:bottom-4 lg:right-4 lg:w-[400px] lg:overflow-y-auto lg:pl-1">
            <CutlistGridSection
              title="לוחות לחיתוך (פרגלים/צדדים)"
              icon={LayoutGrid}
              rows={state.parts}
              unit={state.unit}
              onUnitChange={state.setUnit}
              onChange={state.updatePart}
              onAdd={state.addPart}
              onRemove={state.removePart}
            />

            <CutlistGridSection
              title="לוחות/פלטות במאגר/מחסן לחישוב"
              icon={Gem}
              rows={state.stocks}
              unit={state.unit}
              onUnitChange={state.setUnit}
              onChange={state.updateStock}
              onAdd={state.addStock}
              onRemove={state.removeStock}
            />

            <CutlistOptionsSection
              kerf={state.kerf}
              mode={state.mode}
              quality={state.quality}
              seed={state.seed}
              deterministic={state.deterministic}
              showLabels={showLabels}
              showCuts={showCuts}
              onKerfChange={state.setKerf}
              onModeChange={state.setMode}
              onQualityChange={state.setQuality}
              onSeedChange={state.setSeed}
              onDeterministicChange={state.setDeterministic}
              onShowLabelsChange={setShowLabels}
              onShowCutsChange={setShowCuts}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" className="gap-2" onClick={handleCompute} disabled={!canCompute || computing}>
                <Calculator className="w-4 h-4" /> {computing ? 'מחשב...' : 'חשב'}
              </Button>
              <Button type="button" variant="outline" onClick={() => state.loadPreset(sampleInput())}>
                טען דוגמה
              </Button>
              <Button type="button" variant="ghost" className="gap-2 text-slate-500" onClick={state.clearAll}>
                <Eraser className="w-4 h-4" /> נקה הכל
              </Button>
            </div>

            {errors.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                <ul className="list-disc pr-4 space-y-0.5">
                  {errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {tooLarge.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                <p className="font-semibold mb-1">חלקים שאינם נכנסים לאף לוח</p>
                <ul className="list-disc pr-4 space-y-0.5">
                  {tooLarge.map((t) => (
                    <li key={t.id}>
                      {t.name} — {t.count} יח׳
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>

          {/* Results - reserves space for the fixed sidebar via margin-right on large screens */}
          <main className="lg:mr-[420px]">
            {result && result.ok ? (
              <ResultsPanel result={result} parts={input.parts} showLabels={showLabels} showCuts={showCuts} />
            ) : (
              <div className="cutlist-no-print text-center py-20 text-slate-400 text-sm border border-dashed border-slate-300 rounded-xl">
                מלא את הלוחות והחלקים מימין ולחץ "חשב" כדי לראות את פריסת החיתוך
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
