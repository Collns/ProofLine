import { log } from '../shared/log.js';
import { handleMessage } from './messages.js';

// MV3 service workers are non-persistent. Anything we register at the
// top level re-registers every time the worker spins up, which is the
// pattern Chrome expects. Don't store mutable state at module scope —
// use chrome.storage instead. Real signing handlers (PFL-044/047) will
// import handleMessage and dispatch from there.

log('background', 'service worker loaded');

chrome.runtime.onInstalled.addListener((details) => {
  log('background', 'onInstalled', details.reason);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const response = handleMessage(message, sender);
  sendResponse(response);
  // Return false: we responded synchronously above. If a future handler
  // needs an async reply, it should return true and call sendResponse later.
  return false;
});
