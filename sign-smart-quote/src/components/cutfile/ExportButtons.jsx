// Step 7 — "קו חיתוך מוכן". Each button downloads the current cut path in a
// different format; the export route is auth-gated, so this can't be a plain
// <a href> download link — see base44.cutfile.downloadExport.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Download } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

const FORMATS = [
  { format: 'svg', label: 'SVG' },
  { format: 'dxf', label: 'DXF' },
  { format: 'pdf', label: 'PDF (CutContour)' },
];

export default function ExportButtons({ jobId, params, disabled }) {
  const [pending, setPending] = useState(null);

  const handleExport = async (format) => {
    setPending(format);
    try {
      const blob = await base44.cutfile.downloadExport(jobId, format, params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cutfile-${jobId}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error(err.message || `ייצוא ${format.toUpperCase()} נכשל`);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {FORMATS.map(({ format, label }) => (
        <Button
          key={format}
          variant="outline"
          disabled={disabled || pending !== null}
          onClick={() => handleExport(format)}
          className="gap-2 rounded-xl"
        >
          {pending === format ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {label}
        </Button>
      ))}
    </div>
  );
}
