import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Info, RefreshCw, Rocket } from "lucide-react";
import { toast } from "sonner";
import { getVersion, checkForUpdate, triggerUpdate } from "@/api/systemClient";
import CostSectionCard from "./CostSectionCard";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

export default function AboutSection() {
  const [version, setVersion] = useState(null);
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateError, setUpdateError] = useState("");
  const [updating, setUpdating] = useState(false);
  const pollRef = useRef(null);

  const loadVersion = async () => {
    try {
      setVersion(await getVersion());
    } catch {
      // /api/version has no auth requirement — a failure here means the
      // server itself is unreachable, which is exactly the "still restarting" state.
    }
  };

  useEffect(() => {
    loadVersion();
    return () => clearInterval(pollRef.current);
  }, []);

  const handleCheck = async () => {
    setChecking(true);
    setUpdateError("");
    try {
      setUpdateInfo(await checkForUpdate());
    } catch (err) {
      setUpdateInfo(null);
      setUpdateError(err?.message || "שגיאה בבדיקת עדכונים");
    }
    setChecking(false);
  };

  const handleUpdate = async () => {
    const commitBefore = version?.commit;
    setUpdating(true);
    setUpdateError("");
    try {
      await triggerUpdate();
      toast.info("העדכון הופעל — השרת עשוי להיות לא זמין למספר דקות");
    } catch (err) {
      setUpdating(false);
      toast.error(err?.message || "שגיאה בהפעלת העדכון");
      return;
    }

    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(pollRef.current);
        setUpdating(false);
        toast.warning("העדכון לוקח יותר מהצפוי — בדוק ידנית בשרת");
        return;
      }
      try {
        const v = await getVersion();
        if (v?.commit && v.commit !== commitBefore) {
          clearInterval(pollRef.current);
          setUpdating(false);
          setVersion(v);
          setUpdateInfo(null);
          toast.success(`העדכון הסתיים — גרסה ${v.version} רצה כעת`);
        }
      } catch {
        // server mid-restart — expected, keep polling
      }
    }, POLL_INTERVAL_MS);
  };

  return (
    <CostSectionCard
      icon={<Info className="w-5 h-5" />}
      title="אודות המערכת"
      description="גרסת השרת הרצה, בדיקת עדכונים, והפעלת עדכון"
      defaultOpen
    >
      <div className="space-y-1.5 text-sm">
        <p><span className="text-slate-500">גרסה: </span><span className="font-semibold">{version?.version || "—"}</span></p>
        <p><span className="text-slate-500">Commit: </span><span className="font-mono">{version?.commit || "—"}</span></p>
        <p><span className="text-slate-500">פריסה אחרונה: </span>{version?.deployedAt ? new Date(version.deployedAt).toLocaleString("he-IL") : "—"}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button variant="outline" onClick={handleCheck} disabled={checking || updating} className="gap-2">
          {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          בדוק עדכונים
        </Button>
        <Button onClick={handleUpdate} disabled={updating || checking} className="gap-2">
          {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
          {updating ? "מתבצע עדכון..." : "עדכן עכשיו"}
        </Button>
      </div>

      {updateError && <p className="text-sm text-destructive">{updateError}</p>}

      {updateInfo && (
        <div className="text-sm space-y-1.5 border-t border-border pt-3">
          {updateInfo.updateAvailable ? (
            <>
              <Badge>יש עדכון: {updateInfo.latestTag}</Badge>
              {updateInfo.commits?.length > 0 && (
                <ul className="list-disc pr-5 text-slate-600 mt-1">
                  {updateInfo.commits.map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
            </>
          ) : (
            <Badge variant="secondary">אתה על הגרסה העדכנית ({updateInfo.currentTag || updateInfo.currentCommit})</Badge>
          )}
        </div>
      )}
    </CostSectionCard>
  );
}
