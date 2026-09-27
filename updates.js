// Update state belongs to the main process, so closing the dialog never
// interrupts a download. Only an explicit menu action opens the dialog.
function createUpdates({ updater, currentVersion, fetchRelease, onState, onError }) {
  let state = { status: 'idle', currentVersion, canInstall: !!updater };
  let operation = null;
  const setState = (next) => {
    state = { ...state, error: null, ...next };
    onState({ ...state });
  };
  const fail = (err) => {
    onError(err);
    const action = state.status === 'downloading' ? 'download the update'
      : state.status === 'restarting' ? 'install the update' : 'check for updates';
    setState({ status: 'error', error: `Couldn't ${action}. Try again or download the release from GitHub.` });
  };

  if (updater) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.logger = null;
    updater.on('error', fail);
    updater.on('update-available', (info) => setState({ status: 'available', latestVersion: info.version }));
    updater.on('update-not-available', () => setState({ status: 'current' }));
    updater.on('download-progress', (info) => {
      setState({ status: 'downloading', percent: Math.max(0, Math.min(100, info.percent || 0)) });
    });
    updater.on('update-downloaded', (info) => setState({ status: 'downloaded', latestVersion: info.version, percent: 100 }));
  }

  // Coalesce menu clicks and the startup check into one operation.
  const run = async (status, task) => {
    if (operation) return { ...state };
    setState({ status });
    operation = Promise.resolve().then(task);
    try { await operation; } catch (err) { if (state.status !== 'error') fail(err); }
    finally { operation = null; }
    return { ...state };
  };

  return {
    getState: () => ({ ...state }),
    check() {
      if (operation || ['downloading', 'downloaded', 'restarting'].includes(state.status)) return Promise.resolve({ ...state });
      return run('checking', async () => {
        if (updater) {
          const result = await updater.checkForUpdates();
          if (!result) throw new Error('Update checking is unavailable in this build');
        } else {
          const latestVersion = await fetchRelease();
          const latest = latestVersion.split('.').map(Number);
          const current = currentVersion.split('.').map(Number);
          let newer = false;
          for (let i = 0; i < Math.max(latest.length, current.length); i++) {
            if ((latest[i] || 0) !== (current[i] || 0)) {
              newer = (latest[i] || 0) > (current[i] || 0);
              break;
            }
          }
          setState({ status: newer ? 'available' : 'current', latestVersion });
        }
      });
    },
    download() {
      if (!updater || state.status !== 'available' || operation) return Promise.resolve({ ...state });
      return run('downloading', () => updater.downloadUpdate());
    },
    install() {
      if (!updater || state.status !== 'downloaded' || operation) return { ...state };
      setState({ status: 'restarting' });
      try { updater.quitAndInstall(false, true); } catch (err) { fail(err); }
      return { ...state };
    }
  };
}

module.exports = { createUpdates };
