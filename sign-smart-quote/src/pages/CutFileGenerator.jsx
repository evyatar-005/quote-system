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
  // Physical, blade-oriented defaults — a production cut file is a simplified
  // outline with a bleed, not a pixel-faithful trace.
  simplifyMm: 1.5,
  offsetMm: 1,
  minAreaMm2: 25,
  outerOnly: true,
  widthCm: 20,
  threshold: 'auto',
  removeWhite: true,
  holeMode: 'protect',
  // Advanced / pixel-level.
  cleanupRadius: 2,
  speckleArea: 300,
  blurSigma: 0,
  turdSize: 2,
  alphaMax: 1,
  smoothing: 1,
};

const TRACE_DEBOUNCE_MS = 300;

export default function CutFileGenerator() {
  const [jobId, setJobId] = useState(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [traceResult, setTraceResult] = useState(null);
  const [tracing, setTracing] = useState(false);
  const [traceError, setTraceError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState(null);

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
    setUploadError(null);
  }, []);

  const handleFile = async (file) => {
    if (!file) return;
    reset();
    setUploading(true);
    // A 0-byte File almost always means a cloud placeholder (OneDrive/Drive
    // "online-only" file) that was never downloaded locally — the browser
    // hands over an empty File rather than failing, so catch it here and say
    // so, instead of sending an empty multipart body the server can't explain.
    if (file.size === 0) {
      const msg = `הקובץ "${file.name}" ריק (0 בייט). אם הוא מ-OneDrive/Google Drive — יש להוריד אותו למחשב לפני ההעלאה.`;
      setUploadError(msg);
      toast.error(msg);
      setUploading(false);
      return;
    }
    try {
      const { jobId: newJobId, pdfPageCount } = await base44.cutfile.upload(file);
      setJobId(newJobId);
      // Only the first page becomes a cut file — say so rather than silently
      // dropping the rest of a multi-page PDF.
      if (pdfPageCount > 1) {
        toast.warning(`ה-PDF מכיל ${pdfPageCount} עמודים — נוצר קו חיתוך לעמוד הראשון בלבד.`);
      }
      const blob = await base44.cutfile.fetchSourceBlob(newJobId);
      const url = URL.createObjectURL(blob);
      sourceUrlRef.current = url;
      setSourceUrl(url);
    } catch (err) {
      const msg = err.message || 'העלאת התמונה נכשלה';
      setUploadError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  // Drag & drop. The dropzone advertises "גררו תמונה לכאן", so it has to
  // actually accept a drop — a bare <label>+<input type=file> does not, the
  // browser just navigates away to the dropped file instead. dragenter/over
  // must both preventDefault or the drop event never fires at all.
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragging) setDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Ignore leave events fired when moving over a child element.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
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
              <>
                <label
                  onDragEnter={handleDragOver}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`flex flex-col items-center justify-center gap-2 h-64 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                    dragging
                      ? 'border-amber-500 bg-amber-50'
                      : 'border-slate-300 hover:border-amber-400 hover:bg-amber-50/40'
                  }`}
                >
                  <Upload className={`w-8 h-8 ${dragging ? 'text-amber-600' : 'text-slate-400'}`} />
                  <span className="text-sm text-slate-500">
                    {uploading ? 'מעלה...' : dragging ? 'שחררו כדי להעלות' : 'גררו תמונה לכאן או לחצו לבחירה'}
                  </span>
                  <span className="text-xs text-slate-400">PDF · PNG · JPG · WEBP · GIF · BMP · TIFF · AVIF · HEIC</span>
                  <input
                    type="file"
                    accept="image/*,application/pdf,.pdf"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => handleFile(e.target.files?.[0])}
                  />
                </label>
                {uploadError && (
                  <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {uploadError}
                  </div>
                )}
              </>
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
                      {traceResult.shapes > 0 && ` · ${traceResult.shapes} ${traceResult.shapes === 1 ? 'צורה' : 'צורות'}`}
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
              <TraceControls params={params} onChange={setParams} measuredWhiteCut={traceResult?.whiteCut} />
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
