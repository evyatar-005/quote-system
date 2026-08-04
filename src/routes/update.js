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

const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '../..');
const CHANGELOG_PATH = path.join(REPO_ROOT, 'deploy', 'changelog-he.json');
// Matches $logDir in deploy/UPDATE.ps1: a sibling of the repo, not a subfolder,
// so a clean reinstall of REPO_ROOT can't take the deploy history down with it.
const LOG_DIR = path.join(REPO_ROOT, '..', 'quote-system-logs');

// One short Hebrew line per tag (deploy/changelog-he.json) — the admin UI
// otherwise showed raw `git log --oneline` subjects, which are written in
// English and reference file paths/internals no one outside the session that
// wrote them would recognize. Missing/unparsable file → empty map, so an
// un-annotated tag just falls back to its own name instead of breaking the
// update-check endpoint.
function loadChangelog() {
  try {
    return JSON.parse(fs.readFileSync(CHANGELOG_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}

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

      // One line per TAG rather than per commit: a tag is a released version
      // someone can reason about ("v1.0.21 changes login"), a commit is an
      // implementation detail. version:refname sorts by semver, not string
      // order, so v1.0.9 correctly sorts before v1.0.10.
      let commits = [];
      if (updateAvailable && currentTag) {
        const changelog = loadChangelog();
        const allTags = await git('tag --sort=version:refname').then(out => out ? out.split('\n') : []);
        const afterCurrent = allTags.slice(allTags.indexOf(currentTag) + 1);
        const latestIdx = afterCurrent.indexOf(latestTag);
        // -1 would mean latestTag itself didn't sort where expected (an odd
        // tag name); fall back to showing everything after currentTag rather
        // than silently reporting zero pending changes.
        const upToLatest = latestIdx === -1 ? afterCurrent : afterCurrent.slice(0, latestIdx + 1);
        commits = upToLatest.map(tag => changelog[tag] ? `${tag} — ${changelog[tag]}` : tag);
      }

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

  // ── GET /api/admin/update-log ────────────────────────────────────────────
  // Surfaces the most recent deploy/UPDATE.ps1 transcript in the browser.
  // Before this existed, diagnosing a failed deploy meant RDP + PowerShell —
  // a real barrier for anyone not comfortable there, and the exact thing that
  // made the port-collision and dirty-checkout incidents slow to pin down.
  // Returns the tail only: these transcripts include full npm install/build
  // output and can run to thousands of lines.
  const LOG_TAIL_LINES = 400;
  app.get('/api/admin/update-log', requireAdmin, (req, res) => {
    let files;
    try {
      files = fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('update-') && f.endsWith('.log'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    } catch (err) {
      return res.status(404).json({ error: `אין תיקיית לוגים (${LOG_DIR}) — עדיין לא בוצעה אף פריסה בגרסה שתומכת בכך` });
    }
    if (!files.length) return res.status(404).json({ error: 'לא נמצאו לוגים של פריסה' });

    const latest = files[0];
    const fullText = fs.readFileSync(path.join(LOG_DIR, latest.name), 'utf8');
    const allLines = fullText.split(/\r?\n/);
    const tail = allLines.slice(-LOG_TAIL_LINES);
    res.json({
      file: latest.name,
      modifiedAt: new Date(latest.mtime).toISOString(),
      totalLines: allLines.length,
      truncated: allLines.length > LOG_TAIL_LINES,
      lines: tail,
    });
  });
};
