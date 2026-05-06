(() => {
  const PALETTES = {
    sevenPastel: ["#e9d5ff", "#fef08a", "#ffffff", "#7dd3fc", "#fca5a5", "#fdba74", "#86efac"],
    pastelPair: ["#fca5a5", "#c4b5fd"],
    classic: ["#e53935", "#fb8c00", "#43a047", "#7b1fa2", "#fdd835", "#ffffff", "#4fc3f7"],
    soft: ["#fca5a5", "#fdba74", "#86efac", "#d8b4fe", "#fde047", "#f3f4f6", "#7dd3fc"],
    neon: ["#ef4444", "#f97316", "#22c55e", "#a855f7", "#eab308", "#e5e7eb", "#06b6d4"],
  };

  const PALETTE_SEQUENCE = ["sevenPastel", "pastelPair", "classic", "soft", "neon"];

  const STORAGE_KEY = "spinner-wheel-rows-v1";
  let saveRowsTimer = null;

  const R_OUTER = 0.98;
  const R_INNER = 0.2;
  const R_LABEL = R_INNER + (R_OUTER - R_INNER) * 0.75;
  const LABEL_RIM_INSET = 0.036;
  const WHEEL_PHASE_DEG = -90;

  const listEl = document.getElementById("choices-list");
  const activeBadge = document.getElementById("active-count");
  const totalBadge = document.getElementById("total-count");
  const rotateGroup = document.querySelector(".wheel-rotate");
  const spinBtn = document.getElementById("spin-btn");
  const hint = document.getElementById("spin-hint");
  const winnerDialog = document.getElementById("winner-dialog");
  const winnerNameEl = document.getElementById("winner-name");
  const resultsDialog = document.getElementById("results-dialog");
  const resultsList = document.getElementById("results-list");
  const choicesScroll = document.querySelector(".choices-scroll");
  const winnerEmojiRainEl = document.getElementById("winner-emoji-rain");

  const ANZHELIKA_NAME_RE = /anzhelika/i;
  const HAPPY_WINNER_EMOJIS = ["🎉", "🥳", "😂"];

  function nameContainsAnzhelika(text) {
    return typeof text === "string" && ANZHELIKA_NAME_RE.test(text);
  }

  function nameIsDenys(text) {
    return typeof text === "string" && text.trim().toLowerCase() === "denys";
  }

  function clearWinnerEmojiRain() {
    if (!winnerEmojiRainEl) {
      return;
    }
    winnerEmojiRainEl.innerHTML = "";
  }

  function startWinnerEmojiRain(emojiPool) {
    if (!winnerEmojiRainEl) {
      return;
    }
    winnerEmojiRainEl.innerHTML = "";
    const pool = Array.isArray(emojiPool) && emojiPool.length > 0 ? emojiPool : ["😭"];
    const count = 42;
    for (let i = 0; i < count; i += 1) {
      const span = document.createElement("span");
      span.textContent = pool[Math.floor(Math.random() * pool.length)];
      span.setAttribute("aria-hidden", "true");
      span.style.left = `${Math.random() * 92 + 4}%`;
      span.style.setProperty("--drift", `${(Math.random() - 0.5) * 48}px`);
      span.style.animationDuration = `${2.5 + Math.random() * 2.5}s`;
      span.style.animationDelay = `${Math.random() * 0.95}s`;
      span.style.fontSize = `${0.88 + Math.random() * 1.2}rem`;
      winnerEmojiRainEl.appendChild(span);
    }
  }

  let paletteName = "sevenPastel";
  let wheelAngle = 0;
  let isSpinning = false;
  let spinFrame = null;
  let lastWinnerIndex = -1;
  const results = [];

  function normalizeDeg(x) {
    return ((x % 360) + 360) % 360;
  }

  function pickTargetWinnerIndex(items) {
    const n = items.length;
    if (n <= 1) {
      return 0;
    }
    const candidates = [];
    for (let i = 0; i < n; i += 1) {
      if (i !== lastWinnerIndex) {
        candidates.push(i);
      }
    }
    if (candidates.length === 0) {
      return Math.floor(Math.random() * n);
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function finalWheelAngleForSlot(targetIdx, sliceCount) {
    for (let attempt = 0; attempt < 320; attempt += 1) {
      const d = Math.random() * 360;
      if (indexFromRotation(d, sliceCount) !== targetIdx) {
        continue;
      }
      const sliceDeg = 360 / sliceCount;
      const jitter = (Math.random() - 0.5) * sliceDeg * 0.22;
      const cand = normalizeDeg(d + jitter);
      if (indexFromRotation(cand, sliceCount) === targetIdx) {
        return cand;
      }
    }
    const sliceDeg = 360 / sliceCount;
    return normalizeDeg((targetIdx + 0.5) * sliceDeg);
  }

  function totalRotationToLand(startDeg, endDeg) {
    const start = normalizeDeg(startDeg);
    const end = normalizeDeg(endDeg);
    let diff = end - start;
    if (diff <= 0.01) {
      diff += 360;
    }
    const extraFullRotations = 4 + Math.floor(Math.random() * 4);
    return extraFullRotations * 360 + diff;
  }

  function easeOutCubic(t) {
    const u = Math.min(1, Math.max(0, t));
    return 1 - (1 - u) ** 3;
  }

  function applyRotationImmediate(degrees) {
    rotateGroup.style.transformBox = "fill-box";
    rotateGroup.style.transformOrigin = "50% 50%";
    rotateGroup.style.transform = `rotate(${degrees}deg)`;
  }

  function wedgeFill(index) {
    const row = PALETTES[paletteName] || PALETTES.sevenPastel;
    return row[index % row.length];
  }

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    if (h.length !== 6) {
      return { r: 128, g: 128, b: 128 };
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function labelFillForWedge(hex) {
    const { r, g, b } = hexToRgb(hex);
    const R = r / 255;
    const G = g / 255;
    const B = b / 255;
    const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    return L > 0.58 ? "#12161c" : "#ffffff";
  }

  function createRow(text, checked) {
    const li = document.createElement("li");
    li.className = "choice-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "choice-check";
    cb.checked = checked;
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "choice-text";
    inp.value = text;
    inp.placeholder = "Name or option";
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "row-remove";
    rm.setAttribute("aria-label", "Remove row");
    rm.textContent = "×";
    li.append(cb, inp, rm);
    syncDimmedState(li);
    return li;
  }

  function syncDimmedState(row) {
    const checked = row.querySelector(".choice-check").checked;
    row.classList.toggle("dimmed", !checked);
  }

  function readSlices() {
    const out = [];
    listEl.querySelectorAll(".choice-row").forEach((row) => {
      const checked = row.querySelector(".choice-check").checked;
      const text = row.querySelector(".choice-text").value.trim();
      if (!checked) {
        return;
      }
      if (!text) {
        return;
      }
      out.push(text);
    });
    return out;
  }

  function rowCount() {
    return listEl.querySelectorAll(".choice-row").length;
  }

  function ensureAtLeastOneRow() {
    if (rowCount() > 0) {
      return;
    }
    listEl.appendChild(createRow("", true));
  }

  function updateBadges(active, total) {
    activeBadge.textContent = String(active);
    totalBadge.textContent = String(total);
  }

  function describeWheelMessage(active) {
    if (active === 0) {
      return "Check at least one row with a name to spin.";
    }
    return "";
  }

  function wedgePath(startDeg, endDeg) {
    const s1 = (startDeg * Math.PI) / 180;
    const s2 = (endDeg * Math.PI) / 180;
    const ax = R_OUTER * Math.cos(s1);
    const ay = R_OUTER * Math.sin(s1);
    const bx = R_OUTER * Math.cos(s2);
    const by = R_OUTER * Math.sin(s2);
    const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    return [
      `M ${R_INNER * Math.cos(s1)} ${R_INNER * Math.sin(s1)}`,
      `L ${ax} ${ay}`,
      `A ${R_OUTER} ${R_OUTER} 0 ${largeArc} 1 ${bx} ${by}`,
      `L ${R_INNER * Math.cos(s2)} ${R_INNER * Math.sin(s2)}`,
      `A ${R_INNER} ${R_INNER} 0 ${largeArc} 0 ${R_INNER * Math.cos(s1)} ${R_INNER * Math.sin(s1)}`,
      "Z",
    ].join(" ");
  }

  function maxCharsPerLine(sliceDeg, fontSize, rLabel) {
    if (sliceDeg >= 350) {
      return Math.max(18, Math.min(36, Math.floor(1.15 / (fontSize * 0.55))));
    }
    const halfRad = (sliceDeg * Math.PI) / 360;
    const chord = 2 * rLabel * Math.sin(halfRad) * 0.84;
    return Math.max(5, Math.floor(chord / (fontSize * 0.46)));
  }

  function splitLabelLines(raw, sliceDeg, fontSize, rLabel) {
    const trimmed = raw.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      return [""];
    }
    const maxLine = maxCharsPerLine(sliceDeg, fontSize, rLabel);
    const words = trimmed.split(" ");
    if (trimmed.length <= maxLine) {
      return [trimmed];
    }

    if (words.length === 1) {
      if (words[0].length <= maxLine) {
        return [words[0]];
      }
      return [`${words[0].slice(0, Math.max(4, maxLine - 1))}…`];
    }

    let line1 = "";
    let idx = 0;
    while (idx < words.length) {
      const next = line1 ? `${line1} ${words[idx]}` : words[idx];
      if (next.length <= maxLine) {
        line1 = next;
        idx += 1;
        continue;
      }
      break;
    }

    if (line1 === "") {
      const w = words[0];
      line1 = w.length > maxLine ? `${w.slice(0, Math.max(3, maxLine - 1))}…` : w;
      idx = 1;
    }

    let line2 = words.slice(idx).join(" ").trim();
    if (!line2) {
      return [line1];
    }

    if (line2.length > maxLine) {
      const probe = line2.slice(0, maxLine + 1);
      const sp = probe.lastIndexOf(" ");
      if (sp > 2) {
        line2 = line2.slice(0, sp).trim();
      }
      if (line2.length > maxLine) {
        line2 = `${line2.slice(0, Math.max(3, maxLine - 1)).trim()}…`;
      }
    }

    return [line1, line2];
  }

  function sliceRadialLabelDeg(midDeg) {
    let rot = midDeg;
    while (rot > 180) {
      rot -= 360;
    }
    while (rot < -180) {
      rot += 360;
    }
    return rot;
  }

  function fontSizeForSliceCount(n) {
    if (n <= 4) {
      return 0.11;
    }
    if (n <= 8) {
      return 0.098;
    }
    if (n <= 12) {
      return 0.086;
    }
    if (n <= 18) {
      return 0.074;
    }
    return 0.062;
  }

  function appendRadialSlice(g, startDeg, endDeg, sliceDeg, fill, label, fontSize, rLabel) {
    const NS = "http://www.w3.org/2000/svg";
    const pathEl = document.createElementNS(NS, "path");
    pathEl.setAttribute("d", wedgePath(startDeg, endDeg));
    pathEl.setAttribute("fill", fill);
    pathEl.setAttribute("stroke", "rgba(255,255,255,0.42)");
    pathEl.setAttribute("stroke-width", "0.0045");

    const midDeg = startDeg + sliceDeg / 2;
    const midRad = (midDeg * Math.PI) / 180;
    const lines = splitLabelLines(label, sliceDeg, fontSize, rLabel);
    const labelRotateDeg = sliceRadialLabelDeg(midDeg);
    const lineGap = fontSize * 1.02;
    const nLines = lines.length;
    const extraInward = fontSize * 2.95;
    const twoLinePull = nLines > 1 ? lineGap * 0.48 : 0;
    const rCap = R_OUTER - LABEL_RIM_INSET - extraInward - twoLinePull;
    const rFloor = R_INNER + fontSize * 2.1;
    const rUsed = Math.max(rFloor, Math.min(rLabel, rCap));
    const cx = rUsed * Math.cos(midRad);
    const cy = rUsed * Math.sin(midRad);

    g.appendChild(pathEl);
    const labelAnchor = document.createElementNS(NS, "g");
    labelAnchor.setAttribute("transform", `translate(${cx.toFixed(6)} ${cy.toFixed(6)})`);
    const labelRot = document.createElementNS(NS, "g");
    labelRot.setAttribute("transform", `rotate(${labelRotateDeg.toFixed(4)})`);
    lines.forEach((line, j) => {
      const dy = nLines === 1 ? 0 : (j - (nLines - 1) / 2) * lineGap;
      const t = document.createElementNS(NS, "text");
      t.setAttribute("class", "wedge-label");
      t.setAttribute("fill", labelFillForWedge(fill));
      t.setAttribute("font-size", String(fontSize));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("dominant-baseline", "middle");
      t.setAttribute("x", "0");
      t.setAttribute("y", dy.toFixed(6));
      t.textContent = line;
      labelRot.appendChild(t);
    });
    labelAnchor.appendChild(labelRot);
    g.appendChild(labelAnchor);
  }

  function buildWheel(items) {
    while (rotateGroup.firstChild) {
      rotateGroup.removeChild(rotateGroup.firstChild);
    }

    const n = items.length;
    if (lastWinnerIndex >= n) {
      lastWinnerIndex = -1;
    }
    updateBadges(n, rowCount());

    if (n === 0) {
      applyRotationImmediate(wheelAngle);
      return;
    }

    const fontSize = fontSizeForSliceCount(n);

    if (n === 1) {
      const fill = wedgeFill(0);
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const sliceDeg = 360;
      appendRadialSlice(
        g,
        -sliceDeg / 2 + WHEEL_PHASE_DEG,
        sliceDeg / 2 + WHEEL_PHASE_DEG,
        sliceDeg,
        fill,
        items[0],
        fontSize,
        R_INNER + (R_OUTER - R_INNER) * 0.78
      );
      rotateGroup.appendChild(g);
      applyRotationImmediate(wheelAngle);
      return;
    }

    const sliceDeg = 360 / n;
    for (let i = 0; i < n; i += 1) {
      const startDeg = -sliceDeg / 2 + i * sliceDeg + WHEEL_PHASE_DEG;
      const endDeg = startDeg + sliceDeg;
      const fill = wedgeFill(i);
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

      appendRadialSlice(g, startDeg, endDeg, sliceDeg, fill, items[i], fontSize, R_LABEL);
      rotateGroup.appendChild(g);
    }

    applyRotationImmediate(wheelAngle);
  }

  function psiAtPointer(degrees) {
    return ((-degrees % 360) + 360) % 360;
  }

  function indexFromRotation(degrees, sliceCount) {
    if (sliceCount < 2) {
      return 0;
    }
    const sliceDeg = 360 / sliceCount;
    const adj = (psiAtPointer(degrees) - WHEEL_PHASE_DEG + 360) % 360;
    const sum = adj + sliceDeg * 0.5;
    let shifted = sum % 360;
    if (shifted < 0) {
      shifted += 360;
    }
    if (shifted >= 360) {
      shifted -= 360 * Math.floor(shifted / 360);
    }
    let slot = Math.floor(shifted / sliceDeg + 1e-10);
    if (!Number.isFinite(slot)) {
      slot = 0;
    }
    if (slot >= sliceCount) {
      slot = sliceCount - 1;
    }
    if (slot < 0) {
      slot = 0;
    }
    return slot;
  }

  function rebuildWheel() {
    if (isSpinning) {
      return;
    }
    wheelAngle = ((wheelAngle % 360) + 360) % 360;
    const items = readSlices();
    buildWheel(items);
    const missing = describeWheelMessage(items.length);
    if (missing !== "") {
      hint.textContent = missing;
      return;
    }
    hint.textContent = "";
  }

  function setListLocked(locked) {
    choicesScroll.classList.toggle("is-locked", locked);
  }

  function stopPhysicsSpin(items, winnerIdx) {
    if (spinFrame !== null) {
      cancelAnimationFrame(spinFrame);
      spinFrame = null;
    }
    isSpinning = false;
    spinBtn.disabled = false;
    setListLocked(false);

    const idx = winnerIdx;
    const winner = items[idx];
    lastWinnerIndex = idx;
    wheelAngle = normalizeDeg(wheelAngle);
    applyRotationImmediate(wheelAngle);

    clearWinnerEmojiRain();
    if (nameContainsAnzhelika(winner)) {
      startWinnerEmojiRain(["😭"]);
    } else if (nameIsDenys(winner)) {
      startWinnerEmojiRain(HAPPY_WINNER_EMOJIS);
    }

    winnerNameEl.textContent = winner;
    hint.textContent = "";
    if (typeof winnerDialog.showModal === "function") {
      winnerDialog.showModal();
    }

    results.unshift(`${new Date().toLocaleTimeString()} — ${winner}`);
    if (results.length > 20) {
      results.pop();
    }
  }

  function spin() {
    const items = readSlices();
    if (items.length === 0) {
      hint.textContent = describeWheelMessage(0);
      return;
    }

    if (isSpinning) {
      return;
    }

    hint.textContent = "Spinning…";

    const n = items.length;
    const targetIdx = pickTargetWinnerIndex(items);
    const endAngle = finalWheelAngleForSlot(targetIdx, n);
    const startAngle = normalizeDeg(wheelAngle);
    const deltaTotal = totalRotationToLand(startAngle, endAngle);
    const durationMs = 3050 + Math.random() * 1150;
    const spinStartedAt = performance.now();

    isSpinning = true;
    spinBtn.disabled = true;
    setListLocked(true);

    function tick(now) {
      if (!isSpinning) {
        return;
      }

      if (document.visibilityState === "hidden") {
        spinFrame = requestAnimationFrame(tick);
        return;
      }

      const elapsed = now - spinStartedAt;
      const t = Math.min(1, elapsed / durationMs);
      const eased = easeOutCubic(t);
      wheelAngle = startAngle + eased * deltaTotal;
      applyRotationImmediate(wheelAngle);

      if (t < 1) {
        spinFrame = requestAnimationFrame(tick);
        return;
      }

      wheelAngle = normalizeDeg(startAngle + deltaTotal);
      applyRotationImmediate(wheelAngle);
      stopPhysicsSpin(items, targetIdx);
    }

    spinFrame = requestAnimationFrame(tick);
  }

  function shuffleArray(arr) {
    const next = [...arr];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  }

  function gatherRowData() {
    return [...listEl.querySelectorAll(".choice-row")].map((row) => ({
      text: row.querySelector(".choice-text").value,
      checked: row.querySelector(".choice-check").checked,
    }));
  }

  function saveRowsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(gatherRowData()));
    } catch (_) {}
  }

  function scheduleRowsSave() {
    clearTimeout(saveRowsTimer);
    saveRowsTimer = setTimeout(saveRowsToStorage, 280);
  }

  function parseStoredRows(raw) {
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data) || data.length === 0) {
        return null;
      }
      const rows = [];
      for (let i = 0; i < data.length; i += 1) {
        const cell = data[i];
        if (!cell || typeof cell !== "object") {
          continue;
        }
        rows.push({
          text: typeof cell.text === "string" ? cell.text.slice(0, 500) : "",
          checked: cell.checked !== false,
        });
      }
      if (rows.length === 0) {
        return null;
      }
      return rows;
    } catch (_) {
      return null;
    }
  }

  function loadRowsFromStorage() {
    try {
      return parseStoredRows(localStorage.getItem(STORAGE_KEY));
    } catch (_) {
      return null;
    }
  }

  function applyRowData(rows) {
    listEl.innerHTML = "";
    rows.forEach((r) => {
      listEl.appendChild(createRow(r.text, r.checked));
    });
    ensureAtLeastOneRow();
    rebuildWheel();
    saveRowsToStorage();
  }

  listEl.addEventListener("change", (event) => {
    const row = event.target.closest(".choice-row");
    if (!row) {
      return;
    }
    if (!event.target.classList.contains("choice-check")) {
      return;
    }
    syncDimmedState(row);
    rebuildWheel();
    scheduleRowsSave();
  });

  listEl.addEventListener("input", (event) => {
    if (!event.target.classList.contains("choice-text")) {
      return;
    }
    rebuildWheel();
    scheduleRowsSave();
  });

  listEl.addEventListener("click", (event) => {
    if (!event.target.classList.contains("row-remove")) {
      return;
    }
    if (isSpinning) {
      return;
    }
    const row = event.target.closest(".choice-row");
    row.remove();
    ensureAtLeastOneRow();
    rebuildWheel();
    scheduleRowsSave();
  });

  spinBtn.addEventListener("click", spin);

  const controlsRoot = document.querySelector(".controls");
  if (controlsRoot) {
    controlsRoot.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");

        if (action === "results") {
        resultsList.innerHTML = "";
        if (results.length === 0) {
          const empty = document.createElement("li");
          empty.textContent = "No spins yet.";
          resultsList.appendChild(empty);
        }
        results.forEach((entry) => {
          const li = document.createElement("li");
          li.textContent = entry;
          resultsList.appendChild(li);
        });
          if (typeof resultsDialog.showModal === "function") {
            resultsDialog.showModal();
          }
          return;
        }

        if (isSpinning) {
          return;
        }

        if (action === "clear") {
          applyRowData([{ text: "", checked: true }]);
          return;
        }

        if (action === "shuffle") {
          applyRowData(shuffleArray(gatherRowData()));
          return;
        }

        if (action === "sort") {
          const rows = gatherRowData().sort((a, b) =>
            a.text.trim().localeCompare(b.text.trim(), undefined, { sensitivity: "base" }),
          );
          applyRowData(rows);
          return;
        }

        if (action === "add-row") {
          listEl.appendChild(createRow("", true));
          rebuildWheel();
          scheduleRowsSave();
          const lastInput = listEl.querySelector(".choice-row:last-child .choice-text");
          lastInput.focus();
          return;
        }

        if (action === "palette") {
          const cursor = Math.max(0, PALETTE_SEQUENCE.indexOf(paletteName));
          paletteName = PALETTE_SEQUENCE[(cursor + 1) % PALETTE_SEQUENCE.length];
          rebuildWheel();
        }
      });
    });
  }

  rotateGroup.style.willChange = "transform";

  winnerDialog.addEventListener("close", clearWinnerEmojiRain);

  const storedRows = loadRowsFromStorage();
  if (storedRows) {
    applyRowData(storedRows);
  } else {
    listEl.appendChild(createRow("", true));
    rebuildWheel();
    saveRowsToStorage();
  }

})();
