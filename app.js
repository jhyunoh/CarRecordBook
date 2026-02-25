const STORAGE_KEY = "car-records-v1";
const DB_NAME = "car-record-book-db";
const DB_STORE = "records";

const HARDCODED_SYNC_URL = "https://carrecordbook-default-rtdb.firebaseio.com";
const HARDCODED_SYNC_ID = "car";

const CATEGORY_LABELS = {
  fuel: "유류비",
  toll: "통행료",
  maintenance: "정비",
  parking: "주차",
  wash: "세차",
  insurance: "보험",
  other: "기타",
};

const form = document.getElementById("record-form");
const dateInput = document.getElementById("date");
const categoryInput = document.getElementById("category");
const amountInput = document.getElementById("amount");
const mileageInput = document.getElementById("mileage");
const fuelVolumeInput = document.getElementById("fuel-volume");
const pricePerGallonInput = document.getElementById("price-per-gallon");
const memoInput = document.getElementById("memo");
const monthFilterInput = document.getElementById("month-filter");
const submitButton = document.getElementById("submit-button");
const cancelEditButton = document.getElementById("cancel-edit-button");
const exportBackupButton = document.getElementById("export-backup-button");
const importBackupButton = document.getElementById("import-backup-button");
const importBackupFileInput = document.getElementById("import-backup-file");
const storageStatusEl = document.getElementById("storage-status");

const syncStatusEl = document.getElementById("sync-status");

const totalAmountEl = document.getElementById("total-amount");
const monthAmountEl = document.getElementById("month-amount");
const recordCountEl = document.getElementById("record-count");
const recordListEl = document.getElementById("record-list");
const emptyStateEl = document.getElementById("empty-state");
const efficiencyChartEl = document.getElementById("efficiency-chart");
const chartEmptyStateEl = document.getElementById("chart-empty-state");

let records = [];
let editingRecordId = null;
let lastSyncStatusMessage = "";

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function setStorageStatus(message) {
  if (!storageStatusEl) return;
  storageStatusEl.textContent = message;
}

function setSyncStatus(message) {
  if (!syncStatusEl) return;
  if (message === lastSyncStatusMessage) return;
  lastSyncStatusMessage = message;
  syncStatusEl.textContent = message;
}

function normalizeSyncUrl(url) {
  return url.trim().replace(/\/$/, "");
}

function getSyncConfig() {
  return {
    url: normalizeSyncUrl(HARDCODED_SYNC_URL),
    syncId: HARDCODED_SYNC_ID,
  };
}

function isSyncConfigured() {
  const cfg = getSyncConfig();
  return Boolean(cfg.url && cfg.syncId);
}

function getRemotePath() {
  const cfg = getSyncConfig();
  return `${cfg.url}/carRecordSync/${encodeURIComponent(cfg.syncId)}.json`;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

async function readRecordsFromIndexedDB() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const store = tx.objectStore(DB_STORE);
    const request = store.get(STORAGE_KEY);

    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : null);
    request.onerror = () => reject(request.error || new Error("Failed to read IndexedDB"));
    tx.oncomplete = () => db.close();
    tx.onabort = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function writeRecordsToIndexedDB(nextRecords) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    const store = tx.objectStore(DB_STORE);
    store.put(nextRecords, STORAGE_KEY);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction aborted"));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("Failed to write IndexedDB"));
    };
  });
}

async function loadRecords() {
  try {
    const fromDb = await readRecordsFromIndexedDB();
    if (fromDb) return fromDb;
  } catch (error) {
    console.error("Failed to load from IndexedDB:", error);
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const fromLocalStorage = raw ? JSON.parse(raw) : [];
    if (Array.isArray(fromLocalStorage) && fromLocalStorage.length > 0) {
      writeRecordsToIndexedDB(fromLocalStorage).catch((error) => {
        console.error("Failed to migrate data into IndexedDB:", error);
      });
    }
    return Array.isArray(fromLocalStorage) ? fromLocalStorage : [];
  } catch (error) {
    console.error("Failed to load records:", error);
    return [];
  }
}

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  writeRecordsToIndexedDB(records).catch((error) => {
    console.error("Failed to save records to IndexedDB:", error);
    setStorageStatus("저장은 되었지만 영구 저장소 동기화 중 오류가 발생했습니다.");
  });
}

async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persisted || !navigator.storage.persist) {
    setStorageStatus("브라우저 영구 저장소 API를 지원하지 않습니다. 백업 내보내기를 권장합니다.");
    return;
  }

  try {
    const alreadyPersisted = await navigator.storage.persisted();
    if (alreadyPersisted) {
      setStorageStatus("영구 저장소가 활성화되어 데이터 유지 가능성이 높습니다.");
      return;
    }

    const granted = await navigator.storage.persist();
    if (granted) {
      setStorageStatus("영구 저장소가 활성화되었습니다.");
    } else {
      setStorageStatus("영구 저장소 허용이 거부되었습니다. 백업 내보내기를 권장합니다.");
    }
  } catch (error) {
    console.error("Persistent storage request failed:", error);
    setStorageStatus("영구 저장소 상태 확인에 실패했습니다. 백업 내보내기를 권장합니다.");
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function updatePricePerGallonPreview() {
  if (!pricePerGallonInput || !fuelVolumeInput) return;

  const amount = Number(amountInput.value);
  const fuelVolume = Number(fuelVolumeInput.value);

  if (
    !amountInput.value ||
    !fuelVolumeInput.value ||
    Number.isNaN(amount) ||
    Number.isNaN(fuelVolume) ||
    fuelVolume <= 0
  ) {
    pricePerGallonInput.value = "";
    return;
  }

  pricePerGallonInput.value = `${formatCurrency(amount / fuelVolume)}/갤런`;
}

function getLocalDateString() {
  const now = new Date();
  const tzOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

function getCurrentMonth() {
  return getLocalDateString().slice(0, 7);
}

function getSelectedMonth() {
  return monthFilterInput.value || getCurrentMonth();
}

function updateStats() {
  const total = records.reduce((sum, item) => sum + item.amount, 0);
  const selectedMonth = getSelectedMonth();
  const monthTotal = records
    .filter((item) => item.date.startsWith(selectedMonth))
    .reduce((sum, item) => sum + item.amount, 0);

  totalAmountEl.textContent = formatCurrency(total);
  monthAmountEl.textContent = formatCurrency(monthTotal);
  recordCountEl.textContent = `${records.length}`;
}

function sortRecordsDesc(list) {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

function sortRecordsAsc(list) {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? 1 : -1;
    return a.createdAt > b.createdAt ? 1 : -1;
  });
}

function renderMileageGapChart() {
  if (!efficiencyChartEl) return;
  const ctx = efficiencyChartEl.getContext("2d");
  if (!ctx) return;

  const fuelMileageRecords = sortRecordsAsc(records).filter(
    (item) => item.category === "fuel" && item.mileage !== null && item.mileage !== undefined,
  );

  const points = [];
  for (let i = 1; i < fuelMileageRecords.length; i += 1) {
    const prev = fuelMileageRecords[i - 1];
    const curr = fuelMileageRecords[i];
    const deltaMiles = Number(curr.mileage) - Number(prev.mileage);
    if (Number.isFinite(deltaMiles) && deltaMiles > 0) {
      points.push({ date: curr.date, deltaMiles });
    }
  }

  ctx.clearRect(0, 0, efficiencyChartEl.width, efficiencyChartEl.height);
  if (chartEmptyStateEl) chartEmptyStateEl.hidden = points.length > 0;
  if (points.length === 0) return;

  const w = efficiencyChartEl.width;
  const h = efficiencyChartEl.height;
  const left = 52;
  const right = 20;
  const top = 20;
  const bottom = 44;
  const plotW = w - left - right;
  const plotH = h - top - bottom;

  const values = points.map((p) => p.deltaMiles);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const padding = (max - min) * 0.15;
  min -= padding;
  max += padding;

  const xAt = (i) => left + (plotW * i) / Math.max(points.length - 1, 1);
  const yAt = (v) => top + ((max - v) / (max - min)) * plotH;

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = top + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(w - right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#16324f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((point, idx) => {
    const x = xAt(idx);
    const y = yAt(point.deltaMiles);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#16324f";
  points.forEach((point, idx) => {
    const x = xAt(idx);
    const y = yAt(point.deltaMiles);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#475569";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    const value = max - (max - min) * ratio;
    const y = top + plotH * ratio;
    ctx.fillText(value.toFixed(1), left - 8, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const step = Math.max(1, Math.ceil(points.length / 6));
  for (let i = 0; i < points.length; i += step) {
    const x = xAt(i);
    ctx.fillText(points[i].date.slice(5), x, h - bottom + 8);
  }
}

function renderRecords() {
  const ordered = sortRecordsDesc(records);

  recordListEl.innerHTML = "";
  for (const item of ordered) {
    const row = document.createElement("tr");
    row.className = "transition-colors hover:bg-slate-50";
    row.innerHTML = `
      <td class="px-3 py-3 text-center text-[15px] font-semibold text-slate-800 tabular-nums">${item.date}</td>
      <td class="px-3 py-3 text-center text-[15px] font-semibold text-slate-800">${CATEGORY_LABELS[item.category] || item.category}</td>
      <td class="px-3 py-3 text-center text-[15px] font-bold text-slate-900 tabular-nums">${formatCurrency(item.amount)}</td>
      <td class="px-3 py-3 text-center text-[15px] text-slate-800 tabular-nums">${item.fuelVolume ? `${formatNumber(item.fuelVolume)} 갤런` : "-"}</td>
      <td class="px-3 py-3 text-center text-[15px] text-slate-800 tabular-nums">${item.fuelVolume && item.fuelVolume > 0 ? formatCurrency(item.amount / item.fuelVolume) : "-"}</td>
      <td class="px-3 py-3 text-center text-[15px] text-slate-800 tabular-nums">${item.mileage ? `${item.mileage.toLocaleString("en-US")} 마일` : "-"}</td>
      <td class="px-3 py-3 text-center text-[14px] text-slate-500">${item.memo || "-"}</td>
      <td class="px-3 py-3 text-center"><button class="edit inline-flex h-10 min-w-[72px] items-center justify-center whitespace-nowrap rounded-lg border border-slate-300 bg-slate-100 px-4 text-sm font-bold text-slate-700 hover:bg-slate-200" data-id="${item.id}" type="button">수정</button></td>
      <td class="px-3 py-3 text-center"><button class="inline-flex h-10 min-w-[72px] items-center justify-center whitespace-nowrap rounded-lg border border-rose-200 bg-rose-100 px-4 text-sm font-bold text-rose-700 hover:bg-rose-200" data-id="${item.id}" type="button">삭제</button></td>
    `;
    recordListEl.appendChild(row);
  }

  emptyStateEl.hidden = records.length > 0;
  renderMileageGapChart();
}

function resetForm() {
  amountInput.value = "";
  mileageInput.value = "";
  if (fuelVolumeInput) fuelVolumeInput.value = "";
  if (pricePerGallonInput) pricePerGallonInput.value = "";
  memoInput.value = "";
  categoryInput.value = "fuel";
  dateInput.value = getLocalDateString();
}

function startEdit(recordId) {
  const record = records.find((item) => item.id === recordId);
  if (!record) return;

  editingRecordId = record.id;
  dateInput.value = record.date;
  categoryInput.value = record.category;
  amountInput.value = record.amount;
  mileageInput.value = record.mileage ?? "";
  if (fuelVolumeInput) fuelVolumeInput.value = record.fuelVolume ?? "";
  memoInput.value = record.memo || "";
  updatePricePerGallonPreview();

  if (submitButton) submitButton.textContent = "수정 저장";
  if (cancelEditButton) cancelEditButton.hidden = false;
}

function stopEdit() {
  editingRecordId = null;
  if (submitButton) submitButton.textContent = "추가";
  if (cancelEditButton) cancelEditButton.hidden = true;
  resetForm();
  updatePricePerGallonPreview();
}

function isFormBeingEdited() {
  return Boolean(
    editingRecordId ||
      (amountInput && amountInput.value) ||
      (fuelVolumeInput && fuelVolumeInput.value) ||
      (mileageInput && mileageInput.value) ||
      (memoInput && memoInput.value),
  );
}

function normalizeRecord(item) {
  const amount = Number(item.amount);
  const mileage = item.mileage === null || item.mileage === undefined || item.mileage === "" ? null : Number(item.mileage);
  const fuelVolume =
    item.fuelVolume === null || item.fuelVolume === undefined || item.fuelVolume === ""
      ? null
      : Number(item.fuelVolume);
  const updatedAt = item.updatedAt || item.createdAt || nowIso();

  return {
    id: item.id || createId(),
    date: item.date || getLocalDateString(),
    category: item.category || "other",
    amount: Number.isFinite(amount) ? amount : 0,
    mileage: Number.isFinite(mileage) ? mileage : null,
    fuelVolume: Number.isFinite(fuelVolume) ? fuelVolume : null,
    memo: typeof item.memo === "string" ? item.memo : "",
    createdAt: item.createdAt || nowIso(),
    updatedAt,
  };
}

function getLatestRecordTime(recordsList) {
  if (recordsList.length === 0) return "1970-01-01T00:00:00.000Z";
  return recordsList
    .map((item) => item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z")
    .sort()
    .at(-1);
}

async function fetchRemoteSyncData() {
  const response = await fetch(getRemotePath(), { method: "GET" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`동기화 읽기 실패 (${response.status}): ${body.slice(0, 180)}`);
  }
  return response.json();
}

async function pushRemoteSyncData() {
  const payload = {
    records,
    updatedAt: nowIso(),
  };
  const response = await fetch(getRemotePath(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`동기화 쓰기 실패 (${response.status}): ${body.slice(0, 180)}`);
  }
}

async function syncNow(options = {}) {
  const { showProgress = true, showResult = true } = options;

  if (!isSyncConfigured()) {
    setSyncStatus("동기화 설정(Firebase DB URL, 동기화 ID)을 먼저 저장하세요.");
    return;
  }

  if (showProgress) {
    setSyncStatus("동기화 중...");
  }

  try {
    const remote = await fetchRemoteSyncData();
    const remoteRecords = remote && Array.isArray(remote.records) ? remote.records.map(normalizeRecord) : [];

    const localLatest = getLatestRecordTime(records);
    const remoteLatest = remote && remote.updatedAt ? remote.updatedAt : getLatestRecordTime(remoteRecords);

    if (remoteRecords.length > 0 && remoteLatest > localLatest) {
      if (isFormBeingEdited()) {
        setSyncStatus("입력 중이라 클라우드 최신 데이터 자동 반영을 보류했습니다.");
        return;
      }

      records = remoteRecords;
      saveRecords();
      updateStats();
      renderRecords();
      if (showResult) {
        setSyncStatus(`클라우드에서 최신 데이터 반영 완료 (${records.length}건)`);
      }
      return;
    }

    await pushRemoteSyncData();
    if (showResult) {
      setSyncStatus("로컬 최신 데이터가 클라우드에 업로드되었습니다.");
    }
  } catch (error) {
    console.error(error);
    setSyncStatus(error instanceof Error ? error.message : "동기화 실패");
  }
}

function exportBackup() {
  const payload = {
    version: 1,
    exportedAt: nowIso(),
    records,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `car-record-backup-${getLocalDateString()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStorageStatus("백업 파일을 내보냈습니다.");
}

async function importBackupFromFile(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const importedRecords = Array.isArray(parsed) ? parsed : parsed.records;

    if (!Array.isArray(importedRecords)) {
      setStorageStatus("백업 파일 형식이 올바르지 않습니다.");
      return;
    }

    records = importedRecords.map(normalizeRecord);
    saveRecords();
    updateStats();
    renderRecords();
    stopEdit();
    setStorageStatus(`백업 복원 완료: ${records.length}건`);
  } catch (error) {
    console.error("Failed to import backup:", error);
    setStorageStatus("백업 복원에 실패했습니다.");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const amount = Number(amountInput.value);
  const mileage = mileageInput.value ? Number(mileageInput.value) : null;
  const fuelVolumeRaw = fuelVolumeInput ? fuelVolumeInput.value : "";
  const fuelVolume = fuelVolumeRaw ? Number(fuelVolumeRaw) : null;
  const date = dateInput.value;
  const isNewRecord = !editingRecordId;
  const isEditRecord = Boolean(editingRecordId);

  if (
    !date ||
    Number.isNaN(amount) ||
    amount < 0 ||
    (fuelVolumeRaw && (Number.isNaN(fuelVolume) || fuelVolume <= 0))
  ) {
    return;
  }

  if (editingRecordId) {
    records = records.map((item) =>
      item.id === editingRecordId
        ? {
            ...item,
            date,
            category: categoryInput.value,
            amount,
            mileage,
            fuelVolume,
            memo: memoInput.value.trim(),
            updatedAt: nowIso(),
          }
        : item,
    );
  } else {
    const createdAt = nowIso();
    records.push({
      id: createId(),
      date,
      category: categoryInput.value,
      amount,
      mileage,
      fuelVolume,
      memo: memoInput.value.trim(),
      createdAt,
      updatedAt: createdAt,
    });
  }

  saveRecords();
  updateStats();
  renderRecords();
  stopEdit();

  if ((isNewRecord || isEditRecord) && isSyncConfigured()) {
    syncNow({ showProgress: false, showResult: true }).catch((error) => {
      console.error(error);
      setSyncStatus(isNewRecord ? "신규 입력 동기화 실패" : "수정 동기화 실패");
    });
  }
});

recordListEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.dataset.id) return;

  if (target.classList.contains("edit")) {
    startEdit(target.dataset.id);
    return;
  }

  records = records.filter((item) => item.id !== target.dataset.id);
  if (editingRecordId === target.dataset.id) stopEdit();
  saveRecords();
  updateStats();
  renderRecords();

  if (isSyncConfigured()) {
    syncNow({ showProgress: false, showResult: true }).catch((error) => {
      console.error(error);
      setSyncStatus("삭제 동기화 실패");
    });
  }
});

monthFilterInput.addEventListener("change", updateStats);
amountInput.addEventListener("input", updatePricePerGallonPreview);
if (fuelVolumeInput) fuelVolumeInput.addEventListener("input", updatePricePerGallonPreview);
if (cancelEditButton) cancelEditButton.addEventListener("click", stopEdit);

if (exportBackupButton) exportBackupButton.addEventListener("click", exportBackup);
if (importBackupButton && importBackupFileInput) {
  importBackupButton.addEventListener("click", () => importBackupFileInput.click());
  importBackupFileInput.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const [file] = target.files || [];
    await importBackupFromFile(file);
    target.value = "";
  });
}

async function initializeApp() {
  monthFilterInput.value = getCurrentMonth();
  resetForm();
  updatePricePerGallonPreview();

  records = (await loadRecords()).map(normalizeRecord);
  updateStats();
  renderRecords();

  await requestPersistentStorage();

  if (isSyncConfigured()) {
    await syncNow({ showProgress: false, showResult: false });
  } else {
    setSyncStatus("동기화 설정이 올바르지 않습니다.");
  }
}

initializeApp().catch((error) => {
  console.error("App initialization failed:", error);
  setStorageStatus("초기화 중 문제가 발생했습니다. 페이지를 새로고침해 주세요.");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("Service Worker registration failed:", error);
    });
  });
}
