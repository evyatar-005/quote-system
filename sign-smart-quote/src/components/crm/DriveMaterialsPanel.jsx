import { useState, useEffect, useCallback } from "react";
import { Loader2, FolderOpen, File, ArrowRight, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { drive } from "@/api/driveClient";
import { leadQueue } from "@/api/leadQueueClient";
import { toast } from "sonner";

// CRM Phase 5 §7/§8 — the Drive-connected marketing-materials folder, with
// one-click WhatsApp send. The customer always receives an actual file
// (sendMediaUpload via the outbox), never a link — see CLAUDE.md.
export default function DriveMaterialsPanel({ leadId }) {
  const [stack, setStack] = useState([undefined]); // undefined = root
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState(null);
  const folderId = stack[stack.length - 1];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFiles(await drive.listFiles(folderId));
    } catch (err) {
      toast.error(err.message || "טעינת הקבצים נכשלה");
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => { load(); }, [load]);

  const openFolder = (id) => setStack((s) => [...s, id]);
  const goBack = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  const sendFile = async (file) => {
    setSendingId(file.id);
    try {
      await leadQueue.sendDriveFile(leadId, file.id, file.name);
      toast.success(`${file.name} נשלח ללקוח`);
    } catch (err) {
      toast.error(err.message || "השליחה נכשלה");
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="border border-black rounded-xl bg-white flex flex-col min-h-[65vh]">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
        {stack.length > 1 && (
          <button onClick={goBack} className="text-slate-400 hover:text-primary">
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
        <span className="font-semibold text-sm">חומרי שיווק</span>
        <button onClick={load} className="text-slate-400 hover:text-primary mr-auto" title="רענן">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : files.length === 0 ? (
          <div className="text-center py-10 text-xs text-slate-400">התיקייה ריקה</div>
        ) : (
          files.map((f) =>
            f.isFolder ? (
              <button
                key={f.id}
                onClick={() => openFolder(f.id)}
                className="w-full text-right flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-sm"
              >
                <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="truncate">{f.name}</span>
              </button>
            ) : (
              <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50">
                <File className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="truncate text-sm flex-1">{f.name}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px] gap-1 shrink-0"
                  disabled={sendingId === f.id}
                  onClick={() => sendFile(f)}
                >
                  {sendingId === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  שלח
                </Button>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}
