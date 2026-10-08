'use strict';
// Runs liveStatus() off the main thread: reading the (big) Promethee DB with sql.js takes
// ~0.5s, which would otherwise freeze the main process (drag, foreground, tray).
const { parentPort } = require('worker_threads');
const { liveStatus } = require('./live');
parentPort.on('message', async ({ id, paths }) => {
  try { parentPort.postMessage({ id, ok: true, result: await liveStatus(paths) }); }
  catch (e) { parentPort.postMessage({ id, ok: false, error: e.message }); }
});
