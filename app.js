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
          if (requestedUsername) {
            archiveDropsForSearch = null;
            showUserProfileMessage("This archive exceeds the public username lookup limit; the compact archive pages don't include usernames.");
            return;
          }
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
        if (requestedUsername) {
          archiveDropsForSearch = null;
          showUserProfileMessage("This archive exceeds the public username lookup limit; the compact archive pages don't include usernames.");
          return;
        }
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
      if (requestedUsername) {
        hasMore = false;
        setStatus("Public inventory loaded");
        renderUserProfile(requestedUsername);
        return;
      }
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
      if (requestedUsername) showUserProfileMessage(`The public archive couldn't be loaded: ${detail}`);
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

    const primeColors = [
      ["pureblack", "000000"], ["purewhite", "FFFFFF"], ["purered", "FF0000"], ["puregreen", "00FF00"], ["pureblue", "0000FF"],
      ["yellow", "FFFF00"], ["violet", "EE82EE"], ["turquoise", "40E0D0"], ["teal", "008080"], ["silver", "C0C0C0"],
      ["salmon", "FA8072"], ["ruby", "E0115F"], ["purple", "800080"], ["jade", "00A86B"], ["ivory", "FFFFF0"],
      ["indigo", "4B0082"], ["pink", "FFC0CB"], ["orange", "FFA500"], ["olive", "808000"], ["navy", "000080"],
      ["maroon", "800000"], ["magenta", "FF00FF"], ["lime", "32CD32"], ["lavender", "E6E6FA"], ["khaki", "F0E68C"],
      ["gold", "FFD700"], ["cyan", "00FFFF"], ["crimson", "DC143C"], ["coral", "FF7F50"], ["cherryblossom", "FFB7C5"],
      ["bronze", "CD7F32"], ["beige", "F5F5DC"], ["azure", "F0FFFF"], ["aquamarine", "7FFFD4"], ["amber", "FFBF00"],
    ];
    const tierXP = { Prime: 2400, "Tier 1": 900, "Tier 2": 240, "Tier 3": 65, "Tier 4": 25, "Tier 5": 8, "Tier 6": 2, "Tier 7": 0.4 };
    const dropButton = $("drop-button");
    const dropHexLabel = $("drop-hex");
    const dropStatus = $("roll-status");
    const searchInput = $("archive-search-input");
    const searchForm = $("archive-search-form");
    const searchStatus = $("archive-search-status");
    const searchResults = $("archive-search-results");
    const profileSearchForm = $("profile-search-form");
    const profileSearchInput = $("profile-search-input");
    const userInventoryList = $("user-inventory-list");
    const searchBatchSize = 120;
    let activeSearchMatches = [];
    let renderedSearchCount = 0;
    let activeUserColors = [];
    let renderedUserColorCount = 0;
    let activeBestHex = "";
    let isRolling = false;

    function getRequestedUsername() {
      const params = new URLSearchParams(window.location.search);
      const keyedUsername = params.get("username");
      if (keyedUsername?.trim()) return keyedUsername.trim().replace(/^@/, "").slice(0, 128);
      const rawQuery = window.location.search.slice(1);
      if (!rawQuery || rawQuery.includes("=") || rawQuery.includes("&")) return "";
      try { return decodeURIComponent(rawQuery.replace(/\+/g, " ")).trim().replace(/^@/, "").slice(0, 128); }
      catch { return ""; }
    }

    const requestedUsername = getRequestedUsername();
    if (requestedUsername) {
      document.body.classList.add("user-page-active");
      $("user-page").hidden = false;
      document.title = `${requestedUsername} · Color inventory | Hex Roulette`;
    }

    function randomHex() {
      const bytes = new Uint32Array(1);
      if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
      else bytes[0] = Math.floor(Math.random() * 0x1000000);
      return (bytes[0] & 0xFFFFFF).toString(16).padStart(6, "0").toUpperCase();
    }

    function formatXP(value) {
      return Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 });
    }

    function xpForTier(tier) {
      return tierXP[tier] ?? 0;
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

    function finishDropRoll(hex) {
      isRolling = false;
      dropButton.disabled = false;
      dropButton.setAttribute("aria-busy", "false");
      setDropSwatch(hex, "Tap to roll");
      dropStatus.textContent = `Drop #${hex}`;
    }

    function startDropRoll() {
      if (isRolling) return;
      isRolling = true;
      dropButton.disabled = true;
      dropButton.setAttribute("aria-busy", "true");
      dropStatus.textContent = "Rolling…";
      const finalHex = randomHex();
      const startedAt = performance.now();
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      let lastFlash = 0;
      const animate = (now) => {
        if (!isRolling) return;
        if (now - startedAt >= 2200) { finishDropRoll(finalHex); return; }
        if (now - lastFlash > (reducedMotion ? 170 : 52)) {
          setDropSwatch(randomHex(), "Rolling…", false);
          lastFlash = now;
        }
        window.requestAnimationFrame(animate);
      };
      window.requestAnimationFrame(animate);
    }

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

    function showUserProfileMessage(message) {
      if (!requestedUsername) return;
      const status = $("user-page-status");
      status.textContent = message;
      status.hidden = false;
      $("user-page-content").hidden = true;
    }

    function makeUserInventoryCard(color) {
      const card = document.createElement("article");
      card.className = `inventory-item${color.hex === activeBestHex ? " is-best" : ""}`;
      const swatch = document.createElement("span");
      swatch.className = "inventory-swatch";
      swatch.style.setProperty("--inventory-color", `#${color.hex}`);
      swatch.setAttribute("aria-label", `Color #${color.hex}`);
      const info = document.createElement("div");
      info.className = "inventory-copy";
      const title = document.createElement("strong");
      title.textContent = `#${color.hex}`;
      const meta = document.createElement("span");
      meta.textContent = `${color.tier} · ${number(color.count)} ${color.count === 1 ? "drop" : "drops"}`;
      const lastDrop = document.createElement("small");
      const lastDate = formatArchiveDate(color.lastRolledAt);
      lastDrop.textContent = lastDate ? `Last drop · ${lastDate}` : `${formatXP(color.xp)} XP per drop`;
      info.append(title, meta, lastDrop);
      const total = document.createElement("strong");
      total.className = "inventory-xp";
      total.textContent = `${formatXP(color.xp * color.count)} XP`;
      card.append(swatch, info, total);
      return card;
    }

    function renderUserInventoryBatch(reset = false) {
      if (reset) {
        renderedUserColorCount = 0;
        userInventoryList.replaceChildren();
      }
      const end = Math.min(renderedUserColorCount + searchBatchSize, activeUserColors.length);
      if (end <= renderedUserColorCount) return;
      const fragment = document.createDocumentFragment();
      for (let index = renderedUserColorCount; index < end; index += 1) {
        fragment.appendChild(makeUserInventoryCard(activeUserColors[index]));
      }
      userInventoryList.appendChild(fragment);
      renderedUserColorCount = end;
    }

    function routeToUserProfile(value) {
      const username = String(value || "").trim().replace(/^@/, "").slice(0, 128);
      if (!username) {
        if (requestedUsername) showUserProfileMessage("Enter a username to open its color inventory.");
        else {
          searchStatus.textContent = "Type a username, #HEX, or color:blue.";
          searchStatus.classList.remove("error");
          searchInput.focus();
        }
        return;
      }
      if (/^\d{15,22}$/.test(username)) {
        const message = "Search by username; numeric Discord IDs aren't available in the public archive.";
        if (requestedUsername) showUserProfileMessage(message);
        else { searchStatus.textContent = message; searchStatus.classList.add("error"); }
        return;
      }
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("username", username);
      url.hash = "";
      window.location.assign(url.toString());
    }

    function renderUserProfile(username = requestedUsername) {
      if (!username) return;
      if (!Array.isArray(archiveDropsForSearch)) {
        showUserProfileMessage("Username records are not available in this archive response.");
        return;
      }
      if (/^\d{15,22}$/.test(username)) {
        showUserProfileMessage("Search by username; numeric Discord IDs aren't available in the public archive.");
        return;
      }
      const normalizedUsername = username.toLocaleLowerCase();
      const archiveRecords = archiveDropsForSearch.map((drop, index) => archiveRecordFromDrop(drop, index)).filter(Boolean);
      let records = archiveRecords.filter((record) => record.username.toLocaleLowerCase() === normalizedUsername);
      if (!records.length) {
        const partialRecords = archiveRecords.filter((record) => record.username.toLocaleLowerCase().includes(normalizedUsername));
        const partialNames = Array.from(new Set(partialRecords.map((record) => record.username)));
        if (partialNames.length === 1) records = partialRecords;
        else if (partialNames.length > 1) {
          const examples = partialNames.slice(0, 5).join(", ");
          showUserProfileMessage(`Several usernames match “${username}”: ${examples}${partialNames.length > 5 ? ", …" : ""}. Search for a full username.`);
          return;
        }
      }
      $("user-page-title").textContent = records[0]?.username || username;
      if (records.length) document.title = `${records[0].username} · Color inventory | Hex Roulette`;
      $("user-page-subtitle").textContent = records.length
        ? `Public archive inventory · ${number(records.length)} ${records.length === 1 ? "drop" : "drops"}`
        : "Public color archive";
      if (!records.length) {
        showUserProfileMessage(`No archived drops found for “${username}”.`);
        return;
      }

      const inventory = new Map();
      let totalXP = 0;
      let bestRecord = null;
      const timestamp = (value) => { const time = Date.parse(value || ""); return Number.isFinite(time) ? time : 0; };
      for (const record of records) {
        const xp = xpForTier(record.tier);
        totalXP += xp;
        if (!bestRecord || xp > xpForTier(bestRecord.tier) || (xp === xpForTier(bestRecord.tier) && timestamp(record.rolledAt) >= timestamp(bestRecord.rolledAt))) bestRecord = record;
        const current = inventory.get(record.hex) || { hex: record.hex, tier: record.tier, xp, count: 0, lastRolledAt: "", lastIndex: -1 };
        current.count += 1;
        if (xp > current.xp) { current.xp = xp; current.tier = record.tier; }
        if (timestamp(record.rolledAt) > timestamp(current.lastRolledAt) || (!current.lastRolledAt && record.index > current.lastIndex)) {
          current.lastRolledAt = record.rolledAt;
          current.lastIndex = record.index;
        }
        inventory.set(record.hex, current);
      }
      const colors = Array.from(inventory.values()).sort((first, second) => second.xp - first.xp || second.count - first.count || first.hex.localeCompare(second.hex));
      const bestXP = xpForTier(bestRecord.tier);
      $("user-best-swatch").style.setProperty("--best-color", `#${bestRecord.hex}`);
      $("user-best-hex").textContent = `#${bestRecord.hex}`;
      const bestDate = formatArchiveDate(bestRecord.rolledAt);
      $("user-best-detail").textContent = `${bestRecord.tier} · ${formatXP(bestXP)} XP${bestDate ? ` · ${bestDate}` : ""}`;
      $("user-stat-drops").textContent = number(records.length);
      $("user-stat-xp").textContent = `${formatXP(totalXP)} XP`;
      $("user-stat-colors").textContent = number(colors.length);
      $("user-inventory-count").textContent = `${number(colors.length)} ${colors.length === 1 ? "color" : "colors"} · ${number(records.length)} drops`;

      activeBestHex = bestRecord.hex;
      activeUserColors = colors;
      renderUserInventoryBatch(true);
      $("user-page-status").hidden = true;
      $("user-page-content").hidden = false;
    }

    renderPrimeReference();
    setDropSwatch("17B29F");
    dropButton.addEventListener("click", startDropRoll);
    profileSearchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      routeToUserProfile(profileSearchInput.value);
    });
    userInventoryList.addEventListener("scroll", () => {
      if (userInventoryList.scrollTop + userInventoryList.clientHeight >= userInventoryList.scrollHeight - 80) renderUserInventoryBatch();
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
        searchStatus.textContent = "Type a username, #HEX, or color:blue.";
        searchStatus.classList.remove("error");
        searchInput.focus();
        return;
      }
      const hex = exactSearchHex(query);
      const explicitCssColor = /^color\s*:/i.test(query);
      if (hex || explicitCssColor) {
        const colorHex = hex || cssColorSearchHex(query);
        if (!colorHex) {
          searchStatus.textContent = "That color name isn't recognized. Try color:blue or #RRGGBB.";
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
      routeToUserProfile(query);
    }

    searchForm.addEventListener("submit", searchArchive);
    searchInput.addEventListener("input", () => searchStatus.classList.remove("error"));
    searchResults.addEventListener("scroll", () => {
      if (searchResults.scrollTop + searchResults.clientHeight >= searchResults.scrollHeight - 72) renderSearchBatch();
    }, { passive: true });
    updateArchiveSearchHint();
    if (requestedUsername) {
      startArchive();
    } else if ("requestIdleCallback" in window) {
      window.requestIdleCallback(startArchive, { timeout: 1500 });
    } else {
      window.setTimeout(startArchive, 0);
    }
