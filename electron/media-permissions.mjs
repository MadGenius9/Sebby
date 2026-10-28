/** Audio is the sole exception to default-deny browser permissions.
 * A false check forces Electron through the explicit single-use request gate.
 * Native Chromium behavior must be verified before release. */
export function mediaPermissionPolicy({
  getWindow,
  getVoice,
  appURL,
  isClosing = () => false,
}) {
  return {
    check: () => false,
    request: (contents, permission, callback, details = {}) => {
      let allowed = false;
      try {
        const window = getWindow();
        if (
          !isClosing() &&
          window &&
          !window.isDestroyed() &&
          contents === window.webContents &&
          contents.getURL() === appURL &&
          permission === "media" &&
          details.isMainFrame === true &&
          details.requestingUrl === appURL &&
          Array.isArray(details.mediaTypes) &&
          details.mediaTypes.length === 1 &&
          details.mediaTypes[0] === "audio"
        ) {
          allowed =
            getVoice()?.consumePermission({
              windowId: contents.id,
              audioOnly: true,
            }) === true;
        }
      } catch {
        allowed = false;
      }
      callback(allowed);
    },
  };
}
