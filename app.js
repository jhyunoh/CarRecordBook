const STORAGE_KEY = "car-records-v1";
const DB_NAME = "car-record-book-db";
const DB_STORE = "records";

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

const totalAmountEl = document.getElementById("total-amount");
const monthAmountEl = document.getElementById("month-amount");
const recordCountEl = document.getElementById("record-count");
const recordListEl = document.getElementById("record-list");
const emptyStateEl = document.getElementById("empty-state");
const efficiencyChartEl = document.getElementById("efficiency-chart");
const chartEmptyStateEl = document.getElementById("chart-empty-state");

let records = [];
let editingRecordId = null;

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setStorageStatus(message) {
  if (!storageStatusEl) return;
  storageStatusEl.textContent = message;
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
    if (fromDb) {
      return fromDb;
    }
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

function renderEfficiencyChart() {
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
      points.push({
        date: curr.date,
        deltaMiles,
      });
    }
  }

  ctx.clearRect(0, 0, efficiencyChartEl.width, efficiencyChartEl.height);

  if (chartEmptyStateEl) {
    chartEmptyStateEl.hidden = points.length > 0;
  }
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
    const label = points[i].date.slice(5);
    ctx.fillText(label, x, h - bottom + 8);
  }
}

function renderRecords() {
  const ordered = sortRecordsDesc(records);

  recordListEl.innerHTML = "";
  for (const item of ordered) {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${item.date}</td>
      <td>${CATEGORY_LABELS[item.category] || item.category}</td>
      <td>${formatCurrency(item.amount)}</td>
      <td>${item.fuelVolume ? `${formatNumber(item.fuelVolume)} 갤런` : "-"}</td>
      <td>${
        item.fuelVolume && item.fuelVolume > 0 ? formatCurrency(item.amount / item.fuelVolume) : "-"
      }</td>
      <td>${item.mileage ? `${item.mileage.toLocaleString("en-US")} 마일` : "-"}</td>
      <td>${item.memo || "-"}</td>
      <td><button class="secondary edit" data-id="${item.id}" type="button">수정</button></td>
      <td><button class="danger" data-id="${item.id}" type="button">삭제</button></td>
    `;
    recordListEl.appendChild(row);
  }

  emptyStateEl.hidden = records.length > 0;
  renderEfficiencyChart();
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

function normalizeRecord(item) {
  const amount = Number(item.amount);
  const mileage = item.mileage === null || item.mileage === undefined || item.mileage === "" ? null : Number(item.mileage);
  const fuelVolume =
    item.fuelVolume === null || item.fuelVolume === undefined || item.fuelVolume === ""
      ? null
      : Number(item.fuelVolume);

  return {
    id: item.id || createId(),
    date: item.date || getLocalDateString(),
    category: item.category || "other",
    amount: Number.isFinite(amount) ? amount : 0,
    mileage: Number.isFinite(mileage) ? mileage : null,
    fuelVolume: Number.isFinite(fuelVolume) ? fuelVolume : null,
    memo: typeof item.memo === "string" ? item.memo : "",
    createdAt: item.createdAt || new Date().toISOString(),
  };
}

function exportBackup() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    records,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const dateStamp = getLocalDateString();
  anchor.href = url;
  anchor.download = `car-record-backup-${dateStamp}.json`;
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
          }
        : item,
    );
  } else {
    records.push({
      id: createId(),
      date,
      category: categoryInput.value,
      amount,
      mileage,
      fuelVolume,
      memo: memoInput.value.trim(),
      createdAt: new Date().toISOString(),
    });
  }

  saveRecords();
  updateStats();
  renderRecords();
  stopEdit();
});

recordListEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.dataset.id) return;

  if (target.classList.contains("edit")) {
    startEdit(target.dataset.id);
    return;
  }

  records = records.filter((item) => item.id !== target.dataset.id);
  if (editingRecordId === target.dataset.id) {
    stopEdit();
  }
  saveRecords();
  updateStats();
  renderRecords();
});

monthFilterInput.addEventListener("change", updateStats);
amountInput.addEventListener("input", updatePricePerGallonPreview);
if (fuelVolumeInput) {
  fuelVolumeInput.addEventListener("input", updatePricePerGallonPreview);
}
if (cancelEditButton) {
  cancelEditButton.addEventListener("click", stopEdit);
}
if (exportBackupButton) {
  exportBackupButton.addEventListener("click", exportBackup);
}
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
