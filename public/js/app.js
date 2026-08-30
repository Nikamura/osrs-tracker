// Store original data for filtering
let originalChartData = null;
let originalTotalLevelChartData = null;
let originalTotalExpChartData = null;
let originalSkillLevelProgressData = null;
let originalSkillLevelChartData = null;
let questChart = null;
let totalLevelChart = null;
let totalExpChart = null;
let skillLevelChart = null;
let showOnlyMajorAchievements = false;
let sailingExplorerPlayer = null;
let sailingExplorerStatus = 'missing';
let sailingExplorerGroup = 'all';

const GENERAL_TRACKER_REBALANCE_VERSION = 3;
const SAILING_WINDOW_IDS = new Set(['sailing-progress', 'sea-charting-explorer']);

// Create player mapping objects from config
let displayToPlayer = {};
let playerToDisplay = {};

// Create player colors mapping from config
let playerColors = {};

// Chart colors for client-side use
let CHART_COLORS = [];

// Table data loaded from JSON
let tableData = null;

const TIER_ORDER = {
  'Easy (1 pt)': 1,
  'Medium (2 pts)': 2,
  'Hard (3 pts)': 3,
  'Elite (4 pts)': 4,
  'Master (5 pts)': 5,
  'Grandmaster (6 pts)': 6
};

async function loadAppData() {
  const v = document.body.dataset.version || '';
  const [chartResponse, configResponse, tableResponse] = await Promise.all([
    fetch('data/chart-data.json?v=' + v),
    fetch('data/player-config.json?v=' + v),
    fetch('data/table-data.json?v=' + v)
  ]);
  const failedResponse = [chartResponse, configResponse, tableResponse].find(response => !response.ok);
  if (failedResponse) {
    throw new Error(`Dashboard data request failed with HTTP ${failedResponse.status}`);
  }
  const chartData = await chartResponse.json();
  const configData = await configResponse.json();
  tableData = await tableResponse.json();

  originalChartData = chartData.questChart;
  originalTotalLevelChartData = chartData.totalLevelChart;
  originalTotalExpChartData = chartData.totalExpChart;
  originalSkillLevelProgressData = chartData.skillLevelProgress;
  originalSkillLevelChartData = chartData.skillLevelChart;

  displayToPlayer = configData.displayToPlayer;
  playerToDisplay = configData.playerToDisplay;
  playerColors = configData.playerColors;
  CHART_COLORS = configData.chartColors;
}

function computeRankings(items, valueKey) {
  const sorted = [...items].sort((a, b) => b[valueKey] - a[valueKey]);
  const rankings = {};
  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i - 1][valueKey] > sorted[i][valueKey]) {
      currentRank = i + 1;
    }
    rankings[sorted[i].player] = currentRank;
  }
  return rankings;
}

function getDisplayName(player) {
  return playerToDisplay[player] || player;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function safeWikiUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'oldschool.runescape.wiki') {
      return escapeHtml(url.href);
    }
  } catch {
    // Invalid or absent upstream URL.
  }
  return '#';
}

function safePlayerColor(player) {
  const configuredColor = playerColors[player];
  return /^#[0-9a-f]{6}$/i.test(configuredColor || '') ? configuredColor : '#008080';
}

function readStoredStringArray(key) {
  const saved = localStorage.getItem(key);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return null;
    return [...new Set(parsed.filter(value => typeof value === 'string'))];
  } catch {
    return null;
  }
}

function readStoredObject(key) {
  const saved = localStorage.getItem(key);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readWindowCatalogVersion() {
  const value = Number(localStorage.getItem('osrs-window-catalog-version'));
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

function getRankingClass(value, rank) {
  if (value > 0) {
    if (rank === 1) return ' rank-1st';
    if (rank === 2) return ' rank-2nd';
    if (rank === 3) return ' rank-3rd';
  }
  return '';
}

function applyRankingClasses(allCells, selectedItems, valueKey) {
  const rankings = computeRankings(selectedItems, valueKey);
  allCells.forEach(cell => {
    cell.classList.remove('rank-1st', 'rank-2nd', 'rank-3rd');
  });
  selectedItems.forEach(item => {
    if (item[valueKey] > 0) {
      const rank = rankings[item.player];
      if (rank === 1) item.cell.classList.add('rank-1st');
      else if (rank === 2) item.cell.classList.add('rank-2nd');
      else if (rank === 3) item.cell.classList.add('rank-3rd');
    }
  });
}

// Player filtering functions
function getSelectedPlayers() {
  const checkboxes = document.querySelectorAll('input[type="checkbox"][id^="player-"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

// Time period filtering functions
function getSelectedTimePeriod() {
  const select = document.getElementById('timePeriodSelect');
  return select ? select.value : '30';
}

function filterDatasetsByTime(datasets, days) {
  if (days === 'all') return { datasets, labels: null };

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));

  const filteredDatasets = datasets.map(dataset => ({
    ...dataset,
    data: dataset.data.filter(point => {
      // Parse the formatted date string back to Date
      const pointDate = new Date(point.x);
      return pointDate >= cutoffDate;
    })
  }));

  // Collect all unique x values from filtered datasets for labels
  const allXValues = new Set();
  filteredDatasets.forEach(dataset => {
    dataset.data.forEach(point => allXValues.add(point.x));
  });

  // Sort labels chronologically
  const labels = [...allXValues].sort((a, b) => new Date(a) - new Date(b));

  return { datasets: filteredDatasets, labels };
}

function updateTimePeriod() {
  const timePeriod = getSelectedTimePeriod();
  localStorage.setItem('osrs-chart-time-period', timePeriod);

  const selectedPlayers = getSelectedPlayers();
  updateChart(selectedPlayers);
  updateTotalLevelChart(selectedPlayers);
  updateTotalExpChart(selectedPlayers);
  updateSkillLevelChart(selectedPlayers);
}

// Chart options (Total XP scale) persistence and UI
function saveTotalXpLogScalePreference(isLog) {
  localStorage.setItem('osrs-totalxp-log-scale', JSON.stringify(isLog));
}

function loadTotalXpLogScalePreference() {
  const saved = localStorage.getItem('osrs-totalxp-log-scale');
  if (!saved) return true;
  try {
    const parsed = JSON.parse(saved);
    return typeof parsed === 'boolean' ? parsed : true;
  } catch {
    return true;
  }
}

function applyTotalXpScale(isLog) {
  if (!totalExpChart) return;
  totalExpChart.options.scales.y.type = isLog ? 'logarithmic' : 'linear';
  totalExpChart.update();
}

function initializeTotalXpScaleButton() {
  const button = document.getElementById('btn-totalxp-scale');
  if (!button) return;
  function setLabel(isLog) {
    button.textContent = isLog ? 'Log scale: On' : 'Log scale: Off';
  }
  const saved = loadTotalXpLogScalePreference();
  setLabel(saved);
  button.addEventListener('click', function() {
    const current = loadTotalXpLogScalePreference();
    const next = !current;
    saveTotalXpLogScalePreference(next);
    setLabel(next);
    applyTotalXpScale(next);
  });
}

function updateAchievementsFilterButtonLabel() {
  const toggleButton = document.getElementById('toggle-major-achievements');
  if (!toggleButton || toggleButton.disabled) {
    return;
  }

  let achievementsTable = null;
  const windows = document.querySelectorAll('.window');
  for (const window of windows) {
    const titleText = window.querySelector('.title-bar-text');
    if (titleText && titleText.textContent.includes('Recent Achievements')) {
      achievementsTable = window.querySelector('table');
      break;
    }
  }

  let totalMajor = 0;
  if (achievementsTable) {
    const majorRows = achievementsTable.querySelectorAll('tbody tr[data-is-major="true"]');
    totalMajor = Array.from(majorRows).filter(row => row.style.display !== 'none').length;
  }

  if (showOnlyMajorAchievements) {
    toggleButton.textContent = totalMajor > 0
      ? 'Show All Achievements (' + totalMajor + ' major highlighted)'
      : 'Show All Achievements';
  } else {
    toggleButton.textContent = totalMajor > 0
      ? 'Show Only Major Achievements (' + totalMajor + ')'
      : 'No Major Achievements Yet';
  }
}

function initializeAchievementsFilter() {
  const toggleButton = document.getElementById('toggle-major-achievements');
  if (!toggleButton || toggleButton.disabled) {
    return;
  }

  updateAchievementsFilterButtonLabel();

  toggleButton.addEventListener('click', function() {
    showOnlyMajorAchievements = !showOnlyMajorAchievements;
    toggleButton.dataset.filterState = showOnlyMajorAchievements ? 'major' : 'all';
    const selectedPlayers = getSelectedPlayers();
    updateAchievementsTable(selectedPlayers);
    updateAchievementsFilterButtonLabel();
  });
}

function updateCheckboxVisualIndicators(checkboxPrefix, labelClass) {
  document.querySelectorAll(`input[type="checkbox"][id^="${checkboxPrefix}"]`).forEach(checkbox => {
    const label = checkbox.nextElementSibling?.classList.contains(labelClass)
      ? checkbox.nextElementSibling
      : null;
    if (label) {
      label.classList.toggle('unselected', !checkbox.checked);
    }
  });
}

function updatePlayerVisualIndicators() {
  updateCheckboxVisualIndicators('player-', 'player-label');
}

function updatePlayerSelection() {
  const selectedPlayers = getSelectedPlayers();

  // Update visual indicators
  updatePlayerVisualIndicators();

  // Update charts
  updateChart(selectedPlayers);
  updateTotalLevelChart(selectedPlayers);
  updateTotalExpChart(selectedPlayers);
  updateSkillLevelChart(selectedPlayers);

  // Update all tables
  updateQuestTable(selectedPlayers);
  updateLevelTable(selectedPlayers);
  updateDiaryTable(selectedPlayers);
  updateCombatAchievementsTable(selectedPlayers);
  updateMusicTable(selectedPlayers);
  updateCollectionLogTable(selectedPlayers);
  updateAchievementsTable(selectedPlayers);
  updateActivitiesTable(selectedPlayers);
  renderPlayerOverview(selectedPlayers);
  renderSailingProgress(selectedPlayers);
  renderSeaChartingExplorer(selectedPlayers);

  // Save selection state
  savePlayerSelection(selectedPlayers);
}

// Window visibility functions
function getSelectedWindows() {
  const checkboxes = document.querySelectorAll('input[type="checkbox"][id^="window-"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

function updateWindowVisualIndicators() {
  updateCheckboxVisualIndicators('window-', 'window-label');
}

function updateWindowVisibility() {
  const selectedWindows = getSelectedWindows();

  // Update visual indicators
  updateWindowVisualIndicators();

  // Show/hide windows based on selection
  const allWindows = document.querySelectorAll('.window[data-window-id]');
  allWindows.forEach(windowElement => {
    const windowId = windowElement.dataset.windowId;
    if (selectedWindows.includes(windowId)) {
      windowElement.classList.remove('hidden');
    } else {
      windowElement.classList.add('hidden');
    }
  });

  // Save selection state
  saveWindowVisibility(selectedWindows);
}

function showAllWindows() {
  const checkboxes = document.querySelectorAll('input[type="checkbox"][id^="window-"]');
  checkboxes.forEach(cb => cb.checked = true);
  updateWindowVisibility();
}

function hideAllWindows() {
  const checkboxes = document.querySelectorAll('input[type="checkbox"][id^="window-"]');
  checkboxes.forEach(cb => cb.checked = false);
  updateWindowVisibility();
}

function saveWindowVisibility(selectedWindows) {
  localStorage.setItem('osrs-selected-windows', JSON.stringify(selectedWindows));
}

function loadWindowVisibility() {
  const configuredCatalogVersion = Number(document.body.dataset.windowCatalogVersion);
  const currentCatalogVersion = Number.isInteger(configuredCatalogVersion) && configuredCatalogVersion >= 1
    ? configuredCatalogVersion
    : 1;
  const seenCatalogVersion = readWindowCatalogVersion();
  const selectedWindows = readStoredStringArray('osrs-selected-windows');
  if (selectedWindows) {
    const shouldRebalance = seenCatalogVersion < GENERAL_TRACKER_REBALANCE_VERSION
      && currentCatalogVersion >= GENERAL_TRACKER_REBALANCE_VERSION;
    const checkboxes = document.querySelectorAll('input[type="checkbox"][id^="window-"]');
    checkboxes.forEach(cb => {
      const introducedVersion = Number(cb.dataset.introducedVersion || 1);
      cb.checked = shouldRebalance && SAILING_WINDOW_IDS.has(cb.value)
        ? false
        : selectedWindows.includes(cb.value) || introducedVersion > seenCatalogVersion;
    });
    updateWindowVisibility();
  } else {
    // Apply and persist the generated defaults on a first visit.
    updateWindowVisibility();
  }
  localStorage.setItem('osrs-window-catalog-version', String(currentCatalogVersion));
}

function selectAllPlayers() {
  const checkboxes = document.querySelectorAll('input[type="checkbox"][id^="player-"]');
  checkboxes.forEach(cb => cb.checked = true);
  updatePlayerSelection();
}

function deselectAllPlayers() {
  const checkboxes = document.querySelectorAll('input[type="checkbox"][id^="player-"]');
  checkboxes.forEach(cb => cb.checked = false);
  updatePlayerSelection();
}

function savePlayerSelection(selectedPlayers) {
  localStorage.setItem('osrs-selected-players', JSON.stringify(selectedPlayers));
}

function loadPlayerSelection() {
  const selectedPlayers = readStoredStringArray('osrs-selected-players');
  if (selectedPlayers) {
    const checkboxes = document.querySelectorAll('input[type="checkbox"][id^="player-"]');
    checkboxes.forEach(cb => {
      cb.checked = selectedPlayers.includes(cb.value);
    });
    updatePlayerSelection();
  } else {
    // If no saved state, just update visual indicators for initial state
    updatePlayerVisualIndicators();
  }
}

function loadTimePeriodPreference() {
  const saved = localStorage.getItem('osrs-chart-time-period');
  if (saved) {
    const select = document.getElementById('timePeriodSelect');
    if (select) {
      select.value = saved;
    }
  }
}

function updateChartInstance(chartInstance, originalData, selectedPlayers) {
  if (!chartInstance) return;
  const timePeriod = getSelectedTimePeriod();
  let filteredDatasets = originalData.datasets.filter(dataset => {
    const playerKey = displayToPlayer[dataset.label];
    return playerKey && selectedPlayers.includes(playerKey);
  });
  const { datasets, labels } = filterDatasetsByTime(filteredDatasets, timePeriod);
  chartInstance.data.datasets = datasets;
  chartInstance.data.labels = labels || originalData.labels;
  chartInstance.update();
}

function updateChart(selectedPlayers) {
  updateChartInstance(questChart, originalChartData, selectedPlayers);
}

function updateTotalLevelChart(selectedPlayers) {
  updateChartInstance(totalLevelChart, originalTotalLevelChartData, selectedPlayers);
}

function updateTotalExpChart(selectedPlayers) {
  updateChartInstance(totalExpChart, originalTotalExpChartData, selectedPlayers);
}

function updateSkillLevelChart(selectedPlayers) {
  if (!skillLevelChart) return;

  const timePeriod = getSelectedTimePeriod();

  // Get the currently selected skill
  const skillSelect = document.getElementById('skillSelect');
  const selectedSkill = skillSelect ? skillSelect.value : originalSkillLevelProgressData.availableSkills[0];

  // Generate new chart data for the selected skill and players
  const filteredPlayerData = {};

  // Filter player data to only include selected players
  for (const [player, data] of Object.entries(originalSkillLevelProgressData.playerData)) {
    if (selectedPlayers.includes(player)) {
      filteredPlayerData[player] = data;
    }
  }

  // Generate new chart data
  let newChartData = generateSkillLevelChartDataJS(filteredPlayerData, selectedSkill);

  // Apply time period filter
  const { datasets, labels } = filterDatasetsByTime(newChartData.datasets, timePeriod);

  skillLevelChart.data.datasets = datasets;
  if (labels) {
    skillLevelChart.data.labels = labels;
  } else {
    skillLevelChart.data.labels = newChartData.labels;
  }
  skillLevelChart.update();
}

function updateSkillChart() {
  const selectedPlayers = getSelectedPlayers();
  updateSkillLevelChart(selectedPlayers);
}

function generateTimeSeriesChartDataJS(playerData, valueExtractor) {
  const datasets = [];
  const allTimestamps = new Set();
  const colors = CHART_COLORS;
  let colorIndex = 0;

  for (const player in playerData) {
    const data = playerData[player];
    data.forEach(d => allTimestamps.add(new Date(d.timestamp).getTime()));
  }

  const sortedTimestamps = [...allTimestamps].sort((a, b) => a - b);

  const labels = sortedTimestamps.map(timestamp => {
    return new Date(timestamp).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Vilnius'
    });
  });

  for (const player in playerData) {
    const data = playerData[player];
    const color = colors[colorIndex % colors.length];
    colorIndex++;

    const formattedData = data.map(d => ({
      x: new Date(d.timestamp).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Europe/Vilnius'
      }),
      y: valueExtractor(d)
    }));

    datasets.push({
      label: playerToDisplay[player] || player,
      data: formattedData,
      borderColor: color,
      backgroundColor: color + '33',
      fill: false,
    });
  }

  return { labels, datasets };
}

function generateSkillLevelChartDataJS(playerData, selectedSkill) {
  return generateTimeSeriesChartDataJS(playerData, d => d.skillLevels[selectedSkill] || 1);
}

function findTableByWindowTitle(titleSubstring) {
  for (const win of document.querySelectorAll('.window')) {
    const titleText = win.querySelector('.title-bar-text');
    if (titleText && titleText.textContent.includes(titleSubstring)) {
      return win.querySelector('table');
    }
  }
  return null;
}

function updateQuestTable(selectedPlayers) {
  const table = findTableByWindowTitle('Quest Comparison');
  if (!table) return;

  updateTable(table, selectedPlayers, 'quest');
}

function updateLevelTable(selectedPlayers) {
  const table = findTableByWindowTitle('Level Comparison');
  if (!table) return;

  updateTable(table, selectedPlayers, 'level');
  updateLevelRankings(table, selectedPlayers);
}

function updateLevelRankings(table, selectedPlayers) {

  // Get all rows (skills)
  const bodyRows = table.querySelectorAll('tbody tr');

  bodyRows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length === 0) return;

    // Skip the first cell (skill name)
    const levelCells = Array.from(cells).slice(1);

    // Check if this is the Total Level row
    const firstCell = cells[0];
    const isTotalLevelRow = firstCell && firstCell.textContent.trim() === 'Total Level';

    // Get levels for selected players only
    const selectedLevels = [];
    levelCells.forEach((cell, index) => {
      const playerData = cell.dataset.player;
      const level = parseInt(cell.dataset.level) || 0;

      if (playerData && selectedPlayers.includes(playerData)) {
        selectedLevels.push({
          cell: cell,
          player: playerData,
          level: level,
          index: index
        });
      }
    });

    // For Total Level row, recalculate totals based on selected players
    if (isTotalLevelRow) {
      // Recalculate total levels for selected players only
      selectedLevels.forEach(({ cell, player }) => {
        // Get all skill rows (excluding total level row)
        const skillRows = Array.from(bodyRows).filter(r => {
          const firstCellText = r.querySelector('td')?.textContent?.trim();
          return firstCellText && firstCellText !== 'Total Level';
        });

        let newTotal = 0;
        skillRows.forEach(skillRow => {
          const skillCells = skillRow.querySelectorAll('td');
          const playerCell = Array.from(skillCells).find(c =>
            c.dataset.player === player && skillRow.style.display !== 'none'
          );
          if (playerCell && playerCell.style.display !== 'none') {
            newTotal += parseInt(playerCell.dataset.level) || 0;
          }
        });

        // Update the cell's data and display
        cell.dataset.level = newTotal.toString();
        cell.textContent = newTotal.toString();
      });

      // Update selectedLevels array with new totals
      selectedLevels.forEach(item => {
        item.level = parseInt(item.cell.dataset.level) || 0;
      });
    }

    applyRankingClasses(levelCells, selectedLevels, 'level');
  });
}

function updateDiaryTable(selectedPlayers) {
  const table = findTableByWindowTitle('Achievement Diaries');
  if (!table) return;

  updateTable(table, selectedPlayers, 'diary');
}

function updateCombatAchievementsTable(selectedPlayers) {
  const table = findTableByWindowTitle('Combat Achievements');
  if (!table) return;

  updateCombatAchievementsTableContent(table, selectedPlayers);
  updateCombatAchievementsRankings(table, selectedPlayers);
}

function updateMusicTable(selectedPlayers) {
  const table = findTableByWindowTitle('Music Tracks');
  if (!table) return;

  updateTable(table, selectedPlayers, 'music');
  updateMusicTotalsRankings(table, selectedPlayers);
}

function updateTotalRowRankings(table, selectedPlayers, totalRowClass, skipColumns) {
  const totalRow = table.querySelector('tbody tr:last-child');
  if (!totalRow || !totalRow.classList.contains(totalRowClass)) return;

  const cells = totalRow.querySelectorAll('td');
  if (cells.length <= skipColumns) return;

  const totalCells = Array.from(cells).slice(skipColumns);

  const selectedTotals = [];
  totalCells.forEach(cell => {
    const playerData = cell.dataset.player;
    if (!playerData) return;
    const total = parseInt(cell.dataset.total) || 0;

    if (selectedPlayers.includes(playerData)) {
      selectedTotals.push({ cell, player: playerData, total });
    }
  });

  applyRankingClasses(totalCells, selectedTotals, 'total');
}

function updateMusicTotalsRankings(table, selectedPlayers) {
  updateTotalRowRankings(table, selectedPlayers, 'music-tracks-total-row', 1);
}

function updateCollectionLogTable(selectedPlayers) {
  const table = findTableByWindowTitle('Collection Log');
  if (!table) return;

  updateCollectionLogTableContent(table, selectedPlayers);
  updateCollectionLogRankings(table, selectedPlayers);
}

function updateMultiColumnTableContent(table, selectedPlayers, fixedColumns, totalRowClass) {
  const headerRow = table.querySelector('thead tr');
  const bodyRows = table.querySelectorAll('tbody tr');

  if (!headerRow) return;

  const headerCells = headerRow.querySelectorAll('th');
  const playerHeaders = Array.from(headerCells).slice(fixedColumns);

  const columnsToShow = new Set(Array.from({ length: fixedColumns }, (_, i) => i));
  const selectedPlayerIndices = [];

  playerHeaders.forEach((header, index) => {
    const displayName = header.textContent;
    const playerKey = displayToPlayer[displayName];

    if (playerKey && selectedPlayers.includes(playerKey)) {
      columnsToShow.add(index + fixedColumns);
      selectedPlayerIndices.push(index + fixedColumns);
      header.style.display = '';
    } else {
      header.style.display = 'none';
    }
  });

  bodyRows.forEach(row => {
    const cells = row.querySelectorAll('td');

    if (!row.classList.contains(totalRowClass)) {
      let anySelectedPlayerHasIt = false;
      for (const playerIndex of selectedPlayerIndices) {
        if (cells[playerIndex] && cells[playerIndex].textContent.trim() === '\u2713') {
          anySelectedPlayerHasIt = true;
          break;
        }
      }

      row.style.display = (!anySelectedPlayerHasIt && selectedPlayers.length > 0) ? 'none' : '';
    }

    cells.forEach((cell, index) => {
      cell.style.display = columnsToShow.has(index) ? '' : 'none';
    });
  });
}

function updateCollectionLogTableContent(table, selectedPlayers) {
  updateMultiColumnTableContent(table, selectedPlayers, 2, 'collection-log-total-row');
}

function updateCombatAchievementsTableContent(table, selectedPlayers) {
  updateMultiColumnTableContent(table, selectedPlayers, 3, 'combat-achievements-total-row');
}

function updateCombatAchievementsRankings(table, selectedPlayers) {
  updateTotalRowRankings(table, selectedPlayers, 'combat-achievements-total-row', 3);
}

function updateCollectionLogRankings(table, selectedPlayers) {
  updateTotalRowRankings(table, selectedPlayers, 'collection-log-total-row', 2);
}

function updateAchievementsTable(selectedPlayers) {
  const table = findTableByWindowTitle('Recent Achievements');
  if (!table) return;

  // For achievements table, filter rows by selected players
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach(row => {
    const playerCell = row.querySelector('td:first-child strong');
    if (playerCell) {
      const playerName = playerCell.textContent;
      // Use global displayToPlayer mapping

      const playerKey = displayToPlayer[playerName];
      const matchesPlayer = playerKey && selectedPlayers.includes(playerKey);
      const isMajor = row.dataset.isMajor === 'true';
      const matchesMajorFilter = !showOnlyMajorAchievements || isMajor;
      row.style.display = matchesPlayer && matchesMajorFilter ? '' : 'none';
    }
  });

  updateAchievementsFilterButtonLabel();
}

function updateActivitiesTable(selectedPlayers) {
  const table = findTableByWindowTitle('Activities Comparison');
  if (!table) return;

  updateTable(table, selectedPlayers, 'activity');
  updateActivityRankings(table, selectedPlayers);
}

function updateActivityRankings(table, selectedPlayers) {
  const bodyRows = table.querySelectorAll('tbody tr');

  bodyRows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length === 0) return;

    const scoreCells = Array.from(cells).slice(1);

    const selectedScores = [];
    scoreCells.forEach((cell, index) => {
      const playerData = cell.dataset.player;
      // Handle both data-score and data-total attributes
      const score = parseInt(cell.dataset.score || cell.dataset.total) || 0;

      if (playerData && selectedPlayers.includes(playerData)) {
        selectedScores.push({
          cell: cell,
          player: playerData,
          score: score,
        });
      }
    });

    applyRankingClasses(scoreCells, selectedScores, 'score');
  });
}

function updateTable(table, selectedPlayers, tableType) {
  const headerRow = table.querySelector('thead tr');
  const bodyRows = table.querySelectorAll('tbody tr');

  if (!headerRow) return;

  // Get all header cells (skip first cell which is the item name)
  const headerCells = headerRow.querySelectorAll('th');
  const playerHeaders = Array.from(headerCells).slice(1);

  // Create mapping of column indices to show/hide
  const columnsToShow = new Set([0]); // Always show first column (item name)

  playerHeaders.forEach((header, index) => {
    const displayName = header.textContent;
    const playerKey = displayToPlayer[displayName];

    if (playerKey && selectedPlayers.includes(playerKey)) {
      columnsToShow.add(index + 1);
      header.style.display = '';
    } else {
      header.style.display = 'none';
    }
  });

  // Update body rows
  bodyRows.forEach(row => {
    const cells = row.querySelectorAll('td');
    cells.forEach((cell, index) => {
      cell.style.display = columnsToShow.has(index) ? '' : 'none';
    });

    // For achievement diary tables, handle special formatting
    if (tableType === 'diary' && row.querySelector('td[colspan]')) {
      // This is a section header row, always show it
      row.style.display = '';
    }
  });
}

// Get window ID from title text
function getWindowId(windowElement) {
  const titleText = windowElement.querySelector('.title-bar-text').textContent;
  return titleText.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function updateWindowAccessibilityState(windowElement) {
  const title = windowElement.querySelector('.title-bar-text')?.textContent.trim() || 'window';
  const windowBody = windowElement.querySelector('.window-body');
  const minimizeButton = windowElement.querySelector('.title-bar-controls button[onclick^="toggleWindow"]');
  const closeButton = windowElement.querySelector('.title-bar-controls button[onclick^="closeWindow"]');
  const isMinimized = windowElement.classList.contains('minimized');

  if (windowBody && minimizeButton) {
    const bodyId = `window-body-${getWindowId(windowElement)}`;
    windowBody.id = bodyId;
    minimizeButton.setAttribute('aria-controls', bodyId);
    minimizeButton.setAttribute('aria-expanded', String(!isMinimized));
    minimizeButton.setAttribute('aria-label', isMinimized ? 'Restore' : 'Minimize');
    minimizeButton.setAttribute('title', isMinimized ? `Restore ${title}` : `Minimize ${title}`);
  }

  if (closeButton) {
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.setAttribute('title', `Close ${title}`);
  }
}

function initializeWindowAccessibility() {
  document.querySelectorAll('.window').forEach(updateWindowAccessibilityState);
}

// Load minimized states from localStorage
function loadMinimizedStates() {
  const savedStates = readStoredObject('osrs-minimized-windows') || {};
  document.querySelectorAll('.window').forEach(windowElement => {
    const windowId = getWindowId(windowElement);
    if (savedStates[windowId]) {
      windowElement.classList.add('minimized');
    }
    updateWindowAccessibilityState(windowElement);
  });
}

// Save minimized states to localStorage
function saveMinimizedStates() {
  const states = {};
  document.querySelectorAll('.window').forEach(windowElement => {
    const windowId = getWindowId(windowElement);
    states[windowId] = windowElement.classList.contains('minimized');
  });
  localStorage.setItem('osrs-minimized-windows', JSON.stringify(states));
}

// Load window order from localStorage
function loadWindowOrder() {
  const savedOrder = readStoredStringArray('osrs-window-order') || [];
  if (savedOrder.length === 0) return;

  const container = document.querySelector('.container');
  const windows = Array.from(container.querySelectorAll('.window'));

  // Create a map of window IDs to elements
  const windowMap = {};
  windows.forEach(windowElement => {
    const windowId = getWindowId(windowElement);
    windowMap[windowId] = windowElement;
  });

  const seenCatalogVersion = readWindowCatalogVersion();
  const configuredCatalogVersion = Number(document.body.dataset.windowCatalogVersion);
  const currentCatalogVersion = Number.isInteger(configuredCatalogVersion) && configuredCatalogVersion >= 1
    ? configuredCatalogVersion
    : 1;
  const shouldRebalance = seenCatalogVersion < GENERAL_TRACKER_REBALANCE_VERSION
    && currentCatalogVersion >= GENERAL_TRACKER_REBALANCE_VERSION;
  const introducedWindows = windows.filter(windowElement => {
    const windowId = getWindowId(windowElement);
    const introducedVersion = Number(windowElement.dataset.introducedVersion || 1);
    return !savedOrder.includes(windowId) && introducedVersion > seenCatalogVersion;
  });
  const introducedWindowIds = new Set(introducedWindows.map(getWindowId));
  let orderedWindows = savedOrder.map(windowId => windowMap[windowId]).filter(Boolean);

  for (const windowElement of windows) {
    const windowId = getWindowId(windowElement);
    if (!savedOrder.includes(windowId) && !introducedWindowIds.has(windowId)) {
      orderedWindows.push(windowElement);
    }
  }

  const configurationIndex = orderedWindows.findIndex(windowElement => getWindowId(windowElement) === 'configuration');
  orderedWindows.splice(configurationIndex >= 0 ? configurationIndex + 1 : 0, 0, ...introducedWindows);
  if (shouldRebalance) {
    const sailingWindows = orderedWindows.filter(windowElement => SAILING_WINDOW_IDS.has(getWindowId(windowElement)));
    orderedWindows = orderedWindows
      .filter(windowElement => !SAILING_WINDOW_IDS.has(getWindowId(windowElement)))
      .concat(sailingWindows);
  }
  orderedWindows.forEach(windowElement => container.appendChild(windowElement));

  // Persist catalog migrations before the version is marked as seen.
  if (introducedWindows.length > 0 || shouldRebalance) saveWindowOrder();
}

// Save window order to localStorage
function saveWindowOrder() {
  const container = document.querySelector('.container');
  const windowOrder = Array.from(container.querySelectorAll('.window')).map(windowElement =>
    getWindowId(windowElement)
  );
  localStorage.setItem('osrs-window-order', JSON.stringify(windowOrder));
}

// Sync states across all open windows/tabs
function syncWindowStates(changedWindowId, isMinimized) {
  document.querySelectorAll('.window').forEach(windowElement => {
    const windowId = getWindowId(windowElement);
    if (windowId === changedWindowId) {
      if (isMinimized) {
        windowElement.classList.add('minimized');
      } else {
        windowElement.classList.remove('minimized');
      }
      updateWindowAccessibilityState(windowElement);
    }
  });
}

// Sync window order across all open windows/tabs
function syncWindowOrder(newOrder) {
  const container = document.querySelector('.container');
  const windows = Array.from(container.querySelectorAll('.window'));

  // Create a map of window IDs to elements
  const windowMap = {};
  windows.forEach(windowElement => {
    const windowId = getWindowId(windowElement);
    windowMap[windowId] = windowElement;
  });

  // Reorder windows based on new order
  newOrder.forEach(windowId => {
    if (windowMap[windowId]) {
      container.appendChild(windowMap[windowId]);
    }
  });
}

function toggleWindow(button) {
  const windowElement = button.closest('.window');
  const windowId = getWindowId(windowElement);
  const isMinimized = windowElement.classList.toggle('minimized');
  updateWindowAccessibilityState(windowElement);

  // Save state and notify other windows
  saveMinimizedStates();

  // Broadcast change to other windows/tabs
  localStorage.setItem('osrs-window-change', JSON.stringify({
    windowId: windowId,
    isMinimized: isMinimized,
    timestamp: Date.now()
  }));
}

function closeWindow(button) {
  const windowElement = button.closest('.window');
  const windowDataId = windowElement.dataset.windowId;

  // Don't allow closing the Configuration window (it doesn't have data-window-id)
  if (!windowDataId) {
    return;
  }

  // Find and uncheck the corresponding checkbox in Configuration
  const checkbox = document.querySelector('input[type="checkbox"][id="window-' + windowDataId + '"]');
  if (checkbox) {
    checkbox.checked = false;
    // Trigger the existing window visibility update function
    updateWindowVisibility();
  }
}

// Initialize drag and drop functionality
function initializeDragAndDrop() {
  if (!window.matchMedia('(min-width: 701px) and (pointer: fine)').matches) {
    document.querySelectorAll('.title-bar').forEach(titleBar => {
      titleBar.draggable = false;
      titleBar.style.cursor = 'default';
    });
    return;
  }

  const container = document.querySelector('.container');
  let draggedElement = null;
  let dropIndicator = null;

  // Create drop indicator
  dropIndicator = document.createElement('div');
  dropIndicator.className = 'drop-indicator';
  document.body.appendChild(dropIndicator);

  document.querySelectorAll('.window').forEach(windowElement => {
    // Make only the title bar draggable
    const titleBar = windowElement.querySelector('.title-bar');
    if (titleBar) {
      titleBar.draggable = true;
      titleBar.style.cursor = 'grab';

      titleBar.addEventListener('dragstart', function(e) {
        draggedElement = windowElement;
        windowElement.classList.add('dragging');
        container.classList.add('drag-over');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', windowElement.outerHTML);
      });

      titleBar.addEventListener('dragend', function(e) {
        windowElement.classList.remove('dragging');
        container.classList.remove('drag-over');
        dropIndicator.style.display = 'none';
        draggedElement = null;
      });

      titleBar.addEventListener('dragenter', function(e) {
        titleBar.style.cursor = 'grabbing';
      });

      titleBar.addEventListener('dragleave', function(e) {
        titleBar.style.cursor = 'grab';
      });
    }

    // Handle drop zones for other windows
    windowElement.addEventListener('dragover', function(e) {
      if (draggedElement && draggedElement !== this) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const rect = this.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        if (e.clientY < midY) {
          // Show indicator above this element
          dropIndicator.style.display = 'block';
          dropIndicator.style.top = (rect.top - 2) + 'px';
          dropIndicator.style.left = rect.left + 'px';
          dropIndicator.style.width = rect.width + 'px';
        } else {
          // Show indicator below this element
          dropIndicator.style.display = 'block';
          dropIndicator.style.top = (rect.bottom - 2) + 'px';
          dropIndicator.style.left = rect.left + 'px';
          dropIndicator.style.width = rect.width + 'px';
        }
      }
    });

    windowElement.addEventListener('drop', function(e) {
      if (draggedElement && draggedElement !== this) {
        e.preventDefault();

        const rect = this.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        if (e.clientY < midY) {
          // Insert before this element
          container.insertBefore(draggedElement, this);
        } else {
          // Insert after this element
          container.insertBefore(draggedElement, this.nextSibling);
        }

        // Save and sync the new order
        saveWindowOrder();

        // Broadcast order change to other windows/tabs
        const newOrder = Array.from(container.querySelectorAll('.window')).map(w => getWindowId(w));
        localStorage.setItem('osrs-order-change', JSON.stringify({
          order: newOrder,
          timestamp: Date.now()
        }));
      }
    });
  });

  // Handle drag over container (for empty spaces)
  container.addEventListener('dragover', function(e) {
    if (draggedElement) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Find the closest window element
      const afterElement = getDragAfterElement(container, e.clientY);
      if (!afterElement) {
        // Show indicator at the end
        const lastWindow = container.lastElementChild;
        if (lastWindow) {
          const rect = lastWindow.getBoundingClientRect();
          dropIndicator.style.display = 'block';
          dropIndicator.style.top = (rect.bottom + 10) + 'px';
          dropIndicator.style.left = rect.left + 'px';
          dropIndicator.style.width = rect.width + 'px';
        }
      }
    }
  });

  container.addEventListener('drop', function(e) {
    if (draggedElement) {
      e.preventDefault();
      const afterElement = getDragAfterElement(container, e.clientY);
      if (!afterElement) {
        container.appendChild(draggedElement);
      } else {
        container.insertBefore(draggedElement, afterElement);
      }

      // Save and sync the new order
      saveWindowOrder();

      // Broadcast order change to other windows/tabs
      const newOrder = Array.from(container.querySelectorAll('.window')).map(w => getWindowId(w));
      localStorage.setItem('osrs-order-change', JSON.stringify({
        order: newOrder,
        timestamp: Date.now()
      }));
    }
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.window:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Listen for storage changes from other windows/tabs
window.addEventListener('storage', function(e) {
  try {
    if (e.key === 'osrs-window-change') {
      const change = JSON.parse(e.newValue);
      if (typeof change?.windowId === 'string' && typeof change?.isMinimized === 'boolean') {
        syncWindowStates(change.windowId, change.isMinimized);
      }
    } else if (e.key === 'osrs-order-change') {
      const change = JSON.parse(e.newValue);
      if (Array.isArray(change?.order)) {
        syncWindowOrder(change.order.filter(windowId => typeof windowId === 'string'));
      }
    }
  } catch {
    // Ignore malformed cross-tab state and keep the current page usable.
  }
});

// === TABLE RENDERING FUNCTIONS ===

function generateQuestComparisonTable(comparisonData) {
  const { players, quests, playerQuests, questMetaByName } = comparisonData;
  if (players.length === 0) {
    return "<p>No player data found to compare quests.</p>";
  }

  let tableHtml = '<div class="sunken-panel" role="region" aria-label="Quest comparison" tabindex="0" style="height: 400px; overflow: auto;">';
  tableHtml += '<table class="interactive sticky-header quest-comparison-table" style="width: 100%;">';

  // Header
  tableHtml += '<thead><tr><th>Quest</th>';
  for (const player of players) {
    tableHtml += `<th>${escapeHtml(getDisplayName(player))}</th>`;
  }
  tableHtml += '</tr></thead>';

  // Body
  tableHtml += '<tbody>';
  for (const quest of quests) {
    const statuses = players.map(player => playerQuests[player]?.[quest] ?? 0);

    let rowClass = '';
    if (statuses.every(s => s === 2)) {
      rowClass = 'all-completed';
    } else if (statuses.filter(s => s === 2).length === 1) {
      rowClass = 'completed-by-one';
    } else if (statuses.every(s => s === 0)) {
      rowClass = 'not-started-by-any';
    }

    tableHtml += `<tr class="${rowClass}">`;
    const meta = questMetaByName ? questMetaByName[quest] : null;
    if (meta && meta.nameWikiLink) {
      tableHtml += `<td><a href="${safeWikiUrl(meta.nameWikiLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: inherit;">${escapeHtml(quest)}</a></td>`;
    } else {
      tableHtml += `<td>${escapeHtml(quest)}</td>`;
    }
    for (const status of statuses) {
      let statusClass = 'status-not-started';
      let statusLabel = 'Not started';
      if (status === 1) {
        statusClass = 'status-in-progress';
        statusLabel = 'In progress';
      }
      if (status === 2) {
        statusClass = 'status-completed';
        statusLabel = 'Completed';
      }
      tableHtml += `<td class="${statusClass}" aria-label="${statusLabel}" title="${statusLabel}"></td>`;
    }
    tableHtml += '</tr>';
  }
  // Add total quests completed row (sticky)
  const totalCompleted = players.map(player => {
    const pq = playerQuests[player] || {};
    return Object.values(pq).reduce((sum, status) => sum + (status === 2 ? 1 : 0), 0);
  });

  // Rankings for totals
  const totalsForRanking = players.map((player, idx) => ({ player, total: totalCompleted[idx] }));
  const totalRankings = computeRankings(totalsForRanking, 'total');

  tableHtml += '<tr class="sticky-total-row quest-total-row">';
  tableHtml += '<td style="font-size: 1.1em; font-weight: bold;">Total Quests Completed</td>';
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const total = totalCompleted[i];
    const rankingClass = getRankingClass(total, totalRankings[player]);
    tableHtml += `<td class="level-cell${rankingClass}" data-player="${player}" data-total="${total}" style="font-size: 1.1em; text-align: center;">${total}</td>`;
  }
  tableHtml += '</tr>';
  tableHtml += '</tbody></table></div>';

  return tableHtml;
}

function generateLevelComparisonTable(comparisonData) {
  const { players, skills, playerLevels } = comparisonData;
  if (players.length === 0) {
    return "<p>No player data found to compare levels.</p>";
  }

  let tableHtml = '<div class="sunken-panel" role="region" aria-label="Level comparison" tabindex="0" style="height: 400px; overflow: auto;">';
  tableHtml += '<table class="interactive sticky-header level-comparison-table" style="width: 100%;">';

  // Header
  tableHtml += '<thead><tr><th>Skill</th>';
  for (const player of players) {
    tableHtml += `<th>${escapeHtml(getDisplayName(player))}</th>`;
  }
  tableHtml += '</tr></thead>';

  // Body
  tableHtml += '<tbody>';
  for (const skill of skills) {
    tableHtml += '<tr>';
    tableHtml += `<td>${escapeHtml(skill)}</td>`;

    // Get all levels for this skill to determine rankings
    const skillLevels = players.map(player => ({
      player,
      level: playerLevels[player]?.[skill] ?? 0
    }));

    const rankings = computeRankings(skillLevels, 'level');

    for (const player of players) {
      const level = playerLevels[player]?.[skill] ?? 0;
      let levelClass = 'level-low';
      if (level >= 80) levelClass = 'level-high';
      else if (level >= 50) levelClass = 'level-medium';

      const rankingClass = getRankingClass(level, rankings[player]);

      tableHtml += `<td class="level-cell ${levelClass}${rankingClass}" data-player="${escapeHtml(player)}" data-skill="${escapeHtml(skill)}" data-level="${level}">${level}</td>`;
    }
    tableHtml += '</tr>';
  }

  // Add total level row (sticky)
  tableHtml += '<tr class="sticky-total-row level-total-row">';
  tableHtml += '<td style="font-weight: bold; font-size: 1.1em;">Total Level</td>';

  // Calculate total levels for each player
  const totalLevels = players.map(player => {
    const total = skills.reduce((sum, skill) => {
      return sum + (playerLevels[player]?.[skill] ?? 0);
    }, 0);
    return { player, total };
  });

  const totalRankings = computeRankings(totalLevels, 'total');

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const totalLevel = totalLevels[i].total;
    let levelClass = 'level-low';
    if (totalLevel >= 1600) levelClass = 'level-high';
    else if (totalLevel >= 1000) levelClass = 'level-medium';

    const rankingClass = getRankingClass(totalLevel, totalRankings[player]);

    tableHtml += `<td class="level-cell ${levelClass}${rankingClass}" data-player="${player}" data-skill="Total Level" data-level="${totalLevel}" style="font-size: 1.1em;">${totalLevel}</td>`;
  }
  tableHtml += '</tr>';

  tableHtml += '</tbody></table></div>';

  return tableHtml;
}

function generateAchievementDiaryComparisonTable(comparisonData) {
  const { players, achievements, playerAchievements } = comparisonData;
  if (players.length === 0) {
    return "<p>No player data found to compare achievement diaries.</p>";
  }

  let tableHtml = '<div class="sunken-panel" role="region" aria-label="Achievement diary comparison" tabindex="0" style="height: 400px; overflow: auto;">';
  tableHtml += '<table class="interactive sticky-header achievement-diaries-table" style="width: 100%;">';

  // Header
  tableHtml += '<thead><tr><th>Achievement Diary</th>';
  for (const player of players) {
    tableHtml += `<th>${escapeHtml(getDisplayName(player))}</th>`;
  }
  tableHtml += '</tr></thead>';

  // Body
  tableHtml += '<tbody>';
  for (const achievement of achievements) {
    tableHtml += `<tr><td colspan="${players.length + 1}" style="background-color: #e0e0e0; font-weight: bold; text-align: center;">${escapeHtml(achievement)}</td></tr>`;

    // Add rows for each difficulty level
    const difficulties = ['Easy', 'Medium', 'Hard', 'Elite'];
    for (const difficulty of difficulties) {
      const statuses = players.map(player => {
        const playerData = playerAchievements[player]?.[achievement];
        const difficultyData = playerData?.[difficulty];
        if (!difficultyData) {
          return null; // Not started
        }

        if (Array.isArray(difficultyData.tasks) && difficultyData.tasks.length > 0) {
          return difficultyData.tasks.every(task => task);
        }

        return false; // In-progress if tasks array is missing/empty, but entry exists
      });

      let rowClass = '';
      const completedCount = statuses.filter(s => s === true).length;
      if (completedCount === players.length) {
        rowClass = 'diary-complete';
      } else if (completedCount > 0) {
        rowClass = 'diary-partial';
      } else {
        rowClass = 'diary-not-started';
      }

      tableHtml += `<tr class="${rowClass}">`;
      tableHtml += `<td style="padding-left: 20px;">${difficulty}</td>`;

      for (const status of statuses) {
        let statusClass = '';
        let statusText = '';
        if (status === true) {
          statusClass = 'diary-complete';
          statusText = '\u2713';
        } else if (status === false) {
          statusClass = 'diary-partial';
          statusText = '\u2717';
        } else {
          statusClass = 'diary-not-started';
          statusText = '-';
        }
        const statusLabel = status === true ? 'Completed' : status === false ? 'In progress' : 'Not started';
        tableHtml += `<td class="${statusClass}" aria-label="${statusLabel}" title="${statusLabel}" style="text-align: center;">${statusText}</td>`;
      }
      tableHtml += '</tr>';
    }
  }
  // Add sticky totals row for diaries
  tableHtml += '<tr class="sticky-total-row achievement-diaries-total-row">';
  tableHtml += '<td style="font-weight: bold; font-size: 1.1em;">Total Completed</td>';

  // Calculate total number of completed diary difficulties per player
  const difficulties = ['Easy', 'Medium', 'Hard', 'Elite'];
  const totals = players.map(player => {
    let total = 0;
    for (const achievement of achievements) {
      const playerData = playerAchievements[player]?.[achievement];
      if (!playerData) continue;
      for (const diff of difficulties) {
        const d = playerData[diff];
        if (d && Array.isArray(d.tasks) && d.tasks.length > 0 && d.tasks.every(t => t)) {
          total += 1;
        }
      }
    }
    return total;
  });

  // Rankings
  const totalsForRanking = players.map((player, idx) => ({ player, total: totals[idx] }));
  const totalRankings = computeRankings(totalsForRanking, 'total');

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const total = totals[i];
    const rankingClass = getRankingClass(total, totalRankings[player]);
    tableHtml += `<td class="level-cell${rankingClass}" data-player="${player}" data-total="${total}" style="font-size: 1.1em; text-align: center;">${total}</td>`;
  }
  tableHtml += '</tr>';
  tableHtml += '</tbody></table></div>';

  return tableHtml;
}

function generateCombatAchievementsComparisonTable(comparisonData) {
  const { players, playerCombatAchievements, combatAchievementsData } = comparisonData;
  if (players.length === 0) {
    return "<p>No player data found to compare combat achievements.</p>";
  }

  // Get all available achievements from the metadata and filter for completed ones
  const allAchievements = Object.values(combatAchievementsData).filter(achievement => {
    const numericTaskId = parseInt(achievement.taskId);
    return players.some(player => {
      const playerAchievements = playerCombatAchievements[player] || [];
      return playerAchievements.includes(numericTaskId);
    });
  });

  // Sort achievements by tier and name
  const sortedAchievements = allAchievements.sort((a, b) => {
    const tierA = TIER_ORDER[a.tier] || 999;
    const tierB = TIER_ORDER[b.tier] || 999;

    if (tierA !== tierB) {
      return tierA - tierB;
    }

    // Then sort by name
    return a.name.localeCompare(b.name);
  });

  let tableHtml = '<div class="sunken-panel" role="region" aria-label="Combat achievement comparison" tabindex="0" style="height: 400px; overflow: auto;">';
  tableHtml += '<table class="interactive sticky-header combat-achievements-table" style="width: 100%;">';

  // Header
  tableHtml += '<thead><tr><th style="width: 50px;">Tier</th><th>Monster</th><th>Achievement</th>';
  for (const player of players) {
    tableHtml += `<th style="width: 80px;">${escapeHtml(getDisplayName(player))}</th>`;
  }
  tableHtml += '</tr></thead>';

  // Body
  tableHtml += '<tbody>';

  for (const achievement of sortedAchievements) {
    const numericTaskId = parseInt(achievement.taskId);
    const statuses = players.map(player => {
      const playerAchievements = playerCombatAchievements[player] || [];
      return playerAchievements.includes(numericTaskId);
    });

    let rowClass = '';
    const completedCount = statuses.filter(s => s === true).length;
    if (completedCount === players.length) {
      rowClass = 'combat-achievement-complete';
    } else if (completedCount > 0) {
      rowClass = 'combat-achievement-partial';
    } else {
      rowClass = 'combat-achievement-none';
    }

    tableHtml += `<tr class="${rowClass}">`;

    // Tier icon
    tableHtml += `<td style="text-align: center;"><img src="${safeWikiUrl(achievement.tierIconUrl)}" alt="${escapeHtml(achievement.tier)}" width="24" height="24" style="image-rendering: pixelated;"></td>`;

    // Monster name with link (if available)
    if (achievement.monster && achievement.monster !== 'N/A' && achievement.monsterWikiLink) {
      tableHtml += `<td><a href="${safeWikiUrl(achievement.monsterWikiLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: inherit;">${escapeHtml(achievement.monster)}</a></td>`;
    } else {
      tableHtml += `<td style="color: #666; font-style: italic;">${escapeHtml(achievement.monster || 'Various')}</td>`;
    }

    // Achievement name with link
    tableHtml += `<td><a href="${safeWikiUrl(achievement.nameWikiLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: inherit;" title="${escapeHtml(achievement.description)}">${escapeHtml(achievement.name)}</a></td>`;

    // Player columns
    for (const status of statuses) {
      let statusClass = status ? 'combat-achievement-completed' : 'combat-achievement-not-completed';
      let statusText = status ? '\u2713' : '\u2717';
      const statusLabel = status ? 'Completed' : 'Not completed';
      tableHtml += `<td class="${statusClass}" aria-label="${statusLabel}" title="${statusLabel}" style="text-align: center;">${statusText}</td>`;
    }

    tableHtml += '</tr>';
  }

  // Add total achievements row (sticky at bottom)
  tableHtml += '<tr class="sticky-total-row combat-achievements-total-row">';
  tableHtml += '<td></td>';
  tableHtml += '<td></td>';
  tableHtml += '<td style="font-size: 1.1em;">Total Achievements</td>';

  // Calculate total achievements for each player
  const totalAchievements = players.map(player => ({
    player,
    total: playerCombatAchievements[player]?.length ?? 0
  }));

  const totalRankings = computeRankings(totalAchievements, 'total');

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const total = totalAchievements[i].total;
    const rankingClass = getRankingClass(total, totalRankings[player]);

    tableHtml += `<td class="level-cell${rankingClass}" data-player="${player}" data-total="${total}" style="font-size: 1.1em; text-align: center;">${total}</td>`;
  }
  tableHtml += '</tr>';

  tableHtml += '</tbody></table></div>';

  return tableHtml;
}

function generateMusicTracksComparisonTable(comparisonData, musicTracksData) {
  const { players, musicTracks, playerMusicTracks } = comparisonData;
  if (players.length === 0) {
    return "<p>No player data found to compare music tracks.</p>";
  }

  let tableHtml = '<div class="sunken-panel" role="region" aria-label="Music track comparison" tabindex="0" style="height: 400px; overflow: auto;">';
  tableHtml += '<table class="interactive sticky-header music-tracks-table" style="width: 100%;">';

  // Header
  tableHtml += '<thead><tr><th>Music Track</th>';
  for (const player of players) {
    tableHtml += `<th>${escapeHtml(getDisplayName(player))}</th>`;
  }
  tableHtml += '</tr></thead>';

  // Body
  tableHtml += '<tbody>';
  for (const track of musicTracks) {
    const statuses = players.map(player => {
      const playerData = playerMusicTracks[player];
      if (!playerData || !Object.hasOwn(playerData, track)) return null;
      return playerData[track] === true;
    });

    let rowClass = '';
    const unlockedCount = statuses.filter(s => s === true).length;
    const knownCount = statuses.filter(s => s !== null).length;
    if (knownCount === 0) {
      rowClass = 'music-track-unknown';
    } else if (unlockedCount === players.length) {
      rowClass = 'music-track-unlocked';
    } else if (unlockedCount > 0) {
      rowClass = 'diary-partial';
    } else {
      rowClass = 'music-track-locked';
    }

    tableHtml += `<tr class="${rowClass}">`;
    const meta = musicTracksData && musicTracksData[track];
    if (meta && meta.nameWikiLink) {
      tableHtml += `<td><a href="${safeWikiUrl(meta.nameWikiLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: inherit;">${escapeHtml(track)}</a></td>`;
    } else {
      tableHtml += `<td>${escapeHtml(track)}</td>`;
    }

    for (const status of statuses) {
      let statusClass = '';
      let statusText = '';
      if (status === true) {
        statusClass = 'music-track-unlocked';
        statusText = '\u2713';
      } else if (status === false) {
        statusClass = 'music-track-locked';
        statusText = '\u2717';
      } else {
        statusClass = 'music-track-unknown';
        statusText = '?';
      }
      const statusLabel = status === true ? 'Unlocked' : status === false ? 'Locked' : 'Not exposed by WikiSync';
      tableHtml += `<td class="${statusClass}" aria-label="${statusLabel}" title="${statusLabel}" style="text-align: center;">${statusText}</td>`;
    }
    tableHtml += '</tr>';
  }

  // Add total music tracks row
  tableHtml += '<tr class="sticky-total-row music-tracks-total-row">';
  tableHtml += '<td style="font-size: 1.1em; font-weight: bold;">Total Tracks</td>';

  // Calculate total unlocked tracks for each player
  const totalTracks = players.map(player => {
    const tracksObj = playerMusicTracks[player] || {};
    const total = Object.values(tracksObj).reduce((sum, unlocked) => sum + (unlocked === true ? 1 : 0), 0);
    return { player, total };
  });

  const totalRankings = computeRankings(totalTracks, 'total');

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const total = totalTracks[i].total;
    const rankingClass = getRankingClass(total, totalRankings[player]);

    tableHtml += `<td class="level-cell${rankingClass}" data-player="${player}" data-total="${total}" style="font-size: 1.1em; text-align: center;">${total}</td>`;
  }
  tableHtml += '</tr>';

  tableHtml += '</tbody></table></div>';

  return tableHtml;
}

function generateCollectionLogComparisonTable(comparisonData) {
  const { players, playerCollectionLogs, playerCollectionTotals = {}, collectionLogData } = comparisonData;
  if (players.length === 0) {
    return "<p>No player data found to compare collection logs.</p>";
  }

  const allItems = Object.values(collectionLogData).filter(item => {
    const numericId = parseInt(item.itemId);
    return players.some(player =>
      playerCollectionLogs[player] && playerCollectionLogs[player].includes(numericId)
    );
  });

  let tableHtml = '<div class="sunken-panel" role="region" aria-label="Collection log comparison" tabindex="0" style="height: 400px; overflow: auto;">';

  tableHtml += '<table class="interactive sticky-header collection-log-table" style="width: 100%;">';

  // Header
  tableHtml += '<thead><tr>';
  tableHtml += '<th style="width: 50px;">Icon</th>';
  tableHtml += '<th>Item</th>';
  for (const player of players) {
    tableHtml += `<th style="width: 80px;">${escapeHtml(getDisplayName(player))}</th>`;
  }
  tableHtml += '</tr></thead>';

  // Body
  tableHtml += '<tbody>';

  for (const item of allItems) {
    const numericId = parseInt(item.itemId);

    // Calculate how many players have this item
    const playersWithItem = players.filter(player =>
      playerCollectionLogs[player] && playerCollectionLogs[player].includes(numericId)
    );

    // Row class based on completion
    let rowClass = '';
    if (playersWithItem.length === players.length) {
      rowClass = 'collection-complete';
    } else if (playersWithItem.length > 0) {
      rowClass = 'collection-partial';
    }

    tableHtml += `<tr class="${rowClass}">`;

    // Item icon
    tableHtml += `<td style="text-align: center;"><img src="${safeWikiUrl(item.itemIcon)}" alt="${escapeHtml(item.itemName)}" width="32" height="32" onerror="this.src='https://oldschool.runescape.wiki/images/Bank_filler.png'" style="image-rendering: pixelated;"></td>`;

    // Item name
    tableHtml += `<td><a href="${safeWikiUrl(item.itemLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: inherit;">${escapeHtml(item.itemName)}</a></td>`;

    // Player columns
    for (const player of players) {
      const hasItem = playerCollectionLogs[player] && playerCollectionLogs[player].includes(numericId);
      let statusClass = hasItem ? 'collection-has-item' : 'collection-missing-item';
      let statusText = hasItem ? '\u2713' : '\u2717';
      const statusLabel = hasItem ? 'Collected' : 'Not collected';
      tableHtml += `<td class="${statusClass}" aria-label="${statusLabel}" title="${statusLabel}" style="text-align: center;">${statusText}</td>`;
    }

    tableHtml += '</tr>';
  }

  // Add total items row
  tableHtml += '<tr class="sticky-total-row collection-log-total-row">';
  tableHtml += '<td></td>';
  tableHtml += '<td style="font-size: 1.1em;">Total Items</td>';

  // Calculate total items for each player
  const totalItems = players.map(player => ({
    player,
    total: Number.isFinite(playerCollectionTotals[player])
      ? playerCollectionTotals[player]
      : (playerCollectionLogs[player]?.length ?? 0)
  }));

  const totalRankings = computeRankings(totalItems, 'total');

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const total = totalItems[i].total;
    const rankingClass = getRankingClass(total, totalRankings[player]);

    tableHtml += `<td class="level-cell${rankingClass}" data-player="${player}" data-total="${total}" style="font-size: 1.1em; text-align: center;">${total}</td>`;
  }
  tableHtml += '</tr>';

  tableHtml += '</tbody></table></div>';

  return tableHtml;
}

function generateActivitiesComparisonTable(comparisonData) {
  const { players, activities, playerActivities } = comparisonData;
  if (players.length === 0) {
    return "<p>No player data found to compare activities.</p>";
  }

  let tableHtml = '<div class="sunken-panel" role="region" aria-label="Activities comparison" tabindex="0" style="height: 400px; overflow: auto;">';
  tableHtml += '<table class="interactive sticky-header activities-comparison-table" style="width: 100%;">';

  // Header
  tableHtml += '<thead><tr><th>Activity</th>';
  for (const player of players) {
    tableHtml += `<th>${escapeHtml(getDisplayName(player))}</th>`;
  }
  tableHtml += '</tr></thead>';

  // Body
  tableHtml += '<tbody>';
  for (const activity of activities) {
    tableHtml += '<tr>';
    tableHtml += `<td>${escapeHtml(activity)}</td>`;

    const activityScores = players.map(player => ({
      player,
      score: playerActivities[player]?.[activity] ?? 0
    }));

    const rankings = computeRankings(activityScores, 'score');

    for (const player of players) {
      const score = playerActivities[player]?.[activity] ?? 0;
      let scoreClass = 'level-low';
      if (score >= 100) scoreClass = 'level-high';
      else if (score >= 10) scoreClass = 'level-medium';

      const rankingClass = getRankingClass(score, rankings[player]);

      tableHtml += `<td class="level-cell ${scoreClass}${rankingClass}" data-player="${escapeHtml(player)}" data-activity="${escapeHtml(activity)}" data-score="${score}">${score}</td>`;
    }
    tableHtml += '</tr>';
  }

  // Add total activities row
  tableHtml += '<tr class="sticky-total-row activities-total-row">';
  tableHtml += '<td style="font-weight: bold; font-size: 1.1em;">Activities with Progress</td>';

  // Different activities use incomparable units, so count active categories rather than summing scores.
  const totalActivities = players.map(player => ({
    player,
    total: playerActivities[player] ? Object.values(playerActivities[player]).filter(score => score > 0).length : 0
  }));

  const totalRankings = computeRankings(totalActivities, 'total');

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const total = totalActivities[i].total;
    const rankingClass = getRankingClass(total, totalRankings[player]);

    tableHtml += `<td class="level-cell ${rankingClass}" data-player="${player}" data-total="${total}" style="font-size: 1.1em; text-align: center;">${total}</td>`;
  }
  tableHtml += '</tr>';

  tableHtml += '</tbody></table></div>';

  return tableHtml;
}

const TYPE_DISPLAY_NAMES = {
  collection_item: { singular: 'Collection Item', plural: 'Collection Items' },
  activity: { singular: 'Activity', plural: 'Activities' },
  sea_charting: { singular: 'Sea Charting', plural: 'Sea Charting' }
};

function formatTypeName(type, plural) {
  const override = TYPE_DISPLAY_NAMES[type];
  if (override) return plural ? override.plural : override.singular;
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function generateAchievementsTable(achievementsData) {
  if (achievementsData.length === 0) {
    return "<p>No recent achievements found. Check back after more player data is collected!</p>";
  }

  // Generate summary statistics
  const playerStats = {};
  const typeStats = {};
  const majorAchievementsCount = achievementsData.filter(achievement => achievement.isMajorAchievement).length;

  for (const achievement of achievementsData) {
    // Player stats
    if (!playerStats[achievement.player]) {
      playerStats[achievement.player] = { count: 0, displayName: achievement.displayName };
    }
    playerStats[achievement.player].count++;

    // Type stats
    if (!typeStats[achievement.type]) {
      typeStats[achievement.type] = 0;
    }
    typeStats[achievement.type]++;
  }

  let tableHtml = '<div class="sunken-panel" role="region" aria-label="Recent achievements" tabindex="0" style="height: 400px; overflow: auto;">';

  // Summary section
  tableHtml += '<div style="margin-bottom: 20px;">';
  tableHtml += '<h3>Achievement Summary (Last 30 Days)</h3>';

  // Player summary
  tableHtml += '<div style="display: flex; gap: 20px; margin-bottom: 15px;">';
  tableHtml += '<div><strong>By Player:</strong><br>';
  for (const [player, stats] of Object.entries(playerStats)) {
    tableHtml += `${escapeHtml(stats.displayName)}: ${stats.count}<br>`;
  }
  tableHtml += '</div>';

  // Type summary
  tableHtml += '<div><strong>By Type:</strong><br>';
  for (const [type, count] of Object.entries(typeStats)) {
    tableHtml += `${formatTypeName(type, true)}: ${count}<br>`;
  }
  tableHtml += '</div>';
  tableHtml += '</div>';

  tableHtml += '</div>';

  const majorButtonLabel = majorAchievementsCount > 0
    ? `Show Only Major Achievements (${majorAchievementsCount})`
    : 'No Major Achievements Yet';

  tableHtml += '<div class="achievements-controls" style="display: flex; gap: 12px; align-items: center; margin-bottom: 15px;">';
  tableHtml += `<button id="toggle-major-achievements" type="button" data-filter-state="all"${majorAchievementsCount === 0 ? ' disabled' : ''}>${majorButtonLabel}</button>`;
  tableHtml += '<span id="major-achievements-hint" style="font-size: 0.85em; color: #555;">Major achievements cover new level 99 skills and freshly earned quest capes.</span>';
  tableHtml += '</div>';

  // Achievements table
  tableHtml += '<table class="interactive" style="width: 100%;">';

  // Header
  tableHtml += '<thead><tr><th>Player</th><th>Achievement</th><th>Type</th><th>Date</th></tr></thead>';

  // Body
  tableHtml += '<tbody>';
  const now = new Date();
  const nowMs = now.getTime();
  for (const achievement of achievementsData) {
    const ts = new Date(achievement.timestamp);
    const tsMs = ts.getTime();
    const timeDiff = tsMs - new Date(achievement.previousTimestamp).getTime();
    const configuredColor = playerColors[achievement.player];
    const playerColor = /^#[0-9a-f]{6}$/i.test(configuredColor || '') ? configuredColor : '#999999';

    // Consistent row styling - all rows get the same base styling
    let rowStyle = `background-color: ${playerColor}33;`; // 33 for transparency

    // Add subtle border for recent achievements (within 24 hours) without changing text weight
    if (timeDiff < 1000 * 60 * 60 * 24) { // Less than 24 hours
      rowStyle += ` border-left: 4px solid ${playerColor};`;
    }

    const isMajor = achievement.isMajorAchievement === true;

    // Format date as relative time
    const relativeTimeDiff = nowMs - tsMs;
    const minutes = Math.floor(relativeTimeDiff / (1000 * 60));
    const hours = Math.floor(relativeTimeDiff / (1000 * 60 * 60));
    const days = Math.floor(relativeTimeDiff / (1000 * 60 * 60 * 24));

    let dateWithTime;
    if (minutes < 1) {
      dateWithTime = 'Just now';
    } else if (minutes < 60) {
      dateWithTime = `${minutes}min ago`;
    } else if (hours < 24) {
      dateWithTime = `${hours}h ago`;
    } else if (days < 7) {
      dateWithTime = `${days}d ago`;
    } else {
      dateWithTime = ts.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour12: false,
        timeZone: 'Europe/Vilnius'
      });
    }

    tableHtml += `<tr style="${rowStyle}" data-is-major="${isMajor ? 'true' : 'false'}">`;
    tableHtml += `<td><strong style="color: ${playerColor};">${escapeHtml(achievement.displayName)}</strong></td>`;

    // Handle combat achievements with tier icons and links
    if (achievement.type === 'combat' && achievement.tierIconUrl && achievement.nameWikiLink) {
      tableHtml += `<td style="display: flex; align-items: center; gap: 8px;">`;
      tableHtml += `<img src="${safeWikiUrl(achievement.tierIconUrl)}" alt="Tier" width="20" height="20" style="image-rendering: pixelated;">`;
      tableHtml += `<a href="${safeWikiUrl(achievement.nameWikiLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: inherit;" title="${escapeHtml(achievement.description || '')}">${escapeHtml(achievement.name)}</a>`;
      tableHtml += `</td>`;
    }
    // Handle collection log items with item icons and links
    else if (achievement.type === 'collection_item' && achievement.itemIcon && achievement.itemLink) {
      tableHtml += `<td style="display: flex; align-items: center; gap: 8px;">`;
      tableHtml += `<img src="${safeWikiUrl(achievement.itemIcon)}" alt="${escapeHtml(achievement.name)}" width="20" height="20" style="image-rendering: pixelated;" onerror="this.src='https://oldschool.runescape.wiki/images/Bank_filler.png'">`;
      tableHtml += `<a href="${safeWikiUrl(achievement.itemLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: inherit;">${escapeHtml(achievement.name)}</a>`;
      tableHtml += `</td>`;
    } else if (achievement.type === 'activity' && achievement.activityIcon && achievement.activityLink) {
      tableHtml += `<td style="display: flex; align-items: center; gap: 8px;">`;
      tableHtml += `<img src="${safeWikiUrl(achievement.activityIcon)}" alt="${escapeHtml(achievement.name)}" width="20" height="20" style="image-rendering: pixelated;" onerror="this.src='https://oldschool.runescape.wiki/images/Bank_filler.png'">`;
      tableHtml += `<a href="${safeWikiUrl(achievement.activityLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: inherit;">${escapeHtml(achievement.name)}</a>`;
      tableHtml += `</td>`;
    } else if (achievement.type === 'level' && achievement.isMaxLevel) {
      // Highlight level 99 milestones with a golden badge and star
      tableHtml += `<td style="display: flex; align-items: center; gap: 8px;">` +
        `<span title="Level 99!" style="color: #FFD700;">\u2B50</span>` +
        `<span class="badge-99" style="background: #FFD700; color: #000; padding: 2px 6px; border-radius: 3px; font-weight: bold;">99</span>` +
        `<span>${escapeHtml(achievement.name)}</span>` +
        `</td>`;
    } else {
      tableHtml += `<td>${escapeHtml(achievement.name)}</td>`;
    }

    tableHtml += `<td>${formatTypeName(achievement.type, false)}</td>`;
    tableHtml += `<td>${dateWithTime}</td>`;
    tableHtml += '</tr>';
  }
  tableHtml += '</tbody></table></div>';

  return tableHtml;
}

function formatOverviewNumber(value, { compact = false } = {}) {
  if (!Number.isFinite(value)) return '\u2014';
  return new Intl.NumberFormat('en-US', compact ? {
    notation: 'compact',
    maximumFractionDigits: 1
  } : {}).format(value);
}

function formatSnapshotTime(value) {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return 'Snapshot time unavailable';
  return `Snapshot ${timestamp.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Vilnius'
  })}`;
}

function renderPlayerOverview(selectedPlayers = getSelectedPlayers()) {
  const container = document.getElementById('player-overview-container');
  const data = tableData?.playerOverview;
  if (!container || !data) return;

  const players = data.players.filter(player => selectedPlayers.includes(player));
  if (players.length === 0) {
    container.innerHTML = '<p class="empty-panel-message">Select at least one player to see an overview.</p>';
    return;
  }

  const cards = players.map(player => {
    const stats = data.playerStats[player];
    const metrics = [
      ['Total level', formatOverviewNumber(stats.totalLevel)],
      ['Total XP', formatOverviewNumber(stats.totalExperience, { compact: true })],
      ['Quests', `${formatOverviewNumber(stats.completedQuests)}/${formatOverviewNumber(data.totals.quests)}`],
      ['Level 99s', formatOverviewNumber(stats.maxedSkills)],
      ['Collection log', formatOverviewNumber(stats.collectionLog)],
      ['Combat tasks', `${formatOverviewNumber(stats.combatAchievements)}/${formatOverviewNumber(data.totals.combatAchievements)}`]
    ];
    const metricHtml = metrics.map(([label, value]) => `
      <div class="overview-metric">
        <span class="overview-metric-label">${escapeHtml(label)}</span>
        <strong class="overview-metric-value">${escapeHtml(value)}</strong>
      </div>`).join('');

    return `
      <article class="overview-card" style="--player-accent: ${safePlayerColor(player)};" aria-label="${escapeHtml(getDisplayName(player))} overview">
        <header class="overview-card-header">
          <strong>${escapeHtml(getDisplayName(player))}</strong>
          <span>${escapeHtml(formatSnapshotTime(stats.snapshotAt))}</span>
        </header>
        <div class="overview-metrics">${metricHtml}</div>
      </article>`;
  }).join('');

  container.innerHTML = `<div class="overview-grid">${cards}</div>`;
}

function sailingProgressPercentage(completed, total) {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (completed / total) * 100));
}

function sailingProgressBar(completed, total, label) {
  const percentage = sailingProgressPercentage(completed, total);
  return `
    <div class="sailing-progress-track" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${completed}">
      <span style="width: ${percentage.toFixed(2)}%;"></span>
    </div>`;
}

function setSailingExplorerPlayer(player) {
  sailingExplorerPlayer = player;
  renderSeaChartingExplorer(getSelectedPlayers());
  document.getElementById('sailing-explorer-player')?.focus();
}

function setSailingExplorerStatus(status) {
  sailingExplorerStatus = ['all', 'missing', 'completed'].includes(status) ? status : 'missing';
  renderSeaChartingExplorer(getSelectedPlayers());
  document.getElementById('sailing-explorer-status')?.focus();
}

function setSailingExplorerGroup(group) {
  sailingExplorerGroup = group;
  renderSeaChartingExplorer(getSelectedPlayers());
  document.getElementById('sailing-explorer-group')?.focus();
}

function sailingExplorerMarkup(data, player, selectablePlayers) {
  const progress = data.playerProgress[player];
  const allGroups = data.completionGroups.map(group => group.name);
  if (sailingExplorerGroup !== 'all' && !allGroups.includes(sailingExplorerGroup)) {
    sailingExplorerGroup = 'all';
  }

  const groupOptions = data.completionGroups.map(group =>
    `<option value="${escapeHtml(group.name)}" ${group.name === sailingExplorerGroup ? 'selected' : ''}>${escapeHtml(group.name)}</option>`
  ).join('');
  const playerOptions = selectablePlayers.map(playerName =>
    `<option value="${escapeHtml(playerName)}" ${playerName === player ? 'selected' : ''}>${escapeHtml(getDisplayName(playerName))}</option>`
  ).join('');

  const controls = `
    <div class="sailing-explorer-controls">
      <label>Player
        <select id="sailing-explorer-player" onchange="setSailingExplorerPlayer(this.value)">${playerOptions}</select>
      </label>
      <label>Chart area
        <select id="sailing-explorer-group" onchange="setSailingExplorerGroup(this.value)">
          <option value="all" ${sailingExplorerGroup === 'all' ? 'selected' : ''}>All areas</option>
          ${groupOptions}
        </select>
      </label>
      <label>Status
        <select id="sailing-explorer-status" onchange="setSailingExplorerStatus(this.value)">
          <option value="missing" ${sailingExplorerStatus === 'missing' ? 'selected' : ''}>Missing</option>
          <option value="completed" ${sailingExplorerStatus === 'completed' ? 'selected' : ''}>Completed</option>
          <option value="all" ${sailingExplorerStatus === 'all' ? 'selected' : ''}>All</option>
        </select>
      </label>
    </div>`;

  if (!progress?.available) {
    return `${controls}<p class="empty-panel-message">WikiSync has not supplied sea-charting progress for this player yet.</p>`;
  }

  const completed = new Set(progress.completedTaskIds);
  const filteredTasks = data.tasks.filter(task => {
    const groupMatches = sailingExplorerGroup === 'all' || task.completionGroup === sailingExplorerGroup;
    const isCompleted = completed.has(task.taskId);
    const statusMatches = sailingExplorerStatus === 'all'
      || (sailingExplorerStatus === 'completed' && isCompleted)
      || (sailingExplorerStatus === 'missing' && !isCompleted);
    return groupMatches && statusMatches;
  });

  const grouped = new Map();
  for (const task of filteredTasks) {
    if (!grouped.has(task.completionGroup)) grouped.set(task.completionGroup, new Map());
    const seas = grouped.get(task.completionGroup);
    if (!seas.has(task.sea)) seas.set(task.sea, []);
    seas.get(task.sea).push(task);
  }

  const groupOrder = ['Ardent Ocean', 'Unquiet Ocean', 'Shrouded Ocean', 'Western Ocean', 'Northern Ocean', 'Sunset Ocean', 'Miscellaneous'];
  const groupRank = groupName => {
    const index = groupOrder.indexOf(groupName);
    return index === -1 ? groupOrder.length : index;
  };
  const groupHtml = [...grouped.entries()]
    .sort(([left], [right]) => groupRank(left) - groupRank(right) || left.localeCompare(right))
    .map(([groupName, seas]) => {
      const group = data.completionGroups.find(item => item.name === groupName);
      const groupCompleted = group.taskIds.filter(taskId => completed.has(taskId)).length;
      const seaHtml = [...seas.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([seaName, tasks]) => {
        const allSeaTasks = data.tasks.filter(task =>
          task.sea === seaName && task.completionGroup === groupName
        );
        const seaCompleted = allSeaTasks.filter(task => completed.has(task.taskId)).length;
        const seaLink = tasks[0]?.seaWikiLink;
        const taskHtml = tasks.sort((a, b) => a.level - b.level || a.taskId - b.taskId).map(task => {
          const isCompleted = completed.has(task.taskId);
          const details = [
            `Level ${task.level}`,
            task.type,
            task.isBonusChart ? 'Bonus chart' : null,
            task.hazard ? `Hazard: ${task.hazard}` : null
          ].filter(Boolean).join(' \u00b7 ');
          return `
            <li class="sailing-task ${isCompleted ? 'is-complete' : 'is-missing'}">
              <span class="sailing-task-state" aria-hidden="true">${isCompleted ? '\u2713' : '\u25a1'}</span>
              <span>
                <strong>${escapeHtml(details)}</strong>
                <span class="sailing-task-copy">${escapeHtml(task.task)}</span>
                <span class="visually-hidden">${isCompleted ? 'Completed' : 'Missing'}</span>
              </span>
            </li>`;
        }).join('');

        return `
          <details class="sailing-sea-group">
            <summary>
              <span>${escapeHtml(seaName)}</span>
              <strong>${seaCompleted}/${allSeaTasks.length}</strong>
            </summary>
            <div class="sailing-sea-body">
              ${seaLink ? `<a href="${safeWikiUrl(seaLink)}" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(seaName)} on the OSRS Wiki</a>` : ''}
              <ul class="sailing-task-list">${taskHtml}</ul>
            </div>
          </details>`;
      }).join('');

      const groupIsFiltered = sailingExplorerGroup === groupName;
      return `
        <details class="sailing-chart-group" aria-label="${escapeHtml(groupName)} sea-charting progress" ${groupIsFiltered ? 'open' : ''}>
          <summary class="sailing-chart-group-heading">
            <strong class="sailing-chart-group-title">${escapeHtml(groupName)}</strong>
            <span>${groupCompleted}/${group.taskIds.length}</span>
          </summary>
          <div class="sailing-chart-group-body">
            ${sailingProgressBar(groupCompleted, group.taskIds.length, `${groupName}: ${groupCompleted} of ${group.taskIds.length} tasks completed`)}
            ${seaHtml}
          </div>
        </details>`;
    }).join('');

  return `
    ${controls}
    <div class="sailing-explorer-results">
      ${groupHtml || '<p class="empty-panel-message">No charting tasks match these filters.</p>'}
    </div>`;
}

function renderSailingProgress(selectedPlayers = getSelectedPlayers()) {
  const container = document.getElementById('sailing-progress-container');
  const data = tableData?.sailing;
  if (!container || !data) return;

  const players = data.players.filter(player => selectedPlayers.includes(player));
  if (players.length === 0) {
    container.innerHTML = '<p class="empty-panel-message">Select at least one player to see Sailing progress.</p>';
    return;
  }

  const cards = players.map(player => {
    const progress = data.playerProgress[player];
    const completed = progress.available ? progress.completedTaskIds.length : null;
    const charts = completed === null ? 'No WikiSync data' : `${completed}/${data.totalTasks} charted`;
    const unknown = progress.unknownTaskIds.length > 0
      ? `<span class="sailing-metadata-warning">${progress.unknownTaskIds.length} newer task ID${progress.unknownTaskIds.length === 1 ? '' : 's'} awaiting metadata</span>`
      : '';
    return `
      <article class="sailing-player-card" style="--player-accent: ${safePlayerColor(player)};">
        <div class="sailing-player-heading">
          <strong>${escapeHtml(getDisplayName(player))}</strong>
          <span>Sailing ${progress.sailingLevel ?? '\u2014'}</span>
        </div>
        <div class="sailing-player-total">${escapeHtml(charts)}</div>
        ${completed === null ? '' : sailingProgressBar(completed, data.totalTasks, `${getDisplayName(player)}: ${completed} of ${data.totalTasks} sea-charting tasks completed`)}
        ${unknown}
      </article>`;
  }).join('');

  container.innerHTML = `
    <div class="sailing-intro">
      <strong>Fleet progress</strong>
      <span>Latest Sailing level and Captain's log completion across ${data.totalTasks} charts.</span>
      <a href="${safeWikiUrl(data.sourceUrl)}" target="_blank" rel="noopener noreferrer">OSRS Wiki source</a>
    </div>
    <div class="sailing-player-grid">${cards}</div>
    <p class="sailing-data-note">Completion comes from each player's latest WikiSync snapshot; it does not confirm that an island was visited.</p>`;
}

function renderSeaChartingExplorer(selectedPlayers = getSelectedPlayers()) {
  const container = document.getElementById('sea-charting-explorer-container');
  const data = tableData?.sailing;
  if (!container || !data) return;

  const players = data.players.filter(player => selectedPlayers.includes(player));
  if (players.length === 0) {
    container.innerHTML = '<p class="empty-panel-message">Select at least one player to explore sea-charting tasks.</p>';
    return;
  }

  if (!players.includes(sailingExplorerPlayer)) sailingExplorerPlayer = players[0];
  container.innerHTML = `
    <div class="sailing-intro">
      <strong>Captain's log</strong>
      <span>Filter ${data.totalTasks} exact chart tasks by player, completion area and status.</span>
      <a href="${safeWikiUrl(data.sourceUrl)}" target="_blank" rel="noopener noreferrer">OSRS Wiki source</a>
    </div>
    <p class="sailing-data-note">Chart completion is from WikiSync; it is not proof that an island was visited, docked at or unlocked.</p>
    ${sailingExplorerMarkup(data, sailingExplorerPlayer, players)}`;
}

function renderTables() {
  document.getElementById('quest-table-container').innerHTML = generateQuestComparisonTable(tableData.quests);
  document.getElementById('level-table-container').innerHTML = generateLevelComparisonTable(tableData.levels);
  document.getElementById('diary-table-container').innerHTML = generateAchievementDiaryComparisonTable(tableData.achievementDiaries);
  document.getElementById('combat-achievements-table-container').innerHTML = generateCombatAchievementsComparisonTable(tableData.combatAchievements);
  document.getElementById('music-tracks-table-container').innerHTML = generateMusicTracksComparisonTable(tableData.musicTracks, tableData.musicTracksMetadata);
  document.getElementById('collection-log-table-container').innerHTML = generateCollectionLogComparisonTable(tableData.collectionLog);
  document.getElementById('activities-table-container').innerHTML = generateActivitiesComparisonTable(tableData.activities);
  document.getElementById('achievements-table-container').innerHTML = generateAchievementsTable(tableData.achievements);
  renderPlayerOverview();
  renderSailingProgress();
  renderSeaChartingExplorer();
}

function cloneChartData(data) {
  return JSON.parse(JSON.stringify(data));
}

function withResponsiveChartOptions(options) {
  const compact = window.matchMedia('(max-width: 700px)').matches;
  const responsiveOptions = {
    ...options,
    responsive: true,
    maintainAspectRatio: false
  };

  if (!compact) return responsiveOptions;

  responsiveOptions.layout = {
    ...options.layout,
    padding: 0
  };
  responsiveOptions.plugins = {
    ...options.plugins,
    legend: {
      labels: {
        boxWidth: 10,
        boxHeight: 10,
        padding: 8,
        font: { size: 10 }
      }
    }
  };
  responsiveOptions.scales = {
    ...options.scales,
    x: {
      ...options.scales?.x,
      ticks: {
        ...options.scales?.x?.ticks,
        autoSkip: true,
        maxRotation: 0,
        maxTicksLimit: 4
      }
    }
  };
  return responsiveOptions;
}

function initializeCharts() {
  const ctx = document.getElementById('questChart').getContext('2d');
  questChart = new Chart(ctx, {
    type: 'line',
    data: cloneChartData(originalChartData),
    options: withResponsiveChartOptions({
      scales: {
        x: {
          title: {
            display: true,
            text: 'Date'
          }
        },
        y: {
          title: {
            display: true,
            text: 'Quests Completed'
          }
        }
      },
      plugins: {
        decimation: {
          enabled: true,
          algorithm: 'min-max',
          threshold: 100
        }
      }
    })
  });

  const totalLevelCtx = document.getElementById('totalLevelChart').getContext('2d');
  totalLevelChart = new Chart(totalLevelCtx, {
    type: 'line',
    data: cloneChartData(originalTotalLevelChartData),
    options: withResponsiveChartOptions({
      scales: {
        x: {
          title: {
            display: true,
            text: 'Date'
          }
        },
        y: {
          title: {
            display: true,
            text: 'Total Level'
          }
        }
      },
      plugins: {
        decimation: {
          enabled: true,
          algorithm: 'min-max',
          threshold: 100
        }
      }
    })
  });

  const totalExpCtx = document.getElementById('totalExpChart').getContext('2d');
  const initialTotalXpLogScale = loadTotalXpLogScalePreference();
  totalExpChart = new Chart(totalExpCtx, {
    type: 'line',
    data: cloneChartData(originalTotalExpChartData),
    options: withResponsiveChartOptions({
      scales: {
        x: {
          title: {
            display: true,
            text: 'Date'
          }
        },
        y: {
          type: initialTotalXpLogScale ? 'logarithmic' : 'linear',
          title: {
            display: true,
            text: 'Total XP'
          }
        }
      },
      plugins: {
        decimation: {
          enabled: true,
          algorithm: 'min-max',
          threshold: 100
        }
      }
    })
  });

  const skillLevelCtx = document.getElementById('skillLevelChart').getContext('2d');
  skillLevelChart = new Chart(skillLevelCtx, {
    type: 'line',
    data: cloneChartData(originalSkillLevelChartData),
    options: withResponsiveChartOptions({
      scales: {
        x: {
          title: {
            display: true,
            text: 'Date'
          }
        },
        y: {
          title: {
            display: true,
            text: 'Level'
          },
          min: 1,
          max: 99
        }
      },
      plugins: {
        decimation: {
          enabled: true,
          algorithm: 'min-max',
          threshold: 100
        }
      }
    })
  });

  // Apply initial time period filter to all charts
  const selectedPlayers = getSelectedPlayers();
  updateChart(selectedPlayers);
  updateTotalLevelChart(selectedPlayers);
  updateTotalExpChart(selectedPlayers);
  updateSkillLevelChart(selectedPlayers);
}

// Initialize everything and hide loading screen
function initializeApp() {
  // Note: init.js already applies initial states to prevent flashing

  // Render tables from JSON data
  renderTables();
  initializeWindowAccessibility();

  // Initialize charts with loaded data
  initializeCharts();

  // Load all saved states (this will update checkboxes and other UI elements)
  loadWindowOrder();
  loadTimePeriodPreference();
  loadPlayerSelection();
  loadWindowVisibility();

  // Initialize interactive features
  initializeDragAndDrop();
  initializeTotalXpScaleButton();
  initializeAchievementsFilter();

  // Small delay to ensure all DOM updates are applied
  setTimeout(() => {
    // Hide loading screen and show content
    const loadingScreen = document.getElementById('loadingScreen');
    const body = document.body;

    if (loadingScreen) {
      loadingScreen.style.display = 'none';
    }
    body.classList.remove('loading');
  }, 50);
}

async function boot() {
  try {
    await loadAppData();
    initializeApp();
  } catch (error) {
    console.error('Failed to start OSRS Tracker:', error);
    const spinner = document.querySelector('.loading-spinner');
    const message = document.querySelector('.loading-subtext');
    if (spinner) spinner.style.display = 'none';
    if (message) {
      message.textContent = 'Dashboard data could not be loaded. Please refresh after the next tracker update.';
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
