import { useState, useEffect, useCallback } from "react";
import { Loader2, FolderOpen, File, ArrowRight, RefreshCw, Send, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { drive, quickLinks } from "@/api/driveClient";
import { leadQueue } from "@/api/leadQueueClient";
import { toast } from "sonner";

// CRM Phase 5 §7/§8 — the Drive-connected marketing-materials folder, with
// one-click WhatsApp send.
//
// Files are still sent as real attachments (sendMediaUpload via the outbox).
// Folders send their Drive link instead: a folder is a set, so one browsable
// link beats six separate attachments — and on InforU it's the only thing that
// works at all for anything but an image, since their chat API carries
// images/voice only and rejects a PDF outright.
//
// Quick links (Instagram, website, catalog, ...) live in the same panel —
// admin-managed in AdminDashboard's "crm" tab (QuickLinksSection) — since
// from an agent's chair both are just "marketing material, one click to
// WhatsApp", regardless of whether the content is a Drive file or a link.
export default function DriveMaterialsPanel({ leadId }) {
  const [stack, setStack] = useState([undefined]); // undefined = root
  const [files, setFiles] = useState([]);
  const [links, setLinks] = useState([]);
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
  useEffect(() => { quickLinks.list().then(setLinks).catch(() => {}); }, []);

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

  // Sends the folder's own Drive link as a message, instead of pushing files
  // one at a time. Two reasons this is the better default:
  //
  //  - InforU's chat API carries images and voice only — a PDF comes back
  //    "Invalid Media Format" no matter how it's sent (their documented limit,
  //    not ours). A link works for every file type.
  //  - A folder is usually a set — "פולטי אור מעוצבים" is a catalogue, not one
  //    picture. Sending six separate attachments to say that is worse for the
  //    customer than one link they can browse.
  //
  // Goes through sendQuickLink, which is just "send this text", so nothing new
  // is needed server-side. The folder must be inside the shared root, which the
  // whole materials folder already is.
  const sendFolder = async (folder) => {
    setSendingId(`folder-${folder.id}`);
    try {
      const url = `https://drive.google.com/drive/folders/${folder.id}`;
      await leadQueue.sendQuickLink(leadId, `${folder.name}\n${url}`);
      toast.success(`הקישור ל"${folder.name}" נשלח ללקוח`);
    } catch (err) {
      toast.error(err.message || "השליחה נכשלה");
    } finally {
      setSendingId(null);
    }
  };

  const sendLink = async (link) => {
    setSendingId(`link-${link.id}`);
    try {
      await leadQueue.sendQuickLink(leadId, link.content);
      toast.success(`${link.label} נשלח ללקוח`);
    } catch (err) {
      toast.error(err.message || "השליחה נכשלה");
    } finally {
      setSendingId(null);
    }
  };

  return (
    // Short floor, not 65vh: below xl this panel wraps onto its own row under
    // the workspace grid, where a screen-tall box of (usually) a handful of
    // files was mostly empty space. h-full still fills the cell when it sits as
    // the third column beside the conversation.
    <div className="border border-black rounded-xl bg-white flex flex-col h-full min-h-[200px]">
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
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2 pt-2">
          {links.map((l) => (
            <Button
              key={l.id}
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1"
              disabled={sendingId === `link-${l.id}`}
              onClick={() => sendLink(l)}
            >
              {sendingId === `link-${l.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
              {l.label}
            </Button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : files.length === 0 ? (
          <div className="text-center py-10 text-xs text-slate-400">התיקייה ריקה</div>
        ) : (
          files.map((f) =>
            f.isFolder ? (
              <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50">
                {/* The name still opens the folder — sending it is the new
                    action, not a replacement for browsing into it. */}
                <button
                  onClick={() => openFolder(f.id)}
                  className="text-right flex items-center gap-2 text-sm flex-1 min-w-0"
                >
                  <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="truncate">{f.name}</span>
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px] gap-1 shrink-0"
                  title="שולח ללקוח קישור לתיקייה כולה"
                  disabled={sendingId === `folder-${f.id}`}
                  onClick={() => sendFolder(f)}
                >
                  {sendingId === `folder-${f.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                  שלח קישור
                </Button>
              </div>
            ) : (
              <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50">
                {f.mimeType?.startsWith("image/") && f.thumbnailLink ? (
                  <img
                    src={f.thumbnailLink}
                    alt=""
                    className="w-7 h-7 rounded object-cover shrink-0 border border-slate-200"
                    // Thumbnail URLs are short-lived signed links straight from
                    // Drive — if one 404s/expires, fall back to the plain icon
                    // instead of a broken-image glyph.
                    onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.nextSibling.style.display = "block"; }}
                  />
                ) : null}
                <File className={`w-4 h-4 text-slate-400 shrink-0 ${f.mimeType?.startsWith("image/") && f.thumbnailLink ? "hidden" : ""}`} />
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
