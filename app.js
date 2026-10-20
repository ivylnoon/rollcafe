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
      const data = await fetchJson(`${API_BASE}?action=drops`);
      if (!Array.isArray(data)) throw new Error(data?.error || "The archive needs the new paginated API. Update color-api/index.php, then retry.");
      if (data.length > FALLBACK_LIMIT) {
        sourceMode = "paged";
        $("pause-load").hidden = false;
        await loadPagedArchive();
        return;
      }
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
