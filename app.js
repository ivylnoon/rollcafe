    const API_BASE = "https://stalica.net/colorapi89167236746237642364872aBACcc/index.php";
    const PAGE_SIZE = 50000;
    const MAX_ZOOM = 18;
    const MIN_ZOOM = 1;
    const FALLBACK_LIMIT = 50000;
    const MAX_MAP_CELLS = 1_000_000;
    const MAX_RENDERED_TILES = 6000;
    const $ = (id) => document.getElementById(id);
    const stage = $("map-stage");
    const mapTiles = $("map-tiles");
    const mapPoster = $("map-poster");
    const totalCountLabel = $("total-count");
    const archiveState = $("archive-state");
    const progressLabel = $("progress-label");
    const progressPercent = $("progress-percent");
    const progressFill = $("progress-fill");
    const mapMessage = $("map-message");
    const hexInput = $("hex-input");
    const colorPicker = $("color-picker");
    const hoverCard = $("hover-card");
    const hoverSwatch = $("hover-swatch");
    const hoverHex = $("hover-hex");
    const hoverMeta = $("hover-meta");
    const focusMarker = $("map-focus");
    const tierFilter = $("tier-filter");
    const zoomLabel = $("zoom-value");

    let gridSide = 1;
    let totalDrops = 0;
    let sampledCells = 0;
    let sampleStride = 1;
    let loadedCells = 0;
    let colorsRGB = new Uint8Array(0);
    let tiersData = new Uint8Array(0);
    let usernamesData = [];
    let cursor = "0";
    let recordIndex = 0;
    let archiveDropsForSearch = null;
    let hasMore = false;
    let isLoading = false;
    let isPaused = false;
    let sourceMode = "paged";
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let focusIndex = -1;
    let selectedIndex = -1;
    let hoverIndex = -1;
    let dragStart = null;
    let dragged = false;
    let pinchStart = null;
    let suppressClick = false;
    let renderTimer = 0;
    const activePointers = new Map();

    const tierName = (code) => code === 8 ? "Prime" : code > 0 ? `Tier ${code}` : "Color drop";
    const number = (value) => new Intl.NumberFormat("en-US").format(value);

    function setMessage(text = "", isError = false) {
      mapMessage.textContent = text;
      mapMessage.hidden = !text;
      mapMessage.classList.toggle("error", isError);
      if (isError) $("map-error").textContent = text;
    }

    function setStatus(text) {
      archiveState.textContent = text;
    }

    function updateProgress() {
      const displayTotal = sampledCells;
      const loadingNotice = $("map-loading");
      if (loadingNotice) loadingNotice.hidden = loadedCells > 0 || totalDrops === 0;
      const percent = displayTotal ? Math.min(100, Math.floor((loadedCells / displayTotal) * 100)) : (hasMore ? 0 : 100);
      progressFill.style.width = `${percent}%`;
      progressPercent.textContent = `${percent}%`;
      progressLabel.textContent = totalDrops === 0
        ? "Waiting for the first color drop"
        : `Loaded ${number(loadedCells)} of ${number(displayTotal)} map tiles`;
      totalCountLabel.textContent = `${number(totalDrops)} color ${totalDrops === 1 ? "drop" : "drops"}`;
      if (sampleStride > 1) {
        $("sample-label").textContent = "Map view adapted for this device";
      } else {
        $("sample-label").textContent = "Map ready";
      }
    }

    function initMapData(total) {
      const memory = Number(navigator.deviceMemory || 8);
      const maxCells = memory <= 4 ? 500_000 : MAX_MAP_CELLS;
      sampleStride = total > maxCells ? Math.ceil(total / maxCells) : 1;
      sampledCells = total ? Math.ceil(total / sampleStride) : 0;
      gridSide = Math.max(1, Math.ceil(Math.sqrt(sampledCells)));
      colorsRGB = new Uint8Array(sampledCells * 3);
      tiersData = new Uint8Array(sampledCells);
      usernamesData = new Array(sampledCells);
      drawMap(true);
      if (sampleStride > 1) {
        setMessage("Large map: showing a sampled view on this device.");
      }
      updateProgress();
    }

    function clampView() {
      const width = stage.clientWidth || 1;
      const height = stage.clientHeight || 1;
      panX = Math.max(width * (1 - zoom), Math.min(0, panX));
      panY = Math.max(height * (1 - zoom), Math.min(0, panY));
    }

    function renderTiles() {
      if (!loadedCells || !stage.clientWidth || !stage.clientHeight) return;
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      const cellWidth = width / gridSide;
      const cellHeight = height / gridSide;
      const left = Math.max(0, (-panX / zoom - width / zoom) / cellWidth);
      const right = Math.min(gridSide, ((width - panX) / zoom + width / zoom) / cellWidth);
      const top = Math.max(0, (-panY / zoom - height / zoom) / cellHeight);
      const bottom = Math.min(gridSide, ((height - panY) / zoom + height / zoom) / cellHeight);
      const visibleCells = Math.max(1, (right - left) * (bottom - top));
      const stride = Math.max(1, Math.ceil(Math.sqrt(visibleCells / MAX_RENDERED_TILES)));
      const firstColumn = Math.floor(left / stride) * stride;
      const firstRow = Math.floor(top / stride) * stride;
      const selectedTier = Number(tierFilter.value || 0);
      const fragment = document.createDocumentFragment();

      for (let row = firstRow; row < bottom; row += stride) {
        for (let column = firstColumn; column < right; column += stride) {
          const index = row * gridSide + column;
          if (index >= loadedCells) continue;
          const tile = document.createElement("div");
          tile.className = "map-tile";
          tile.style.left = `${column / gridSide * 100}%`;
          tile.style.top = `${row / gridSide * 100}%`;
          tile.style.width = `${Math.min(stride, gridSide - column) / gridSide * 100}%`;
          tile.style.height = `${Math.min(stride, gridSide - row) / gridSide * 100}%`;
          tile.style.backgroundColor = hexAt(index);
          if (selectedTier && tierAt(index) !== selectedTier) tile.style.opacity = "0.07";
          fragment.appendChild(tile);
        }
      }

      mapTiles.replaceChildren(fragment);
      stage.classList.toggle("has-map-data", loadedCells > 0);
    }

    function drawMap(immediate = false) {
      const transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      mapTiles.style.transform = transform;
      mapPoster.style.transform = transform;
      zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
      updateFocusMarker();
      window.clearTimeout(renderTimer);
      if (immediate) {
        renderTiles();
      } else {
        renderTimer = window.setTimeout(renderTiles, 100);
      }
    }

    function applyView() {
      clampView();
      drawMap();
    }

    function zoomAt(x, y, factor) {
      const worldX = (x - panX) / zoom;
      const worldY = (y - panY) / zoom;
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      panX = x - worldX * zoom;
      panY = y - worldY * zoom;
      applyView();
    }

    function setZoomAt(x, y, nextZoom, worldX, worldY) {
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
      panX = x - worldX * zoom;
      panY = y - worldY * zoom;
      applyView();
    }

    function uploadPage(items) {
      if (!items.length) return;
      const count = Math.min(items.length, sampledCells - loadedCells);
      if (count <= 0) return;
      const firstIndex = loadedCells;
      for (let itemIndex = 0; itemIndex < count; itemIndex++) {
        const item = items[itemIndex];
        const hex = typeof item === "string" ? item.slice(0, 6) : String(item.hex || "000000").replace(/^#/, "").slice(0, 6);
        const tierCode = typeof item === "string" ? Number(item.slice(6, 7)) || 0 : (item.tier === "Prime" ? 8 : Number(String(item.tier || "").replace("Tier ", "")) || 0);
        const username = typeof item === "string" ? "" : String(item.username || "").trim();
        const rgbOffset = (firstIndex + itemIndex) * 3;
        const r = Number.parseInt(hex.slice(0, 2), 16) || 0;
        const g = Number.parseInt(hex.slice(2, 4), 16) || 0;
        const b = Number.parseInt(hex.slice(4, 6), 16) || 0;
        colorsRGB[rgbOffset] = r; colorsRGB[rgbOffset + 1] = g; colorsRGB[rgbOffset + 2] = b;
        tiersData[firstIndex + itemIndex] = tierCode;
        usernamesData[firstIndex + itemIndex] = username || "Unknown user";
      }

      loadedCells += count;
      drawMap(true);
      updateProgress();
    }

    function colorAt(index) {
      if (index < 0 || index >= loadedCells) return null;
      const offset = index * 3;
      return [colorsRGB[offset], colorsRGB[offset + 1], colorsRGB[offset + 2]];
    }

    function hexAt(index) {
      const rgb = colorAt(index);
      if (!rgb) return "";
      return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    }

    function tierAt(index) {
      return index >= 0 && index < loadedCells ? tiersData[index] : 0;
    }

    function indexAt(x, y) {
      const worldX = (x - panX) / zoom;
      const worldY = (y - panY) / zoom;
      if (worldX < 0 || worldY < 0 || worldX >= stage.clientWidth || worldY >= stage.clientHeight) return -1;
      const column = Math.floor(worldX / stage.clientWidth * gridSide);
      const row = Math.floor(worldY / stage.clientHeight * gridSide);
      const index = row * gridSide + column;
      return index >= 0 && index < loadedCells ? index : -1;
    }

    function setSelected(index) {
      if (index < 0 || index >= loadedCells) return;
      selectedIndex = index;
      const hex = hexAt(index);
      hexInput.value = hex;
      colorPicker.value = hex;
      $("selection-label").textContent = `${hex} · ${tierName(tierAt(index))} · ${usernamesData[index] || "Unknown user"} · drop ${number(index + 1)}`;
    }

    function updateFocusMarker() {
      if (!focusMarker) return;
      if (focusIndex < 0 || focusIndex >= loadedCells) {
        focusMarker.hidden = true;
        return;
      }
      const column = focusIndex % gridSide;
      const row = Math.floor(focusIndex / gridSide);
      const left = (column + 0.5) / gridSide * stage.clientWidth * zoom + panX;
      const top = (row + 0.5) / gridSide * stage.clientHeight * zoom + panY;
      focusMarker.hidden = left < 0 || top < 0 || left > stage.clientWidth || top > stage.clientHeight;
      focusMarker.style.left = `${left}px`;
      focusMarker.style.top = `${top}px`;
    }

    function showHover(index, x, y) {
      if (index < 0) {
        hoverIndex = -1;
        hoverCard.hidden = true;
        return;
      }
      hoverIndex = index;
      const hex = hexAt(index);
      const tier = tierName(tierAt(index));
      hoverHex.textContent = hex;
      hoverSwatch.style.background = hex;
      hoverMeta.textContent = `${tier} · ${usernamesData[index] || "Unknown user"} · drop ${number(index + 1)}`;
      hoverCard.hidden = false;
      const gap = 12;
      const cardWidth = hoverCard.offsetWidth || 162;
      const cardHeight = hoverCard.offsetHeight || 55;
      let left = x + gap;
      let top = y + gap;
      if (left + cardWidth > stage.clientWidth - 6) left = x - cardWidth - gap;
      if (top + cardHeight > stage.clientHeight - 6) top = y - cardHeight - gap;
      hoverCard.style.left = `${Math.max(5, Math.min(left, stage.clientWidth - cardWidth - 5))}px`;
      hoverCard.style.top = `${Math.max(5, Math.min(top, stage.clientHeight - cardHeight - 5))}px`;
    }

    function focusDrop(index) {
      if (index < 0 || index >= loadedCells) return;
      focusIndex = index;
      setSelected(index);
      const column = index % gridSide;
      const row = Math.floor(index / gridSide);
      const cellX = (column + 0.5) / gridSide * stage.clientWidth;
      const cellY = (row + 0.5) / gridSide * stage.clientHeight;
      zoom = Math.max(zoom, 3.4);
      panX = stage.clientWidth / 2 - cellX * zoom;
      panY = stage.clientHeight / 2 - cellY * zoom;
      applyView();
      showHover(index, stage.clientWidth / 2, stage.clientHeight / 2);
      setTimeout(() => { hoverCard.hidden = true; }, 2200);
    }

    async function findExactHex() {
      const value = hexInput.value.trim().replace(/^#/, "").toUpperCase();
      if (!/^[0-9A-F]{6}$/.test(value)) {
        setMessage("Enter a six-digit hex value, such as 17B29F.", true);
        hexInput.focus();
        return;
      }
      hexInput.value = `#${value}`;
      colorPicker.value = `#${value}`;
      setMessage(`Looking for #${value}…`);
      const target = [Number.parseInt(value.slice(0,2),16), Number.parseInt(value.slice(2,4),16), Number.parseInt(value.slice(4,6),16)];
      const chunkSize = 100000;
      for (let start = 0; start < loadedCells; start += chunkSize) {
        const end = Math.min(loadedCells, start + chunkSize);
        for (let i = start; i < end; i++) {
          const offset = i * 3;
          if (colorsRGB[offset] === target[0] && colorsRGB[offset + 1] === target[1] && colorsRGB[offset + 2] === target[2]) {
            setMessage("");
            focusDrop(i);
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (hasMore) {
        setMessage(`No exact #${value} has appeared in the loaded tiles yet. The archive is still loading; try again when it finishes.`);
      } else {
        setMessage(`No exact #${value} drop is in this map yet. The color picker is ready if you want to keep the shade.`);
      }
    }

    async function fetchJson(url) {
      const response = await fetch(url, { mode: "cors", credentials: "omit", headers: { Accept: "application/json" } });
      let payload = null;
      try { payload = await response.json(); } catch { /* A proxy may return non-JSON HTML. */ }
      if (!response.ok) throw new Error(payload?.error || `Archive returned ${response.status}`);
      if (payload === null) throw new Error("The archive did not return valid JSON.");
      return payload;
    }

    async function requestPage() {
      const params = new URLSearchParams({
        action: "page",
        cursor,
        index: String(recordIndex),
        limit: String(PAGE_SIZE),
        stride: String(sampleStride),
      });
      const page = await fetchJson(`${API_BASE}?${params.toString()}`);
      if (!page || page.ok !== true || !Array.isArray(page.items)) throw new Error(page?.error || "The paginated archive response was not valid.");
      uploadPage(page.items);
      cursor = String(page.next_cursor ?? cursor);
      recordIndex = Number(page.next_index ?? recordIndex);
      hasMore = Boolean(page.has_more);
      if (Number.isFinite(Number(page.total_count)) && Number(page.total_count) !== totalDrops) {
        totalDrops = Number(page.total_count);
        totalCountLabel.textContent = `${number(totalDrops)} color drops`;
      }
    }

    async function loadPagedArchive() {
      const stats = await fetchJson(`${API_BASE}?action=stats`);
      if (!stats || stats.ok !== true || !Number.isFinite(Number(stats.total_count))) throw new Error(stats?.error || "Archive statistics are unavailable.");
      totalDrops = Math.max(0, Number(stats.total_count));
      totalCountLabel.textContent = `${number(totalDrops)} color ${totalDrops === 1 ? "drop" : "drops"}`;
      initMapData(totalDrops);
      cursor = "0";
      recordIndex = 0;
      hasMore = totalDrops > 0;
      setStatus(totalDrops ? "Loading color pages" : "Ready for the first roll");
      if (totalDrops === 0) {
        updateProgress();
        setMessage("The map is waiting for its first color drop.");
        return;
      }
      while (hasMore) {
        if (isPaused) {
          isLoading = false;
          setStatus("Loading paused");
          return;
        }
        isLoading = true;
        await requestPage();
        setStatus(hasMore ? "Adding color pages" : "Map fully loaded");
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      isLoading = false;
      setStatus("Map fully loaded");
      updateProgress();
      if (sampleStride === 1) setMessage("");
    }

    async function loadLegacyArchive() {
      sourceMode = "legacy";
      $("pause-load").hidden = true;
      let data;
      try {
        data = await fetchJson(`${API_BASE}?action=drops`);
      } catch (error) {
        if (/413|too large|large for one response/i.test(String(error?.message || error))) {
          sourceMode = "paged";
          archiveDropsForSearch = null;
          $("pause-load").hidden = false;
          await loadPagedArchive();
          updateArchiveSearchHint();
          return;
        }
        throw error;
      }
      if (!Array.isArray(data)) throw new Error(data?.error || "The archive needs the new paginated API. Update color-api/index.php, then retry.");
      if (data.length > FALLBACK_LIMIT) {
        sourceMode = "paged";
        archiveDropsForSearch = null;
        $("pause-load").hidden = false;
        await loadPagedArchive();
        updateArchiveSearchHint();
        return;
      }
      archiveDropsForSearch = data;
      updateArchiveSearchHint();
      totalDrops = data.length;
      totalCountLabel.textContent = `${number(totalDrops)} color ${totalDrops === 1 ? "drop" : "drops"}`;
      initMapData(totalDrops);
      uploadPage(data);
      hasMore = false;
      setStatus("Map loaded · legacy API");
      updateProgress();
      if (totalDrops === 0) setMessage("The map is waiting for its first color drop.");
      else setMessage("");
    }

    async function startArchive() {
      setMessage("");
      setStatus("Connecting to the archive");
      try {
        await loadLegacyArchive();
      } catch (error) {
        showLoadError(error);
      }
    }

    function showLoadError(error) {
      isLoading = false;
      hasMore = false;
      setStatus("Archive unavailable");
      const loadingNotice = $("map-loading");
      if (loadingNotice) loadingNotice.hidden = true;
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(`The color map could not load: ${detail}`, true);
      progressLabel.textContent = "Map data could not be loaded";
      progressPercent.textContent = "—";
      progressFill.style.width = "0%";
      $("map-mode-label").textContent = "OFFLINE VIEW";
    }

    $("pause-load").addEventListener("click", async () => {
      if (sourceMode === "legacy") return;
      isPaused = !isPaused;
      $("pause-load").setAttribute("aria-label", isPaused ? "Resume map loading" : "Pause map loading");
      $("pause-load").setAttribute("title", isPaused ? "Resume loading" : "Pause loading");
      $("pause-load").setAttribute("data-paused", isPaused ? "true" : "false");
      if (!isPaused && !isLoading && hasMore) {
        isLoading = true;
        try {
          while (hasMore && !isPaused) {
            await requestPage();
            setStatus(hasMore ? "Adding color pages" : "Map fully loaded");
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          isLoading = false;
          if (isPaused) setStatus("Loading paused");
          else if (!hasMore) { setStatus("Map fully loaded"); if (sampleStride === 1) setMessage(""); }
        } catch (error) { showLoadError(error); }
      }
    });

    tierFilter.addEventListener("change", drawMap);
    $("zoom-in").addEventListener("click", () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.35));
    $("zoom-out").addEventListener("click", () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.35));
    $("fit-map").addEventListener("click", () => { zoom = 1; panX = 0; panY = 0; focusIndex = -1; applyView(); });
    $("fullscreen-map").addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) await stage.requestFullscreen();
        else await document.exitFullscreen();
      } catch { setMessage("Fullscreen is not available in this browser."); }
    });
    function resizeMap() {
      clampView();
      drawMap(true);
    }
    document.addEventListener("fullscreenchange", resizeMap);
    window.addEventListener("resize", resizeMap, { passive: true });
    if ("ResizeObserver" in window) new ResizeObserver(resizeMap).observe(stage);

    $("find-hex").addEventListener("click", findExactHex);
    hexInput.addEventListener("keydown", (event) => { if (event.key === "Enter") findExactHex(); });
    colorPicker.addEventListener("input", () => { hexInput.value = colorPicker.value.toUpperCase(); setMessage("Color selected. Choose Find color to look for an exact drop."); });
    $("random-drop").addEventListener("click", () => {
      if (!loadedCells) { setMessage("The first map page is still loading. Try again in a moment."); return; }
      focusDrop(Math.floor(Math.random() * loadedCells));
      setMessage("");
    });
    $("copy-hex").addEventListener("click", async () => {
      const typed = hexInput.value.trim().toUpperCase();
      const index = selectedIndex >= 0 ? selectedIndex : hoverIndex;
      const value = /^#?[0-9A-F]{6}$/.test(typed) ? typed : index >= 0 ? hexAt(index) : "";
      if (!/^#?[0-9A-F]{6}$/.test(value)) { setMessage("Choose or search a hex color before copying."); return; }
      const hex = value.startsWith("#") ? value : `#${value}`;
      try {
        await navigator.clipboard.writeText(hex);
        setMessage(`${hex} copied to your clipboard.`);
      } catch {
        hexInput.value = hex;
        hexInput.select();
        setMessage(`Select and copy ${hex}.`);
      }
    });

    stage.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    function pointerLocal(event) {
      const rect = stage.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
    stage.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      stage.focus({ preventScroll: true });
      stage.setPointerCapture?.(event.pointerId);
      const point = pointerLocal(event);
      activePointers.set(event.pointerId, point);
      dragged = false;
      if (activePointers.size === 1) {
        dragStart = { pointerId: event.pointerId, x: point.x, y: point.y, panX, panY, canPan: event.pointerType !== "mouse" || zoom > 1.001 };
        pinchStart = null;
      } else if (activePointers.size === 2) {
        const [a, b] = Array.from(activePointers.values());
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        pinchStart = { distance, zoom, worldX: (midX - panX) / zoom, worldY: (midY - panY) / zoom };
        dragStart = null;
      }
    });
    stage.addEventListener("pointermove", (event) => {
      const point = pointerLocal(event);
      if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, point);
      if (activePointers.size >= 2 && pinchStart) {
        const [a, b] = Array.from(activePointers.values());
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        setZoomAt(midX, midY, pinchStart.zoom * distance / Math.max(1, pinchStart.distance), pinchStart.worldX, pinchStart.worldY);
        dragged = true;
        hoverCard.hidden = true;
        return;
      }
      if (dragStart && dragStart.pointerId === event.pointerId && dragStart.canPan && activePointers.has(event.pointerId)) {
        const dx = point.x - dragStart.x;
        const dy = point.y - dragStart.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
        if (dragged) {
          panX = dragStart.panX + dx;
          panY = dragStart.panY + dy;
          stage.classList.add("is-panning");
          hoverCard.hidden = true;
          applyView();
        }
        return;
      }
      if (event.pointerType === "mouse" && !activePointers.has(event.pointerId)) {
        const index = indexAt(point.x, point.y);
        showHover(index, point.x, point.y);
      }
    });
    function finishPointer(event) {
      activePointers.delete(event.pointerId);
      if (activePointers.size < 2) pinchStart = null;
      if (activePointers.size === 0) {
        stage.classList.remove("is-panning");
        if (dragged) {
          suppressClick = true;
          setTimeout(() => { suppressClick = false; }, 80);
        }
        dragStart = null;
      }
    }
    stage.addEventListener("pointerup", finishPointer);
    stage.addEventListener("pointercancel", finishPointer);
    stage.addEventListener("pointerleave", (event) => { if (!activePointers.has(event.pointerId)) { hoverCard.hidden = true; hoverIndex = -1; } });
    stage.addEventListener("click", (event) => {
      if (suppressClick || event.target.closest("button")) return;
      const point = pointerLocal(event);
      const index = indexAt(point.x, point.y);
      if (index >= 0) { focusIndex = index; setSelected(index); applyView(); }
    });
    stage.addEventListener("dblclick", (event) => {
      const point = pointerLocal(event);
      zoomAt(point.x, point.y, 1.7);
    });
    stage.addEventListener("keydown", (event) => {
      const step = 54;
      if (event.key === "+" || event.key === "=") { zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.25); event.preventDefault(); }
      else if (event.key === "-") { zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.25); event.preventDefault(); }
      else if (event.key === "Home") { zoom = 1; panX = 0; panY = 0; focusIndex = -1; applyView(); event.preventDefault(); }
      else if (event.key === "ArrowLeft") { panX += step; applyView(); event.preventDefault(); }
      else if (event.key === "ArrowRight") { panX -= step; applyView(); event.preventDefault(); }
      else if (event.key === "ArrowUp") { panY += step; applyView(); event.preventDefault(); }
      else if (event.key === "ArrowDown") { panY -= step; applyView(); event.preventDefault(); }
    });

    // Accessible arrow-operated screenshot carousel.
    const galleryTrack = $("gallery-track");
    const galleryCards = Array.from(galleryTrack.querySelectorAll(".gallery-card"));
    const galleryDots = $("gallery-dots");
    const galleryLightbox = $("gallery-lightbox");
    const galleryLightboxImage = $("gallery-lightbox-image");
    let galleryIndex = 0;
    let galleryTrigger = null;
    function closeGalleryLightbox() {
      if (galleryLightbox.open) galleryLightbox.close();
    }
    galleryCards.forEach((card) => {
      const image = card.querySelector("img");
      image.tabIndex = 0;
      image.setAttribute("role", "button");
      image.setAttribute("aria-haspopup", "dialog");
      image.setAttribute("aria-label", `Expand ${image.alt}`);
      image.addEventListener("click", () => {
        galleryTrigger = image;
        galleryLightboxImage.src = image.currentSrc || image.src;
        galleryLightboxImage.alt = image.alt;
        galleryLightbox.showModal();
        galleryLightbox.querySelector(".gallery-lightbox-close").focus();
      });
      image.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          image.click();
        }
      });
    });
    galleryLightbox.querySelector(".gallery-lightbox-close").addEventListener("click", closeGalleryLightbox);
    galleryLightbox.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeGalleryLightbox();
    });
    galleryLightbox.addEventListener("click", (event) => {
      if (event.target === galleryLightbox || event.target === galleryLightboxImage) closeGalleryLightbox();
    });
    galleryLightbox.addEventListener("close", () => {
      if (galleryTrigger) galleryTrigger.focus();
      galleryTrigger = null;
    });
    galleryCards.forEach((card, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = `gallery-dot${index === 0 ? " active" : ""}`;
      dot.setAttribute("aria-label", `Show screenshot ${index + 1} of ${galleryCards.length}`);
      dot.addEventListener("click", () => card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" }));
      galleryDots.appendChild(dot);
    });
    function setGalleryIndex(index) {
      galleryIndex = (index + galleryCards.length) % galleryCards.length;
      galleryCards[galleryIndex].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
      $("gallery-count").textContent = `${String(galleryIndex + 1).padStart(2, "0")} / ${String(galleryCards.length).padStart(2, "0")}`;
      Array.from(galleryDots.children).forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex === galleryIndex));
    }
    $("gallery-prev").addEventListener("click", () => setGalleryIndex(galleryIndex - 1));
    $("gallery-next").addEventListener("click", () => setGalleryIndex(galleryIndex + 1));
    galleryTrack.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") { setGalleryIndex(galleryIndex - 1); event.preventDefault(); }
      else if (event.key === "ArrowRight") { setGalleryIndex(galleryIndex + 1); event.preventDefault(); }
    });
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const index = galleryCards.indexOf(visible.target);
          if (index >= 0 && index !== galleryIndex) {
            galleryIndex = index;
            $("gallery-count").textContent = `${String(index + 1).padStart(2, "0")} / ${String(galleryCards.length).padStart(2, "0")}`;
            Array.from(galleryDots.children).forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex === index));
          }
        }
      }, { root: galleryTrack, threshold: 0.55 });
      galleryCards.forEach((card) => observer.observe(card));
    }

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(startArchive, { timeout: 1500 });
    } else {
      window.setTimeout(startArchive, 0);
    }


    const primeColors = [
      ["pureblack", "000000"], ["purewhite", "FFFFFF"], ["purered", "FF0000"], ["puregreen", "00FF00"], ["pureblue", "0000FF"],
      ["yellow", "FFFF00"], ["violet", "EE82EE"], ["turquoise", "40E0D0"], ["teal", "008080"], ["silver", "C0C0C0"],
      ["salmon", "FA8072"], ["ruby", "E0115F"], ["purple", "800080"], ["jade", "00A86B"], ["ivory", "FFFFF0"],
      ["indigo", "4B0082"], ["pink", "FFC0CB"], ["orange", "FFA500"], ["olive", "808000"], ["navy", "000080"],
      ["maroon", "800000"], ["magenta", "FF00FF"], ["lime", "32CD32"], ["lavender", "E6E6FA"], ["khaki", "F0E68C"],
      ["gold", "FFD700"], ["cyan", "00FFFF"], ["crimson", "DC143C"], ["coral", "FF7F50"], ["cherryblossom", "FFB7C5"],
      ["bronze", "CD7F32"], ["beige", "F5F5DC"], ["azure", "F0FFFF"], ["aquamarine", "7FFFD4"], ["amber", "FFBF00"],
    ];
    const tierBands = [[1, 2, 900], [3, 5, 240], [6, 9, 65], [10, 18, 25], [19, 35, 8], [36, 69, 2]];
    const tierLabels = ["Prime", "Tier 1", "Tier 2", "Tier 3", "Tier 4", "Tier 5", "Tier 6", "Tier 7"];
    const dropStoragePrefix = "hexroulette.drop.v1.";
    const dropHistoryBatchSize = 100;
    const searchBatchSize = 120;
    const dropButton = $("drop-button");
    const dropHexLabel = $("drop-hex");
    const dropStatus = $("roll-status");
    const autoSpinButton = $("auto-spin");
    const statsToggle = $("roll-stats-toggle");
    const statsPanel = $("roll-stats-panel");
    const dropHistoryList = $("drop-history-list");
    const searchInput = $("archive-search-input");
    const searchForm = $("archive-search-form");
    const searchStatus = $("archive-search-status");
    const searchResults = $("archive-search-results");
    let dropHistory = [];
    let dropStats = { totalXP: 0, uniqueHexes: new Set(), tierCounts: {}, best: null };
    let dropDuration = 2200;
    let currentRollStartedAt = 0;
    let currentRollDuration = 2200;
    let isRolling = false;
    let autoSpinEnabled = false;
    let autoSpinTimer = 0;
    let activeSearchMatches = [];
    let renderedSearchCount = 0;
    let renderedHistoryCount = 0;
    let localStorageAvailable = true;

    function randomHex() {
      const bytes = new Uint32Array(1);
      if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
      else bytes[0] = Math.floor(Math.random() * 0x1000000);
      return (bytes[0] & 0xFFFFFF).toString(16).padStart(6, "0").toUpperCase();
    }

    function classifyDropHex(hex) {
      const rgb = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
      let nearest = primeColors[0];
      let bestSquared = Number.POSITIVE_INFINITY;
      for (const prime of primeColors) {
        const primeRgb = [0, 2, 4].map((offset) => Number.parseInt(prime[1].slice(offset, offset + 2), 16));
        const squared = rgb.reduce((sum, value, index) => sum + (value - primeRgb[index]) ** 2, 0);
        if (squared < bestSquared) { bestSquared = squared; nearest = prime; }
      }
      const distance = Math.floor(Math.sqrt(bestSquared) + 0.5);
      if (distance === 0) return { tier: "Prime", distance, xp: 2400, nearest, rgb };
      for (let index = 0; index < tierBands.length; index += 1) {
        const [low, high, xp] = tierBands[index];
        if (distance >= low && distance <= high) return { tier: `Tier ${index + 1}`, distance, xp, nearest, rgb };
      }
      return { tier: "Tier 7", distance, xp: 0.4, nearest, rgb };
    }

    function makeDropRecord(hex, rolledAt = Date.now()) {
      const color = hex.toUpperCase();
      const result = classifyDropHex(color);
      return { hex: color, tier: result.tier, distance: result.distance, xp: result.xp, nearest: result.nearest, rgb: result.rgb, rolledAt };
    }

    function formatXP(value) {
      return Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 });
    }

    function loadLocalDrops() {
      const loaded = [];
      try {
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (!key?.startsWith(dropStoragePrefix)) continue;
          const timeToken = key.slice(dropStoragePrefix.length).split(".")[0];
          const rolledAt = Number.parseInt(timeToken, 36);
          const hex = String(localStorage.getItem(key) || "").toUpperCase();
          if (!Number.isFinite(rolledAt) || !/^[0-9A-F]{6}$/.test(hex)) continue;
          loaded.push(makeDropRecord(hex, rolledAt));
        }
      } catch {
        localStorageAvailable = false;
      }
      loaded.sort((first, second) => first.rolledAt - second.rolledAt);
      return loaded;
    }

    function saveLocalDrop(record) {
      try {
        const key = `${dropStoragePrefix}${record.rolledAt.toString(36)}.${randomHex()}${randomHex()}`;
        localStorage.setItem(key, record.hex);
        localStorageAvailable = true;
        return true;
      } catch {
        localStorageAvailable = false;
        return false;
      }
    }

    function calculateDropStats(records) {
      const tierCounts = Object.fromEntries(tierLabels.map((tier) => [tier, 0]));
      const uniqueHexes = new Set();
      let totalXP = 0;
      let best = null;
      for (const record of records) {
        totalXP += record.xp;
        uniqueHexes.add(record.hex);
        tierCounts[record.tier] = (tierCounts[record.tier] || 0) + 1;
        if (!best || record.distance < best.distance) best = record;
      }
      return { totalXP: Number(totalXP.toFixed(1)), uniqueHexes, tierCounts, best };
    }

    function addDropToStats(record) {
      dropStats.totalXP = Number((dropStats.totalXP + record.xp).toFixed(1));
      dropStats.uniqueHexes.add(record.hex);
      dropStats.tierCounts[record.tier] = (dropStats.tierCounts[record.tier] || 0) + 1;
      if (!dropStats.best || record.distance < dropStats.best.distance) dropStats.best = record;
    }

    function setDropSwatch(hex, label = "Tap to roll", updateShadow = true) {
      const color = `#${hex}`;
      const rgb = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
      const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
      dropButton.style.setProperty("--swatch-color", color);
      dropButton.style.setProperty("--swatch-ink", luminance > 0.58 ? "#101014" : "#FFFFFF");
      if (updateShadow) dropButton.style.setProperty("--swatch-shadow", `rgba(${rgb.join(", ")}, .18)`);
      dropButton.dataset.hex = hex;
      dropHexLabel.textContent = color;
      dropButton.querySelector("small").textContent = label;
    }

    function showDropColor(record) {
      const result = typeof record === "string" ? makeDropRecord(record) : record;
      setDropSwatch(result.hex);
      $("roll-tier").textContent = result.tier;
      $("roll-tier").classList.toggle("is-prime", result.tier === "Prime");
      $("roll-prime").textContent = `${result.nearest[0]} · #${result.nearest[1]}`;
      $("roll-distance").textContent = String(result.distance);
      $("roll-rgb").textContent = result.rgb.join(", ");
      $("roll-xp").textContent = `${formatXP(result.xp)} XP`;
    }

    function renderRecentDrops() {
      const recentContainer = $("recent-drops");
      const recent = dropHistory.slice(-6).reverse();
      $("recent-drop-count").textContent = String(recent.length);
      if (!recent.length) {
        const empty = document.createElement("span");
        empty.className = "recent-empty";
        empty.textContent = "Your latest drops will appear here.";
        recentContainer.replaceChildren(empty);
        return;
      }
      const fragment = document.createDocumentFragment();
      recent.forEach((record, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "recent-drop";
        button.title = `#${record.hex} · ${record.tier} · show drop ${dropHistory.length - index}`;
        button.setAttribute("aria-label", `Show ${record.tier} drop #${record.hex}`);
        button.style.setProperty("--recent-color", `#${record.hex}`);
        const swatch = document.createElement("i");
        swatch.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.textContent = `#${record.hex}`;
        button.append(swatch, label);
        button.addEventListener("click", () => {
          showDropColor(record);
          dropStatus.textContent = `Showing ${record.tier} drop`;
        });
        fragment.appendChild(button);
      });
      recentContainer.replaceChildren(fragment);
    }

    function updateDropStats() {
      const total = dropHistory.length;
      $("drop-count").textContent = number(total);
      $("stats-drop-count").textContent = `${number(total)} ${total === 1 ? "drop" : "drops"}`;
      $("stats-total-drops").textContent = number(total);
      $("stats-total-xp").textContent = `${formatXP(dropStats.totalXP)} XP`;
      $("stats-unique-colors").textContent = number(dropStats.uniqueHexes.size);
      $("stats-best-drop").textContent = dropStats.best ? `#${dropStats.best.hex} · ${dropStats.best.tier}` : "—";
      $("stats-best-detail").textContent = dropStats.best ? `RGB ${dropStats.best.distance} · ${dropStats.best.nearest[0]}` : "—";
      $("history-status").textContent = localStorageAvailable ? `${number(total)} drops saved here` : `${number(total)} drops · storage unavailable`;
      const tierContainer = $("drop-tier-stats");
      const fragment = document.createDocumentFragment();
      tierLabels.forEach((tier, index) => {
        const chip = document.createElement("span");
        chip.className = "drop-tier-stat";
        const label = document.createElement("span");
        label.textContent = index === 0 ? "Prime" : `T${index}`;
        const count = document.createElement("strong");
        count.textContent = number(dropStats.tierCounts[tier] || 0);
        chip.append(label, count);
        fragment.appendChild(chip);
      });
      tierContainer.replaceChildren(fragment);
    }

    function makeHistoryRow(record) {
      const row = document.createElement("article");
      row.className = "history-item";
      const swatch = document.createElement("span");
      swatch.className = "history-swatch";
      swatch.style.setProperty("--history-color", `#${record.hex}`);
      swatch.setAttribute("aria-label", `Color #${record.hex}`);
      const copy = document.createElement("div");
      copy.className = "history-copy";
      const title = document.createElement("strong");
      title.textContent = `#${record.hex} · ${record.tier}`;
      const detail = document.createElement("span");
      detail.textContent = `${record.nearest[0]} · RGB ${record.distance} · ${formatXP(record.xp)} XP`;
      const date = document.createElement("time");
      date.className = "history-time";
      date.dateTime = new Date(record.rolledAt).toISOString();
      date.textContent = new Date(record.rolledAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
      copy.append(title, detail);
      row.append(swatch, copy, date);
      return row;
    }

    function renderDropHistory(reset = false) {
      if (reset) {
        renderedHistoryCount = 0;
        dropHistoryList.replaceChildren();
      }
      if (!dropHistory.length) {
        const empty = document.createElement("div");
        empty.className = "history-empty";
        empty.textContent = "No drops yet.";
        dropHistoryList.replaceChildren(empty);
        renderedHistoryCount = 0;
        return;
      }
      const firstIndex = dropHistory.length - renderedHistoryCount - 1;
      const count = Math.min(dropHistoryBatchSize, Math.max(0, dropHistory.length - renderedHistoryCount));
      if (count <= 0) return;
      const fragment = document.createDocumentFragment();
      for (let offset = 0; offset < count; offset += 1) {
        const recordIndex = firstIndex - offset;
        if (recordIndex < 0) break;
        fragment.appendChild(makeHistoryRow(dropHistory[recordIndex]));
      }
      dropHistoryList.appendChild(fragment);
      renderedHistoryCount += count;
    }

    function recordDrop(hex) {
      const record = makeDropRecord(hex);
      dropHistory.push(record);
      const stored = saveLocalDrop(record);
      addDropToStats(record);
      showDropColor(record);
      dropStatus.textContent = `Drop ${number(dropHistory.length)} · ${record.tier}${stored ? "" : " · not saved"}`;
      renderRecentDrops();
      updateDropStats();
      if (!statsPanel.hidden) renderDropHistory(true);
    }

    function finishDropRoll(hex) {
      isRolling = false;
      dropButton.classList.remove("is-rolling");
      dropButton.disabled = false;
      dropButton.setAttribute("aria-busy", "false");
      recordDrop(hex);
      if (autoSpinEnabled) autoSpinTimer = window.setTimeout(startDropRoll, 110);
    }

    function startDropRoll() {
      if (isRolling) return;
      window.clearTimeout(autoSpinTimer);
      isRolling = true;
      dropButton.disabled = true;
      dropButton.setAttribute("aria-busy", "true");
      dropButton.classList.add("is-rolling");
      dropStatus.textContent = autoSpinEnabled ? "Auto spinning…" : "Rolling…";
      const finalHex = randomHex();
      currentRollStartedAt = performance.now();
      currentRollDuration = dropDuration;
      let lastFlash = 0;
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const animate = (now) => {
        if (!isRolling) return;
        if (now - currentRollStartedAt >= currentRollDuration) { finishDropRoll(finalHex); return; }
        const flashInterval = reducedMotion ? 170 : 52;
        if (now - lastFlash > flashInterval) {
          setDropSwatch(randomHex(), "Rolling…", false);
          lastFlash = now;
        }
        window.requestAnimationFrame(animate);
      };
      window.requestAnimationFrame(animate);
    }

    function setDropDuration(nextDuration) {
      if (nextDuration !== 2200 && nextDuration !== 700) return;
      const now = performance.now();
      if (isRolling) {
        const progress = Math.min(0.999, Math.max(0, (now - currentRollStartedAt) / currentRollDuration));
        currentRollDuration = nextDuration;
        currentRollStartedAt = now - progress * currentRollDuration;
      }
      dropDuration = nextDuration;
    }

    function updateAutoSpinButton() {
      autoSpinButton.setAttribute("aria-pressed", String(autoSpinEnabled));
      autoSpinButton.querySelector("span").textContent = autoSpinEnabled ? "Stop auto spin" : "Start auto spin";
    }

    document.querySelectorAll(".speed-option").forEach((button) => {
      button.addEventListener("click", () => {
        const nextDuration = Number(button.getAttribute("data-roll-duration"));
        if (nextDuration !== 2200 && nextDuration !== 700) return;
        setDropDuration(nextDuration);
        document.querySelectorAll(".speed-option").forEach((option) => {
          const selected = option === button;
          option.classList.toggle("active", selected);
          option.setAttribute("aria-pressed", String(selected));
        });
      });
    });
    dropButton.addEventListener("click", startDropRoll);
    autoSpinButton.addEventListener("click", () => {
      autoSpinEnabled = !autoSpinEnabled;
      updateAutoSpinButton();
      if (autoSpinEnabled && !isRolling) startDropRoll();
      else if (!autoSpinEnabled) {
        window.clearTimeout(autoSpinTimer);
        dropStatus.textContent = isRolling ? "Finishing this drop…" : "Auto spin stopped";
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && autoSpinEnabled) {
        autoSpinEnabled = false;
        window.clearTimeout(autoSpinTimer);
        updateAutoSpinButton();
        dropStatus.textContent = isRolling ? "Finishing this drop…" : "Auto spin paused";
      }
    });

    function renderPrimeReference() {
      const container = $("prime-swatches");
      const fragment = document.createDocumentFragment();
      for (const [name, hex] of primeColors) {
        const chip = document.createElement("div");
        chip.className = "prime-chip";
        chip.title = `${name} · #${hex}`;
        const swatch = document.createElement("i");
        swatch.style.setProperty("--prime-color", `#${hex}`);
        swatch.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.textContent = name;
        chip.append(swatch, label);
        fragment.appendChild(chip);
      }
      container.replaceChildren(fragment);
    }

    dropHistory = loadLocalDrops();
    dropStats = calculateDropStats(dropHistory);
    renderPrimeReference();
    updateDropStats();
    renderRecentDrops();
    if (dropHistory.length) {
      const lastDrop = dropHistory[dropHistory.length - 1];
      showDropColor(lastDrop);
      dropStatus.textContent = `Last drop · ${lastDrop.tier}`;
    } else {
      showDropColor("17B29F");
    }
    statsToggle.addEventListener("click", () => {
      const opening = statsPanel.hidden;
      statsPanel.hidden = !opening;
      statsToggle.setAttribute("aria-expanded", String(opening));
      if (opening) renderDropHistory(true);
    });
    dropHistoryList.addEventListener("scroll", () => {
      if (dropHistoryList.scrollTop + dropHistoryList.clientHeight >= dropHistoryList.scrollHeight - 80) {
        renderDropHistory();
      }
    }, { passive: true });

    function updateArchiveSearchHint() {
      if (Array.isArray(archiveDropsForSearch)) {
        searchStatus.classList.remove("error");
        searchStatus.textContent = `${number(archiveDropsForSearch.length)} archived drops ready to search.`;
      } else if (loadedCells > 0) {
        searchStatus.classList.remove("error");
        searchStatus.textContent = "Map loaded in compact mode. Username records may not be available.";
      } else {
        searchStatus.textContent = "Connecting to the color archive…";
      }
    }

    function exactSearchHex(value) {
      const match = String(value || "").trim().match(/^#?([0-9a-f]{6})$/i);
      return match ? match[1].toUpperCase() : null;
    }

    function cssColorSearchHex(value) {
      const query = String(value || "").replace(/^color\s*:\s*/i, "").trim();
      if (!query || !window.CSS?.supports?.("color", query)) return null;
      const canvas = document.createElement("canvas");
      canvas.width = 1; canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = query;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
      if (!alpha) return null;
      return [red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase();
    }

    function formatArchiveDate(value) {
      if (!value) return "";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    }

    function archiveRecordFromDrop(drop, index) {
      if (!drop || typeof drop !== "object") return null;
      const hex = String(drop.hex || "").replace(/^#/, "").toUpperCase();
      if (!/^[0-9A-F]{6}$/.test(hex)) return null;
      return { hex, tier: String(drop.tier || "Color drop"), username: String(drop.username || "Unknown user"), rolledAt: String(drop.rolled_at || ""), index: index + 1 };
    }

    function archiveColorMatches(hex) {
      if (Array.isArray(archiveDropsForSearch)) {
        return archiveDropsForSearch.map((drop, index) => archiveRecordFromDrop(drop, index)).filter((record) => record && record.hex === hex);
      }
      const matches = [];
      for (let index = 0; index < loadedCells; index += 1) {
        if (hexAt(index) !== `#${hex}`) continue;
        matches.push({ hex, tier: tierName(tierAt(index)), username: usernamesData[index] || "Unknown user", rolledAt: "", index: index + 1 });
      }
      return matches;
    }

    function renderSearchResult(record) {
      const row = document.createElement("article");
      row.className = "search-result";
      const swatch = document.createElement("span");
      swatch.className = "search-result-swatch";
      swatch.style.setProperty("--result-color", `#${record.hex}`);
      swatch.setAttribute("aria-label", `Color #${record.hex}`);
      const copy = document.createElement("div");
      copy.className = "search-result-copy";
      const title = document.createElement("strong");
      title.textContent = `${record.username} · #${record.hex}`;
      const meta = document.createElement("span");
      const dateText = formatArchiveDate(record.rolledAt);
      meta.textContent = `${record.tier}${dateText ? ` · ${dateText}` : ""} · drop ${number(record.index)}`;
      const tier = document.createElement("span");
      tier.className = `search-result-tier${record.tier === "Prime" ? " is-prime" : ""}`;
      tier.textContent = record.tier;
      copy.append(title, meta);
      row.append(swatch, copy, tier);
      return row;
    }

    function renderSearchBatch() {
      const oldNote = searchResults.querySelector(".search-load-note");
      oldNote?.remove();
      const end = Math.min(renderedSearchCount + searchBatchSize, activeSearchMatches.length);
      const fragment = document.createDocumentFragment();
      for (let index = renderedSearchCount; index < end; index += 1) {
        fragment.appendChild(renderSearchResult(activeSearchMatches[index]));
      }
      searchResults.appendChild(fragment);
      renderedSearchCount = end;
      if (renderedSearchCount < activeSearchMatches.length) {
        const note = document.createElement("div");
        note.className = "search-load-note";
        note.textContent = `${number(renderedSearchCount)} of ${number(activeSearchMatches.length)} drops · scroll for more`;
        searchResults.appendChild(note);
      }
    }

    function appendSearchResults(matches, description, isPartial = false) {
      searchResults.replaceChildren();
      activeSearchMatches = matches.slice().reverse();
      renderedSearchCount = 0;
      if (!activeSearchMatches.length) {
        const empty = document.createElement("div");
        empty.className = "search-empty";
        empty.textContent = "No matching archived records found.";
        searchResults.appendChild(empty);
        searchStatus.textContent = `${description}${isPartial ? " The archive is still loading or sampled; try again later for a fuller result." : ""}`;
        searchStatus.classList.remove("error");
        return;
      }
      renderSearchBatch();
      searchStatus.textContent = `${description}${isPartial ? " Results include only loaded or sampled map entries." : ""}`;
      searchStatus.classList.remove("error");
    }

    function searchArchive(event) {
      event?.preventDefault();
      const query = searchInput.value.trim();
      searchResults.replaceChildren();
      activeSearchMatches = [];
      renderedSearchCount = 0;
      if (!query) {
        searchStatus.textContent = "Type a username, hex value, or CSS color name.";
        searchStatus.classList.remove("error");
        searchInput.focus();
        return;
      }
      const hex = exactSearchHex(query);
      const explicitCssColor = /^color\s*:/i.test(query);
      if (hex || explicitCssColor) {
        const colorHex = hex || cssColorSearchHex(query);
        if (!colorHex) {
          searchStatus.textContent = "That color name isn't recognized. Try a CSS color name or #RRGGBB.";
          searchStatus.classList.add("error");
          return;
        }
        if (!Array.isArray(archiveDropsForSearch) && loadedCells === 0) {
          searchStatus.textContent = "The archive is still loading or unavailable. Try this color again shortly.";
          searchStatus.classList.remove("error");
          return;
        }
        const matches = archiveColorMatches(colorHex);
        const partial = !Array.isArray(archiveDropsForSearch) && (hasMore || loadedCells < sampledCells || sampleStride > 1);
        appendSearchResults(matches, `#${colorHex} · ${number(matches.length)} archived match${matches.length === 1 ? "" : "es"}.`, partial);
        return;
      }
      if (/^\d{15,22}$/.test(query)) {
        searchStatus.textContent = "Discord IDs aren't stored in the public color archive. Search by the user's Discord username instead.";
        searchStatus.classList.add("error");
        return;
      }
      const usernameQuery = query.replace(/^@/, "").toLocaleLowerCase();
      if (Array.isArray(archiveDropsForSearch)) {
        const matches = [];
        archiveDropsForSearch.forEach((drop, index) => {
          const record = archiveRecordFromDrop(drop, index);
          if (record && record.username.toLocaleLowerCase().includes(usernameQuery)) matches.push(record);
        });
        if (matches.length) {
          appendSearchResults(matches, `${number(matches.length)} color drop${matches.length === 1 ? "" : "s"} for “${query}”.`);
          return;
        }
        const namedHex = cssColorSearchHex(query);
        if (namedHex) {
          const colorMatches = archiveColorMatches(namedHex);
          appendSearchResults(colorMatches, `Color name ${query} resolves to #${namedHex} · ${number(colorMatches.length)} archived match${colorMatches.length === 1 ? "" : "es"}.`);
          return;
        }
        appendSearchResults([], `No archived drops matched “${query}”.`);
        return;
      }
      const namedHex = cssColorSearchHex(query);
      if (namedHex && loadedCells) {
        const matches = archiveColorMatches(namedHex);
        const partial = hasMore || loadedCells < sampledCells || sampleStride > 1;
        appendSearchResults(matches, `${query} resolves to #${namedHex} · ${number(matches.length)} loaded match${matches.length === 1 ? "" : "es"}.`, partial);
        return;
      }
      if (!loadedCells) {
        searchStatus.textContent = "The archive is still loading or unavailable. Try again shortly.";
        searchStatus.classList.remove("error");
      } else {
        searchStatus.textContent = "Username search needs the archive's username records. Try an exact #HEX value instead.";
        searchStatus.classList.add("error");
      }
    }

    searchForm.addEventListener("submit", searchArchive);
    searchInput.addEventListener("input", () => searchStatus.classList.remove("error"));
    searchResults.addEventListener("scroll", () => {
      if (searchResults.scrollTop + searchResults.clientHeight >= searchResults.scrollHeight - 72) renderSearchBatch();
    }, { passive: true });
    updateArchiveSearchHint();
