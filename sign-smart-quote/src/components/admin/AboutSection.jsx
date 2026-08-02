import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Info, RefreshCw, Rocket } from "lucide-react";
import { toast } from "sonner";
import { getVersion, checkForUpdate, triggerUpdate } from "@/api/systemClient";
import CostSectionCard from "./CostSectionCard";
import UpdateProgressOverlay from "./UpdateProgressOverlay";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
// Time between "the new version answered" and reloading the page. The server
// answers /api/version before the built frontend assets are necessarily being
// served, and reloading into a half-swapped dist yields a blank page.
const RELOAD_DELAY_MS = 2500;

export default function AboutSection() {
  const [version, setVersion] = useState(null);
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateError, setUpdateError] = useState("");
  const [updating, setUpdating] = useState(false);
  const [phase, setPhase] = useState(null); // null | starting | running | done | failed
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
    // Check on open rather than waiting for a click. "Is there an update?" is
    // the only question this screen exists to answer, and a stale-looking
    // version number with no indication of whether it's current is worse than
    // no number at all.
    handleCheck();
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
    setPhase("starting");
    try {
      await triggerUpdate();
      setPhase("running");
    } catch (err) {
      // A rejected trigger (update already running, git unreachable) never
      // touches the server — distinct from a deploy we merely lost track of.
      setPhase("rejected");
      setUpdateError(err?.message || "שגיאה בהפעלת העדכון");
      setUpdating(false);
      return;
    }

    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(pollRef.current);
        setPhase("failed");
        setUpdateError("העדכון נמשך זמן רב מהצפוי ולא הצלחנו לאשר שהוא הסתיים.");
        setUpdating(false);
        return;
      }
      try {
        const v = await getVersion();
        if (v?.commit && v.commit !== commitBefore) {
          clearInterval(pollRef.current);
          setVersion(v);
          setUpdateInfo(null);
          setPhase("done");
          // Hard reload: the whole point is to pick up the newly built assets,
          // and a normal re-render would keep the old bundle in memory.
          setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
        }
      } catch {
        // server mid-restart — expected, keep polling
      }
    }, POLL_INTERVAL_MS);
  };

  return (
    <>
    {/* "starting" is skipped when the trigger returns instantly — the overlay
        only ever shows a phase the user can act on or wait through. */}
    {phase && (
      <UpdateProgressOverlay
        phase={phase}
        version={version}
        error={updateError}
        onClose={() => { setPhase(null); setUpdateError(""); }}
      />
    )}
    <CostSectionCard
      icon={<Info className="w-5 h-5" />}
      title="אודות המערכת"
      description="גרסת השרת הרצה, בדיקת עדכונים, והפעלת עדכון"
      defaultOpen
    >
      <div className="rounded-xl border-2 border-slate-200 bg-slate-50/60 p-4">
        <p className="text-xs text-slate-500">גרסה רצה כעת</p>
        <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
          {/* package.json, not VERSION.txt's tag. package.json ships inside the
              checkout, so it cannot disagree with the code that's running.
              VERSION.txt is written by the deploy script and has already been
              observed reporting v1.0.10 next to a v1.0.15 commit. */}
          <span className="text-2xl font-bold text-slate-900">
            {version?.version ? `v${version.version}` : "—"}
          </span>
          {checking ? (
            <Badge variant="secondary" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" /> בודק…</Badge>
          ) : updateInfo?.updateAvailable ? (
            <Badge className="bg-amber-500 hover:bg-amber-500">יש עדכון: {updateInfo.latestTag}</Badge>
          ) : updateInfo ? (
            <Badge variant="secondary">מעודכן</Badge>
          ) : null}
        </div>
        <div className="mt-3 space-y-1 text-sm">
          <p><span className="text-slate-500">Commit: </span><span className="font-mono">{version?.commit || "—"}</span></p>
          <p><span className="text-slate-500">פריסה אחרונה: </span>{version?.deployedAt ? new Date(version.deployedAt).toLocaleString("he-IL") : "—"}</p>
          {/* A tag that disagrees with the running code means the deploy didn't
              land where it thought it did — worth surfacing rather than
              quietly showing one of the two numbers and hoping. */}
          {version?.tag && version?.version && version.tag !== `v${version.version}` && (
            <p className="text-amber-700">
              תג הפריסה הרשום הוא <span className="font-mono">{version.tag}</span> ואינו תואם לקוד הרץ — ייתכן שפריסה קודמת לא הושלמה.
            </p>
          )}
        </div>
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

      {/* The badge above already says whether an update exists — all that's left
          worth showing is what's actually in it. */}
      {updateInfo?.updateAvailable && updateInfo.commits?.length > 0 && (
        <div className="text-sm border-t border-border pt-3">
          <p className="font-semibold text-slate-700 mb-1.5">מה כלול בעדכון:</p>
          <ul className="list-disc pr-5 text-slate-600 space-y-0.5">
            {updateInfo.commits.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}
    </CostSectionCard>
    </>
  );
}
