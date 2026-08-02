// Version check + self-update trigger — admin only.
//
// "Check for updates" runs `git fetch --tags` and compares the current
// checked-out commit/tag against the newest tag on origin. "Run update"
// spawns the existing deploy/UPDATE.ps1 (the same script an admin would
// otherwise run manually over RDP) as a detached process, so it survives
// this Node process being stopped mid-request when the script restarts
// the Scheduled Task. Both endpoints fail cleanly (400, no crash) if git
// isn't reachable — expected until GitHub push + server-side git
// credentials are set up (see plan notes / CLAUDE.md).

const path = require('path');
const { exec, spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '../..');

// Every git call goes through -c safe.directory=*. In production Node runs as
// SYSTEM under the QuoteSystemServer task while the checkout is owned by the
// Administrator who cloned it, and git refuses to operate on a repo owned by
// someone else ("detected dubious ownership"). That protection is aimed at
// shared/multi-user machines; here both identities are the same operator on a
// single-purpose box, and without this the update endpoint fails only when
// triggered from the UI — never when run by hand, which is the worst possible
// way for it to fail.
function git(args) {
  return run(`git -c safe.directory=* ${args}`);
}

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: REPO_ROOT, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || stdout.trim() || err.message));
      resolve(stdout.trim());
    });
  });
}

let updateInProgress = false;

module.exports = function registerUpdate(app, db, deps) {
  const { requireAdmin } = deps;

  app.get('/api/admin/check-update', requireAdmin, async (req, res) => {
    try {
      await git('fetch --tags');
      const currentTag = await git('describe --tags').catch(() => null);
      const currentCommit = await git('rev-parse --short HEAD');
      const latestTag = await git('tag --sort=-v:refname').then(out => out.split('\n')[0] || null);

      if (!latestTag) {
        return res.json({ currentTag, currentCommit, latestTag: null, updateAvailable: false, commits: [] });
      }

      const latestCommit = await git(`rev-list -n 1 ${latestTag}`).then(c => c.slice(0, 7));
      const updateAvailable = latestTag !== currentTag;
      const commits = updateAvailable && currentTag
        ? await git(`log ${currentTag}..${latestTag} --oneline`).then(out => out ? out.split('\n') : [])
        : [];

      res.json({ currentTag, currentCommit, latestTag, latestCommit, updateAvailable, commits });
    } catch (err) {
      res.status(400).json({ error: `לא ניתן לבדוק עדכונים: ${err.message}` });
    }
  });

  app.post('/api/admin/update', requireAdmin, async (req, res) => {
    if (updateInProgress) {
      return res.status(409).json({ error: 'עדכון כבר רץ כרגע' });
    }

    // A dirty tree used to abort the update, back when UPDATE.ps1 would have
    // hit "local changes would be overwritten" at checkout. It now resets
    // --hard first, and `npm install` rewrites package-lock.json on every
    // deploy — so a dirty tree is the normal steady state here, and refusing on
    // it blocked every update permanently rather than preventing anything.
    // Still worth recording what got discarded, so an intentional hand-edit on
    // the server doesn't vanish without a trace.
    try {
      const dirty = await git('status --porcelain');
      if (dirty) {
        console.log(`[POST /api/admin/update] discarding local changes:\n${dirty}`);
      }
    } catch (err) {
      return res.status(400).json({ error: `בדיקת מצב git נכשלה: ${err.message}` });
    }

    const scriptPath = path.join(REPO_ROOT, 'deploy', 'UPDATE.ps1');
    updateInProgress = true;
    console.log(`[POST /api/admin/update] triggered by "${req.user.username}" at ${new Date().toISOString()}`);

    // Runs with no console window and no profile: this is triggered from the
    // web UI, so a PowerShell window flashing up on the server console (where
    // nobody is watching) is noise at best. -NonInteractive makes the script
    // fail fast instead of hanging forever on an unexpected prompt, since
    // there is no one at the machine to answer it.
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        cwd: REPO_ROOT,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }
    );
    child.unref();
    // 'exit' never fires for an unref'd detached child that outlives us — and
    // this process is deliberately killed mid-update when the script restarts
    // the Scheduled Task. Without a timer the flag would latch on forever after
    // a failed update and block every retry until someone restarts the server.
    child.on('exit', () => { updateInProgress = false; });
    setTimeout(() => { updateInProgress = false; }, 10 * 60 * 1000).unref();

    res.json({ started: true });
  });
};
