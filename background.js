// background.js (MV3, module)
// Handles window positioning/resizing via chrome.commands.

async function getFocusedWindow() {
  // Use getLastFocused to avoid issues with service worker context
  const win = await chrome.windows.getLastFocused({ populate: false, windowTypes: ["normal"] });
  // Ensure we can resize/move (clear maximized/fullscreen states first)
  if (win.state === "maximized" || win.state === "fullscreen" || win.state === "docked") {
    await chrome.windows.update(win.id, { state: "normal" });
    // Re-query to get updated bounds after state change
    return await chrome.windows.get(win.id);
  }
  return win;
}

async function getDisplays() {
  const displays = await chrome.system.display.getInfo();
  return displays;
}

function rectIntersectArea(a, b) {
  const xOverlap = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const yOverlap = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return xOverlap * yOverlap;
}

function pickDisplayForWindow(win, displays) {
  // Prefer the display with the greatest intersection with the window
  const winRect = {
    left: win.left ?? 0,
    top: win.top ?? 0,
    width: win.width ?? 0,
    height: win.height ?? 0
  };

  let best = null;
  let bestArea = -1;
  for (const d of displays) {
    const wa = d.workArea; // {left, top, width, height}
    const area = rectIntersectArea(winRect, wa);
    if (area > bestArea) {
      bestArea = area;
      best = d;
    }
  }
  // Fallback to primary if we had no overlap (e.g., offscreen)
  return best ?? displays.find(d => d.isPrimary) ?? displays[0];
}

function clampToWorkArea(bounds, workArea) {
  // Ensure the window ends up fully within the work area
  const b = { ...bounds };
  const minWidth = Math.min(b.width, workArea.width);
  const minHeight = Math.min(b.height, workArea.height);
  b.width = Math.max(100, Math.floor(minWidth));
  b.height = Math.max(100, Math.floor(minHeight));
  b.left = Math.floor(Math.min(Math.max(workArea.left, b.left), workArea.left + workArea.width - b.width));
  b.top  = Math.floor(Math.min(Math.max(workArea.top,  b.top),  workArea.top  + workArea.height - b.height));
  return b;
}

function centeredBounds(current, workArea) {
  // Keep current size, just center it on the chosen display
  const width = Math.min(current.width ?? workArea.width, workArea.width);
  const height = Math.min(current.height ?? workArea.height, workArea.height);
  const left = workArea.left + Math.round((workArea.width  - width)  / 2);
  const top  = workArea.top  + Math.round((workArea.height - height) / 2);
  return clampToWorkArea({ left, top, width, height }, workArea);
}

function centeredPercentBounds(percent, workArea) {
  const width = Math.round(workArea.width * percent);
  const height = Math.round(workArea.height * percent);
  const left = workArea.left + Math.round((workArea.width  - width)  / 2);
  const top  = workArea.top  + Math.round((workArea.height - height) / 2);
  return clampToWorkArea({ left, top, width, height }, workArea);
}

function quadrantBounds(which, workArea) {
  // which: "tl" | "tr" | "br" | "bl"
  const halfW = Math.floor(workArea.width / 2);
  const halfH = Math.floor(workArea.height / 2);
  const width = halfW;
  const height = halfH;

  const positions = {
    tl: { left: workArea.left,              top: workArea.top },
    tr: { left: workArea.left + halfW,      top: workArea.top },
    br: { left: workArea.left + halfW,      top: workArea.top + halfH },
    bl: { left: workArea.left,              top: workArea.top + halfH }
  };
  const { left, top } = positions[which];
  return clampToWorkArea({ left, top, width, height }, workArea);
}

async function moveWindow(toBounds) {
  const win = await getFocusedWindow();
  if (!win || !win.id) return;

  const displays = await getDisplays();
  const display = pickDisplayForWindow(win, displays);
  const workArea = display.workArea;

  const finalBounds = toBounds(win, workArea);
  await chrome.windows.update(win.id, {
    left: finalBounds.left,
    top: finalBounds.top,
    width: finalBounds.width,
    height: finalBounds.height,
    state: "normal",
    drawAttention: false
  });
}

chrome.commands.onCommand.addListener(async (command) => {
  try {
    switch (command) {
      case "center-window":
        await moveWindow((win, wa) => centeredBounds(win, wa));
        break;

      case "center-75":
        await moveWindow((_win, wa) => centeredPercentBounds(0.75, wa));
        break;

      case "top-left-50":
        await moveWindow((_win, wa) => quadrantBounds("tl", wa));
        break;

      case "top-right-50":
        await moveWindow((_win, wa) => quadrantBounds("tr", wa));
        break;

      case "bottom-right-50":
        await moveWindow((_win, wa) => quadrantBounds("br", wa));
        break;

      case "bottom-left-50":
        await moveWindow((_win, wa) => quadrantBounds("bl", wa));
        break;

      default:
        // Unknown command (shouldn't happen)
        break;
    }
  } catch (err) {
    // Swallow errors to avoid crashing the service worker; log for debugging
    console.error("[Window Manager] Error handling command:", command, err);
  }
});
