// Automated cut-file generator — replaces the graphic designer's manual
// 7-step Illustrator workflow (Embed → Image Trace → Expand → Smooth Line →
// compare & fix → Offset Path → done) with: upload a photo, adjust a few
// sliders while watching a live preview, download SVG/DXF/PDF.
//
// All the actual geometry (trace/offset/export) runs server-side — see
// src/routes/cutfile.js and src/cutfile/* — this page just uploads, debounces
// slider changes into /trace calls, and renders whatever comes back.

import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Upload, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LogoutButton from "@/components/LogoutButton";
import printellaLogo from "@/assets/printella-logo.png";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import TracePreview from "@/components/cutfile/TracePreview";
import TraceControls from "@/components/cutfile/TraceControls";
import ExportButtons from "@/components/cutfile/ExportButtons";

const DEFAULT_PARAMS = {
  threshold: 128,
  turdSize: 2,
  alphaMax: 1,
  smoothing: 1,
  offsetMm: 0,
  widthCm: 20,
  holeMode: 'protect',
};

const TRACE_DEBOUNCE_MS = 300;

export default function CutFileGenerator() {
  const [jobId, setJobId] = useState(null);
  const [hasAlpha, setHasAlpha] = useState(true);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [traceResult, setTraceResult] = useState(null);
  const [tracing, setTracing] = useState(false);
  const [traceError, setTraceError] = useState(null);

  const debounceRef = useRef(null);
  const sourceUrlRef = useRef(null);

  const reset = useCallback(() => {
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    sourceUrlRef.current = null;
    setJobId(null);
    setSourceUrl(null);
    setParams(DEFAULT_PARAMS);
    setTraceResult(null);
    setTraceError(null);
  }, []);

  const handleFile = async (file) => {
    if (!file) return;
    reset();
    setUploading(true);
    try {
      const { jobId: newJobId, hasAlpha: alpha } = await base44.cutfile.upload(file);
      setJobId(newJobId);
      setHasAlpha(alpha);
      const blob = await base44.cutfile.fetchSourceBlob(newJobId);
      const url = URL.createObjectURL(blob);
      sourceUrlRef.current = url;
      setSourceUrl(url);
    } catch (err) {
      toast.error(err.message || 'העלאת התמונה נכשלה');
    } finally {
      setUploading(false);
    }
  };

  // Re-trace on every param change, debounced — mirrors "בדיקת התמונה מול
  // הקו ותיקונים": the designer nudges a slider, the preview catches up.
  useEffect(() => {
    if (!jobId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setTracing(true);
      setTraceError(null);
      try {
        const result = await base44.cutfile.trace(jobId, params);
        setTraceResult(result);
      } catch (err) {
        setTraceResult(null);
        setTraceError(err.message || 'המעקב אחרי קו החיתוך נכשל');
      } finally {
        setTracing(false);
      }
    }, TRACE_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, params]);

  useEffect(() => () => {
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir="rtl">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={printellaLogo} alt="Printella" className="h-16 object-contain" />
            <h1 className="font-semibold text-lg">קו חיתוך אוטומטי</h1>
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

      <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-6 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>תצוגה מקדימה</CardTitle>
            {jobId && (
              <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5 text-slate-500">
                <RotateCcw className="w-3.5 h-3.5" /> תמונה חדשה
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {!jobId ? (
              <label className="flex flex-col items-center justify-center gap-2 h-64 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-amber-400 hover:bg-amber-50/40 transition-colors">
                <Upload className="w-8 h-8 text-slate-400" />
                <span className="text-sm text-slate-500">{uploading ? 'מעלה...' : 'גררו תמונה לכאן או לחצו לבחירה (PNG / JPG / WEBP)'}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
              </label>
            ) : (
              <div className="space-y-3">
                <TracePreview
                  sourceUrl={sourceUrl}
                  widthMm={traceResult?.widthMm}
                  heightMm={traceResult?.heightMm}
                  tracePathD={traceResult?.tracePathD}
                  cutPathD={traceResult?.cutPathD}
                  loading={tracing}
                />
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#22c55e] inline-block" /> קו מעוקב</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#ef4444] inline-block" /> קו חיתוך סופי</span>
                  {traceResult && (
                    <span>
                      {traceResult.widthMm?.toFixed(0)}×{traceResult.heightMm?.toFixed(0)} מ״מ
                      {traceResult.holes > 0 && ` · ${traceResult.holes} ${traceResult.holes === 1 ? 'חור' : 'חורים'}`}
                    </span>
                  )}
                </div>
                {traceError && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {traceError}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>פרמטרים</CardTitle>
            </CardHeader>
            <CardContent>
              <TraceControls params={params} onChange={setParams} hasAlpha={hasAlpha} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ייצוא</CardTitle>
            </CardHeader>
            <CardContent>
              <ExportButtons jobId={jobId} params={params} disabled={!jobId || !traceResult || tracing} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
