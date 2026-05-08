const STORAGE_KEY = "elevator_ads_map_points_v1";
const ORENBURG_CENTER = [51.7682, 55.0969];

const STATUS = {
  PLACED: "placed",
  NOT_PLACED: "not_placed"
};

let points = [];
let markers = new Map();
let clickAddMode = false;
let manualLatLng = null;
let toastTimer = null;

const els = {
  addForm: document.getElementById("add-form"),
  addressInput: document.getElementById("address-input"),
  clickAddBtn: document.getElementById("click-add-btn"),
  addHint: document.getElementById("add-hint"),
  totalCount: document.getElementById("total-count"),
  placedCount: document.getElementById("placed-count"),
  notPlacedCount: document.getElementById("not-placed-count"),
  filterSelect: document.getElementById("filter-select"),
  searchInput: document.getElementById("search-input"),
  addressList: document.getElementById("address-list"),
  resetStatusesBtn: document.getElementById("reset-statuses-btn"),
  exportBtn: document.getElementById("export-btn"),
  importInput: document.getElementById("import-input"),
  locateBtn: document.getElementById("locate-btn"),
  manualModal: document.getElementById("manual-modal"),
  manualCoords: document.getElementById("manual-coords"),
  manualAddressInput: document.getElementById("manual-address-input"),
  manualSaveBtn: document.getElementById("manual-save-btn"),
  manualCancelBtn: document.getElementById("manual-cancel-btn"),
  modalClose: document.getElementById("modal-close"),
  toast: document.getElementById("toast")
};

const map = L.map("map", {
  zoomControl: true
}).setView(ORENBURG_CENTER, 12);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap"
}).addTo(map);

init();

function init() {
  points = loadPoints();
  renderAll();

  els.addForm.addEventListener("submit", onAddAddressSubmit);
  els.clickAddBtn.addEventListener("click", toggleClickAddMode);
  els.filterSelect.addEventListener("change", renderList);
  els.searchInput.addEventListener("input", renderList);
  els.resetStatusesBtn.addEventListener("click", resetStatuses);
  els.exportBtn.addEventListener("click", exportJson);
  els.importInput.addEventListener("change", importJson);
  els.locateBtn.addEventListener("click", locateUser);

  els.manualSaveBtn.addEventListener("click", saveManualPoint);
  els.manualCancelBtn.addEventListener("click", closeManualModal);
  els.modalClose.addEventListener("click", closeManualModal);

  map.on("click", onMapClick);
}

function loadPoints() {
  const defaultPoints = normalizePoints(window.DEFAULT_POINTS || []);
  const savedRaw = localStorage.getItem(STORAGE_KEY);

  if (!savedRaw) {
    return defaultPoints;
  }

  try {
    const savedPoints = normalizePoints(JSON.parse(savedRaw));
    const savedById = new Map(savedPoints.map((point) => [point.id, point]));

    // Если потом добавишь новые точки в points.js, они появятся, даже если localStorage уже есть.
    for (const point of defaultPoints) {
      if (!savedById.has(point.id)) {
        savedPoints.push(point);
      }
    }

    return savedPoints;
  } catch (error) {
    console.error(error);
    showToast("Не удалось прочитать сохранённые данные. Загружен пустой список.");
    return defaultPoints;
  }
}

function normalizePoints(rawPoints) {
  if (!Array.isArray(rawPoints)) return [];

  return rawPoints
    .map((point, index) => ({
      id: String(point.id || `point-${Date.now()}-${index}`),
      address: String(point.address || "Без адреса").trim(),
      lat: Number(point.lat),
      lng: Number(point.lng),
      status: point.status === STATUS.PLACED ? STATUS.PLACED : STATUS.NOT_PLACED,
      createdAt: point.createdAt || new Date().toISOString(),
      updatedAt: point.updatedAt || new Date().toISOString()
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function savePoints() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(points, null, 2));
}

function renderAll() {
  renderMarkers();
  renderStats();
  renderList();
}

function renderMarkers() {
  for (const marker of markers.values()) {
    marker.remove();
  }
  markers.clear();

  for (const point of points) {
    const marker = L.marker([point.lat, point.lng], {
      icon: makeIcon(point.status)
    }).addTo(map);

    marker.bindPopup(makePopupHtml(point));
    markers.set(point.id, marker);
  }
}

function makeIcon(status) {
  const className =
    status === STATUS.PLACED
      ? "marker-dot marker-dot--placed"
      : "marker-dot marker-dot--not";

  return L.divIcon({
    className: "",
    html: `<div class="${className}"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -12]
  });
}

function makePopupHtml(point) {
  const badgeClass = point.status === STATUS.PLACED ? "badge--placed" : "badge--not";
  const statusText = getStatusText(point.status);

  return `
    <div class="popup-card">
      <h3>${escapeHtml(point.address)}</h3>
      <p>Статус: <span class="badge ${badgeClass}">${statusText}</span></p>

      <div class="popup-actions">
        <button type="button" onclick="setPointStatus('${point.id}', '${STATUS.PLACED}')">
          Размещена
        </button>
        <button class="ghost-button" type="button" onclick="setPointStatus('${point.id}', '${STATUS.NOT_PLACED}')">
          Не размещена
        </button>
        <button class="popup-delete" type="button" onclick="deletePoint('${point.id}')">
          Удалить точку
        </button>
      </div>
    </div>
  `;
}

function renderStats() {
  const placed = points.filter((point) => point.status === STATUS.PLACED).length;
  const notPlaced = points.length - placed;

  els.totalCount.textContent = points.length;
  els.placedCount.textContent = placed;
  els.notPlacedCount.textContent = notPlaced;
}

function renderList() {
  const filter = els.filterSelect.value;
  const search = els.searchInput.value.trim().toLowerCase();

  const filtered = points
    .filter((point) => filter === "all" || point.status === filter)
    .filter((point) => point.address.toLowerCase().includes(search))
    .sort((a, b) => a.address.localeCompare(b.address, "ru"));

  if (filtered.length === 0) {
    els.addressList.innerHTML = `<div class="empty">Адресов пока нет</div>`;
    return;
  }

  els.addressList.innerHTML = filtered
    .map((point) => {
      const badgeClass = point.status === STATUS.PLACED ? "badge--placed" : "badge--not";

      return `
        <button class="address-item" type="button" data-id="${point.id}">
          <span class="address-item__top">
            <strong>${escapeHtml(point.address)}</strong>
            <span class="badge ${badgeClass}">${getStatusText(point.status)}</span>
          </span>
          <small>${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}</small>
        </button>
      `;
    })
    .join("");

  els.addressList.querySelectorAll(".address-item").forEach((button) => {
    button.addEventListener("click", () => focusPoint(button.dataset.id));
  });
}

function focusPoint(id) {
  const point = points.find((item) => item.id === id);
  const marker = markers.get(id);

  if (!point || !marker) return;

  map.setView([point.lat, point.lng], Math.max(map.getZoom(), 16), {
    animate: true
  });
  marker.openPopup();
}

async function onAddAddressSubmit(event) {
  event.preventDefault();

  const rawAddress = els.addressInput.value.trim();
  if (!rawAddress) {
    showToast("Введи адрес.");
    return;
  }

  const button = els.addForm.querySelector("button");
  setButtonLoading(button, true, "Ищу...");

  try {
    const result = await geocodeAddress(rawAddress);

    if (!result) {
      showToast("Адрес не найден. Можно поставить точку кликом по карте.");
      return;
    }

    addPoint({
      address: result.address,
      lat: result.lat,
      lng: result.lng
    });

    els.addressInput.value = "";
    map.setView([result.lat, result.lng], 16);
    showToast("Адрес добавлен.");
  } catch (error) {
    console.error(error);
    showToast("Не удалось найти адрес. Проверь интернет или поставь точку кликом.");
  } finally {
    setButtonLoading(button, false);
  }
}

async function geocodeAddress(rawAddress) {
  const query = /оренбург/i.test(rawAddress)
    ? rawAddress
    : `Оренбург, ${rawAddress}`;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ru");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Geocoding failed");
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  const item = data[0];

  return {
    address: item.display_name || query,
    lat: Number(item.lat),
    lng: Number(item.lon)
  };
}

function toggleClickAddMode() {
  clickAddMode = !clickAddMode;
  els.clickAddBtn.textContent = clickAddMode
    ? "Отменить добавление кликом"
    : "Поставить точку кликом по карте";

  els.addHint.classList.toggle("hidden", !clickAddMode);
  document.body.classList.toggle("is-click-add-mode", clickAddMode);
}

function onMapClick(event) {
  if (!clickAddMode) return;

  manualLatLng = event.latlng;
  openManualModal(event.latlng);
}

function openManualModal(latlng) {
  els.manualCoords.textContent = `Координаты: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
  els.manualAddressInput.value = "";
  els.manualModal.classList.remove("hidden");

  setTimeout(() => els.manualAddressInput.focus(), 50);
}

function closeManualModal() {
  els.manualModal.classList.add("hidden");
  manualLatLng = null;
}

function saveManualPoint() {
  if (!manualLatLng) return;

  const address = els.manualAddressInput.value.trim();
  if (!address) {
    showToast("Введи адрес для точки.");
    return;
  }

  addPoint({
    address: /оренбург/i.test(address) ? address : `Оренбург, ${address}`,
    lat: manualLatLng.lat,
    lng: manualLatLng.lng
  });

  closeManualModal();

  if (clickAddMode) {
    toggleClickAddMode();
  }

  showToast("Точка добавлена.");
}

function addPoint({ address, lat, lng }) {
  const point = {
    id: makeId(address),
    address,
    lat: Number(lat),
    lng: Number(lng),
    status: STATUS.NOT_PLACED,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  points.push(point);
  savePoints();
  renderAll();
  focusPoint(point.id);
}

function makeId(address) {
  const slug = address
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

  return `${slug || "point"}-${Date.now()}`;
}

window.setPointStatus = function setPointStatus(id, status) {
  const point = points.find((item) => item.id === id);
  if (!point) return;

  point.status = status === STATUS.PLACED ? STATUS.PLACED : STATUS.NOT_PLACED;
  point.updatedAt = new Date().toISOString();

  savePoints();
  renderAll();
  focusPoint(id);
  showToast(`Статус изменён: ${getStatusText(point.status)}.`);
};

window.deletePoint = function deletePoint(id) {
  const point = points.find((item) => item.id === id);
  if (!point) return;

  const ok = confirm(`Удалить точку?\n\n${point.address}`);
  if (!ok) return;

  points = points.filter((item) => item.id !== id);
  savePoints();
  renderAll();
  map.closePopup();
  showToast("Точка удалена.");
};

function resetStatuses() {
  if (points.length === 0) {
    showToast("Сбрасывать нечего.");
    return;
  }

  const ok = confirm("Сбросить все отметки? Все адреса останутся, но статусы станут «Не размещена».");
  if (!ok) return;

  points = points.map((point) => ({
    ...point,
    status: STATUS.NOT_PLACED,
    updatedAt: new Date().toISOString()
  }));

  savePoints();
  renderAll();
  showToast("Все отметки сброшены.");
}

function exportJson() {
  const payload = JSON.stringify(points, null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.href = url;
  link.download = `elevator-ads-map-${date}.json`;
  link.click();

  URL.revokeObjectURL(url);
  showToast("JSON экспортирован.");
}

function importJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const imported = normalizePoints(JSON.parse(String(reader.result)));

      if (imported.length === 0) {
        showToast("В JSON не найдено точек.");
        return;
      }

      const ok = confirm(`Импортировать ${imported.length} точек? Текущий список будет заменён.`);
      if (!ok) return;

      points = imported;
      savePoints();
      renderAll();

      const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng]));
      map.fitBounds(bounds.pad(0.18));

      showToast("JSON импортирован.");
    } catch (error) {
      console.error(error);
      showToast("Не удалось импортировать JSON.");
    } finally {
      els.importInput.value = "";
    }
  };

  reader.readAsText(file);
}

function locateUser() {
  if (!navigator.geolocation) {
    showToast("Геолокация не поддерживается браузером.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const latlng = [position.coords.latitude, position.coords.longitude];
      map.setView(latlng, 16);
      showToast("Карта перемещена к твоему местоположению.");
    },
    () => {
      showToast("Не удалось получить местоположение.");
    },
    {
      enableHighAccuracy: true,
      timeout: 8000
    }
  );
}

function setButtonLoading(button, isLoading, text = "") {
  if (!button) return;

  if (isLoading) {
    button.dataset.defaultText = button.textContent;
    button.textContent = text || "Загрузка...";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.defaultText || button.textContent;
    button.disabled = false;
  }
}

function getStatusText(status) {
  return status === STATUS.PLACED ? "Размещена" : "Не размещена";
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");

  toastTimer = setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2800);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
