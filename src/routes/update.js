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
      await run('git fetch --tags');
      const currentTag = await run('git describe --tags').catch(() => null);
      const currentCommit = await run('git rev-parse --short HEAD');
      const latestTag = await run('git tag --sort=-v:refname').then(out => out.split('\n')[0] || null);

      if (!latestTag) {
        return res.json({ currentTag, currentCommit, latestTag: null, updateAvailable: false, commits: [] });
      }

      const latestCommit = await run(`git rev-list -n 1 ${latestTag}`).then(c => c.slice(0, 7));
      const updateAvailable = latestTag !== currentTag;
      const commits = updateAvailable && currentTag
        ? await run(`git log ${currentTag}..${latestTag} --oneline`).then(out => out ? out.split('\n') : [])
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

    let dirty;
    try {
      dirty = await run('git status --porcelain');
    } catch (err) {
      return res.status(400).json({ error: `בדיקת מצב git נכשלה: ${err.message}` });
    }
    if (dirty) {
      return res.status(400).json({ error: 'יש שינויים לא שמורים בעץ העבודה — העדכון בוטל למען הבטיחות' });
    }

    const scriptPath = path.join(REPO_ROOT, 'deploy', 'UPDATE.ps1');
    updateInProgress = true;
    console.log(`[POST /api/admin/update] triggered by "${req.user.username}" at ${new Date().toISOString()}`);

    const child = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    child.on('exit', () => { updateInProgress = false; });

    res.json({ started: true });
  });
};
