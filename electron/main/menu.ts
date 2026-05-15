/**
 * Native application menu.
 *
 * Hidden by default (``autoHideMenuBar: true`` on the BrowserWindow); Alt
 * reveals it. Keyboard shortcuts work regardless of visibility.
 */

import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";

export function buildMenu(_getWindow: () => BrowserWindow | null): Menu {
  // _getWindow is kept in the signature so future menu items (e.g.
  // sending IPC events to the focused window) can wire up without a
  // breaking change.
  void _getWindow;
  const isDev = !app.isPackaged;

  const editMenu: MenuItemConstructorOptions = {
    label: "&Edit",
    submenu: [
      { role: "undo", label: "Undo" },
      { role: "redo", label: "Redo" },
      { type: "separator" },
      { role: "cut", label: "Cut" },
      { role: "copy", label: "Copy" },
      { role: "paste", label: "Paste" },
      { role: "selectAll", label: "Select all" },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "&View",
    submenu: [
      { role: "reload", label: "Reload" },
      ...(isDev
        ? [
            { role: "forceReload" } as MenuItemConstructorOptions,
            { role: "toggleDevTools" } as MenuItemConstructorOptions,
          ]
        : []),
      { type: "separator" },
      { role: "resetZoom", label: "Zoom mặc định" },
      { role: "zoomIn", label: "Zoom in" },
      { role: "zoomOut", label: "Zoom out" },
      { type: "separator" },
      { role: "togglefullscreen", label: "Fullscreen" },
    ],
  };

  return Menu.buildFromTemplate([editMenu, viewMenu]);
}
