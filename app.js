const STORAGE_KEY = "elevator_ads_map_points_v2_yandex";
const OLD_STORAGE_KEY = "elevator_ads_map_points_v1";
const ORENBURG_CENTER = [51.7682, 55.0969];
const ORENBURG_BOUNDS = [
  [51.58, 54.72],
  [51.98, 55.52]
];

const STATUS = {
  PLACED: "placed",
  NOT_PLACED: "not_placed"
};

let map = null;
let points = [];
let markers = new Map();
let clickAddMode = false;
let manualCoords = null;
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

if (window.ymaps) {
  ymaps.ready(init, onYandexMapError);
} else {
  onYandexMapError();
}

function init() {
  map = new ymaps.Map("map", {
    center: ORENBURG_CENTER,
    zoom: 12,
    controls: ["zoomControl", "typeSelector", "fullscreenControl"]
  }, {
    suppressMapOpenBlock: true,
    yandexMapDisablePoiInteractivity: false
  });

  points = loadPoints();
  bindEvents();
  renderAll();
  fitMapToPointsIfNeeded();
}

function bindEvents() {
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

  map.events.add("click", onMapClick);
}

function onYandexMapError() {
  console.error("Yandex Maps API failed to load.");
  showToast("Не удалось загрузить Яндекс.Карты. Проверь интернет и API-ключ.");
}

function loadPoints() {
  const defaultPoints = normalizePoints(window.DEFAULT_POINTS || []);
  const savedRaw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(OLD_STORAGE_KEY);

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
    map.geoObjects.remove(marker);
  }
  markers.clear();

  for (const point of points) {
    const marker = new ymaps.Placemark(
      [point.lat, point.lng],
      {
        hintContent: point.address,
        balloonContent: makePopupHtml(point)
      },
      {
        preset: "islands#circleDotIcon",
        iconColor: point.status === STATUS.PLACED ? "#28d17c" : "#8b95a7",
        balloonPanelMaxMapArea: 0
      }
    );

    map.geoObjects.add(marker);
    markers.set(point.id, marker);
  }
}

function makePopupHtml(point) {
  const badgeClass = point.status === STATUS.PLACED ? "badge--placed" : "badge--not";
  const statusText = getStatusText(point.status);

  return `
    <div class="popup-card">
      <h3>${escapeHtml(point.address)}</h3>
      <p>Статус: <span class="badge ${badgeClass}">${statusText}</span></p>

      <div class="popup-actions">
        <button type="button" onclick="setPointStatus('${escapeJs(point.id)}', '${STATUS.PLACED}')">
          Размещена
        </button>
        <button class="ghost-button" type="button" onclick="setPointStatus('${escapeJs(point.id)}', '${STATUS.NOT_PLACED}')">
          Не размещена
        </button>
        <button class="popup-delete" type="button" onclick="deletePoint('${escapeJs(point.id)}')">
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
        <button class="address-item" type="button" data-id="${escapeHtml(point.id)}">
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

  if (!point || !marker || !map) return;

  map.setCenter([point.lat, point.lng], Math.max(map.getZoom(), 16), {
    duration: 300
  });

  setTimeout(() => marker.balloon.open(), 320);
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
    map.setCenter([result.lat, result.lng], 16, { duration: 300 });
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

  const result = await ymaps.geocode(query, {
    results: 1,
    boundedBy: ORENBURG_BOUNDS,
    strictBounds: false
  });

  const firstGeoObject = result.geoObjects.get(0);
  if (!firstGeoObject) return null;

  const coords = firstGeoObject.geometry.getCoordinates();
  const address =
    typeof firstGeoObject.getAddressLine === "function"
      ? firstGeoObject.getAddressLine()
      : firstGeoObject.properties.get("text") || query;

  return {
    address,
    lat: Number(coords[0]),
    lng: Number(coords[1])
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

  manualCoords = event.get("coords");
  openManualModal(manualCoords);
}

function openManualModal(coords) {
  els.manualCoords.textContent = `Координаты: ${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`;
  els.manualAddressInput.value = "";
  els.manualModal.classList.remove("hidden");

  setTimeout(() => els.manualAddressInput.focus(), 50);
}

function closeManualModal() {
  els.manualModal.classList.add("hidden");
  manualCoords = null;
}

function saveManualPoint() {
  if (!manualCoords) return;

  const address = els.manualAddressInput.value.trim();
  if (!address) {
    showToast("Введи адрес для точки.");
    return;
  }

  addPoint({
    address: /оренбург/i.test(address) ? address : `Оренбург, ${address}`,
    lat: manualCoords[0],
    lng: manualCoords[1]
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

  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    showToast("Не удалось определить координаты точки.");
    return;
  }

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
  if (map) map.balloon.close();
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
      fitMapToPointsIfNeeded(true);

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

function fitMapToPointsIfNeeded(force = false) {
  if (!map || points.length === 0) return;

  if (points.length === 1) {
    if (force) focusPoint(points[0].id);
    return;
  }

  if (force || points.length > 1) {
    const bounds = ymaps.util.bounds.fromPoints(points.map((point) => [point.lat, point.lng]));
    map.setBounds(bounds, {
      checkZoomRange: true,
      zoomMargin: [80, 80, 80, 80]
    });
  }
}

function locateUser() {
  if (!navigator.geolocation) {
    showToast("Геолокация не поддерживается браузером.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const coords = [position.coords.latitude, position.coords.longitude];
      map.setCenter(coords, 16, { duration: 300 });
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

function escapeJs(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}
