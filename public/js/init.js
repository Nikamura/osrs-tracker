// Apply initial states immediately to prevent flashing
(function() {
  try {
    function storedStringArray(key) {
      const saved = localStorage.getItem(key);
      if (!saved) return null;
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string') : null;
      } catch {
        return null;
      }
    }

    function storedObject(key) {
      const saved = localStorage.getItem(key);
      if (!saved) return null;
      try {
        const parsed = JSON.parse(saved);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }

    // Apply window visibility immediately
    let selectedWindows = storedStringArray('osrs-selected-windows');
    if (selectedWindows) {
      const storedCatalogVersion = Number(localStorage.getItem('osrs-window-catalog-version'));
      const seenCatalogVersion = Number.isInteger(storedCatalogVersion) && storedCatalogVersion >= 1
        ? storedCatalogVersion
        : 1;
      const configuredCatalogVersion = Number(document.body.dataset.windowCatalogVersion);
      const currentCatalogVersion = Number.isInteger(configuredCatalogVersion) && configuredCatalogVersion >= 1
        ? configuredCatalogVersion
        : 1;
      if (seenCatalogVersion < 3 && currentCatalogVersion >= 3) {
        selectedWindows = selectedWindows.filter(windowId =>
          windowId !== 'sailing-progress' && windowId !== 'sea-charting-explorer'
        );
        localStorage.setItem('osrs-selected-windows', JSON.stringify(selectedWindows));
      }
      const allWindows = document.querySelectorAll('.window[data-window-id]');
      allWindows.forEach(function(windowElement) {
        const windowId = windowElement.dataset.windowId;
        const introducedVersion = Number(windowElement.dataset.introducedVersion || 1);
        if (selectedWindows.indexOf(windowId) === -1 && introducedVersion <= seenCatalogVersion) {
          windowElement.classList.add('hidden');
        }
      });
    } else {
      const defaultWindows = Array.from(
        document.querySelectorAll('input[type="checkbox"][id^="window-"]:checked')
      ).map(function(checkbox) {
        return checkbox.value;
      });
      document.querySelectorAll('.window[data-window-id]').forEach(function(windowElement) {
        if (defaultWindows.indexOf(windowElement.dataset.windowId) === -1) {
          windowElement.classList.add('hidden');
        }
      });
    }

    // Apply minimized states immediately
    const savedStates = storedObject('osrs-minimized-windows') || {};
    document.querySelectorAll('.window').forEach(function(windowElement) {
      const titleText = windowElement.querySelector('.title-bar-text');
      if (titleText) {
        const windowId = titleText.textContent.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        if (savedStates[windowId]) {
          windowElement.classList.add('minimized');
        }

        const windowBody = windowElement.querySelector('.window-body');
        const minimizeButton = windowElement.querySelector('.title-bar-controls button[onclick^="toggleWindow"]');
        if (windowBody && minimizeButton) {
          const bodyId = 'window-body-' + windowId;
          const isMinimized = windowElement.classList.contains('minimized');
          windowBody.id = bodyId;
          minimizeButton.setAttribute('aria-controls', bodyId);
          minimizeButton.setAttribute('aria-expanded', String(!isMinimized));
          minimizeButton.setAttribute('aria-label', isMinimized ? 'Restore' : 'Minimize');
          minimizeButton.setAttribute('title', (isMinimized ? 'Restore ' : 'Minimize ') + titleText.textContent.trim());
        }
      }
    });
  } catch (e) {
    // If localStorage fails, continue normally
    console.warn('Failed to apply initial states:', e);
  }
})();
