// === Google Sheet 兩個工作表 ===
const SHEET_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSrBQ6lQHjl-iuSWbQJjlgJXovQRFHqQ0ML4L4VoPVjIQYXygc3VxlINrGs8nY3NqDh_z-bE38M4I-Z/pub";
const urlTypes  = `${SHEET_BASE}?gid=0&single=true&output=csv`;           // 超級淨化（名稱+屬性✔ + 優先度）
const urlEnergy = `${SHEET_BASE}?gid=557191716&single=true&output=csv`;   // 所需能量表（開圖、總量）

// ==== 新增：等級排序權重（數字越小排越前）====
const RANK_ORDER = {
  '頂尖級': 0,
  '高階級': 1,
  '基礎級': 2
};

// （可選）同義字或亂大小寫時，先標準化
function normRank(str) {
  if (!str) return '';
  const s = String(str).trim();
  if (s.includes('頂')) return '頂尖級';
  if (s.includes('高')) return '高階級';
  if (s.includes('基')) return '基礎級';
  return s;
}

// === 狀態 ===
let data = [];           // [{ name, types:[…], open, total, priority }]
let energyMap = {};      // { normalizedName: { open, total, rawName } }
let selectedType = "", selectedPokemon = "", searchTerm = "";

// === DOM ===
const typeSelect    = document.getElementById("typeSelect");
const pokemonSelect = document.getElementById("pokemonSelect");
const searchInput   = document.getElementById("searchInput");
const detailCard    = document.getElementById("detailCard");
const floatingCard  = document.getElementById("floatingCard");
const pokemonList   = document.getElementById("pokemonList");
const listTitle     = document.getElementById("listTitle");
const loadingOverlay= document.getElementById("loadingOverlay");
const clearBtn      = document.getElementById("clearBtn");
listTitle.setAttribute("aria-live","polite"); // 動態更新讓讀屏朗讀

// —— 本機快取（離線/弱網也能開） ——
const LS_KEY = "mega_data_cache_v1";
function saveCache(d){ try{ localStorage.setItem(LS_KEY, JSON.stringify({d, t:Date.now()})); }catch(_){} }
function loadCache(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return null;
    const {d,t} = JSON.parse(raw);
    return { data:d, ageMs: Date.now()-t };
  }catch(_){ return null; }
}

// CSV
function parseCSV(text){ return text.replace(/\r/g,"").split("\n").map(r => r.split(",")); }

// 名稱正規化
function normalizeName(name){
  if (!name) return "";
  let n = name.trim();
  n = n.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)); // 全形→半形
  n = n.replace(/\s+/g, ""); // 去空白
  if (n === "超級噴火龍Ｘ") n = "超級噴火龍X";
  if (n === "超級噴火龍Ｙ") n = "超級噴火龍Y";
  return n;
}

// 讀能量表（處理左右兩張表塊：名稱在0欄，開圖+1，總量+5）
async function loadEnergy(){
  const res = await fetch(urlEnergy);
  const rows = parseCSV(await res.text());
  for (let i = 1; i < rows.length; i++){
    const row = rows[i];
    for (let j = 0; j < row.length; j++){
      const raw = row[j] && row[j].trim();
      if (!raw) continue;
      if (/^(超|原始)/.test(raw)){
        const name = normalizeName(raw);
        const open = row[j+1]?.trim();
        const total = row[j+5]?.trim();
        if ((open && !isNaN(open)) || (total && !isNaN(total))){
          energyMap[name] = {
            open:  open  && !isNaN(open)  ? Number(open)  : "",
            total: total && !isNaN(total) ? Number(total) : "",
            rawName: raw
          };
        }
        j += 5;
      }
    }
  }
}

// 讀屬性✔表 + 合併能量；補齊能量表有而屬性表沒有的項目
async function loadTypesAndMerge(){
  const res = await fetch(urlTypes);
  const rows = parseCSV(await res.text());

  // 只取 B~T 欄作為屬性；V 欄是優先度
  const headers = rows[0].slice(1, 20);              // B..T
  const PRIORITY_COL_INDEX = 21;                      // 欄 V：優先度

  const byName = new Set();
  data = rows.slice(1).map(r => {
    const rawName = (r[0] || "").trim();
    const name = normalizeName(rawName);
    const types = headers.filter((_, i) => r[i+1] && r[i+1].trim() === "✔");
    const priority = (r[PRIORITY_COL_INDEX] || "").trim();
    const e = energyMap[name] || { open:"", total:"" };
    byName.add(name);
    return { name: rawName || name, types, open: e.open, total: e.total, priority };
  });

  // 下拉選單
  headers.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t; typeSelect.appendChild(opt);
  });
  data.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.name; opt.textContent = p.name; pokemonSelect.appendChild(opt);
  });

  // 補齊（例如原始蓋歐卡/固拉多）
  Object.keys(energyMap).forEach(norm => {
    if (!byName.has(norm)){
      const e = energyMap[norm];
      const displayName = e.rawName || norm;
      data.push({ name: displayName, types: [], open: e.open, total: e.total, priority: "" });
      const opt = document.createElement("option");
      opt.value = displayName; opt.textContent = displayName; pokemonSelect.appendChild(opt);
    }
  });
}

// ——— 卡片 HTML（新增右方備註欄，自動儲存） ———
function detailHTML(p){
  const savedNote = localStorage.getItem("note_" + p.name) || "";
  const savedRank = localStorage.getItem("rank_" + p.name) || "";

  return `
    <span class="close-x" role="button" aria-label="關閉" title="關閉">×</span>
    <div style="display:flex; gap:20px; align-items:flex-start;">
      <!-- 左側原有資訊 -->
      <div style="flex:1; min-width:0;">
        <h2>${p.name}</h2>
        <div class="detail-types">
          ${p.types.map(t => `<span class="type-badge ${t}">${t}</span>`).join("") || '<span style="color:#6b7280">（此項目未標註屬性）</span>'}
        </div>
        <p>開圖能量：${p.open !== "" ? p.open : "－"}</p>
        <p>練滿能量：${p.total !== "" ? p.total : "－"}</p>
        <p>推薦程度：${p.priority && p.priority !== "" ? p.priority : "－"}</p>

        <select id="rank_${p.name}"
          style="margin-top:4px; padding:4px; border-radius:6px; border:1px solid #ccc;"
          onchange="localStorage.setItem('rank_${p.name}', this.value); updateListRank('${p.name}', this.value)">
          <option value="" ${savedRank==="" ? "selected" : ""}>－</option>
          <option value="基礎級" ${savedRank==="基礎級" ? "selected" : ""}>基礎級</option>
          <option value="高階級" ${savedRank==="高階級" ? "selected" : ""}>高階級</option>
          <option value="頂尖級" ${savedRank==="頂尖級" ? "selected" : ""}>頂尖級</option>
        </select>
      </div>

      <!-- 右側備註區 -->
      <div style="flex:1; min-width:0;">
        <label for="note_${p.name}" style="font-weight:600;display:block;margin-bottom:4px;">備註</label>
        <textarea id="note_${p.name}" rows="8"
          style="width:100%;resize:vertical;max-height:200px;padding:8px;border:1px solid #ccc;border-radius:8px;box-sizing:border-box;"
          oninput="localStorage.setItem('note_${p.name}', this.value)">${savedNote}</textarea>
      </div>
    </div>
  `;
}

// 儲存備註
function saveNote(name){
  const val = document.getElementById("note_" + name).value;
  localStorage.setItem("note_" + name, val);
  alert("已儲存備註！");
}

function renderDetail(){
  if (!selectedPokemon){ 
    detailCard.style.display = "none";
    floatingCard.style.display = "none";
    return; 
  }
  const p = data.find(x => x.name === selectedPokemon);
  const html = detailHTML(p);

  // 原位卡片
  detailCard.style.display = "block";
  detailCard.innerHTML = html;

  // 浮動鏡像卡片（內容同步；尺寸與位置由 syncFloatingRect 控制）
  floatingCard.innerHTML = html;

  // 綁定兩個卡片內的 X 關閉
  bindCloseX(detailCard);
  bindCloseX(floatingCard);

  // 初次顯示就對齊一次並判斷是否浮起
  syncFloatingRect();
  onScroll();
}

// 綁定卡片內 X 事件
function bindCloseX(container){
  const x = container.querySelector(".close-x");
  if (!x) return;
  x.onclick = (e) => {
    e.stopPropagation();
    selectedPokemon = "";
    detailCard.style.display = "none";
    floatingCard.style.display = "none";
    // 同步 UI
    pokemonSelect.value = "";
    syncURL();
  };
}

function updateListRank(name, rank){
  const el = document.querySelector(`#pokemonList .pokemon-item[data-name="${name}"] .rank-label`);
  if (el){
    el.textContent = rank ? `(${rank})` : "";
  }
  // 等級變更後即時重排清單
  if (typeof renderList === 'function') {
    renderList(false);
  }
}


function renderList(withAnimation=false){
  const filtered = data.filter(p =>
    (!selectedType || p.types.includes(selectedType)) &&
    (!searchTerm || p.name.includes(searchTerm))
  );
  listTitle.textContent = selectedType
    ? `${selectedType}屬性寶可夢 (共 ${filtered.length} 隻)`
    : `所有超級進化 / 原始回歸 (共 ${filtered.length} 隻)`;

  // === 新增：依「已選等級」排序（同級則依名稱） ===
  const sorted = filtered.slice().sort((a, b) => {
    const sa = localStorage.getItem("rank_" + a.name) || "";
    const sb = localStorage.getItem("rank_" + b.name) || "";
    const ra = RANK_ORDER[normRank(sa)] ?? 99;
    const rb = RANK_ORDER[normRank(sb)] ?? 99;
    if (ra !== rb) return ra - rb;
    return String(a.name).localeCompare(String(b.name), 'zh-Hant');
  });

  pokemonList.innerHTML = "";
  pokemonSelect.innerHTML = `<option value="">請選擇寶可夢</option>`;

  // === 修改：改用 sorted 來生成卡片 ===
  sorted.forEach((p, idx) => {
    const div = document.createElement("div");
    div.className = "pokemon-item" + (selectedPokemon === p.name ? " active" : "");
    if (withAnimation){ div.classList.add("fade-up"); div.style.animationDelay = `${idx*0.05}s`; }

    const savedRank = localStorage.getItem("rank_" + p.name) || "";
    const rankLabel = savedRank
      ? `<span class="rank-label" style="font-size:12px;color:#555;margin-left:4px;">(${savedRank})</span>`
      : `<span class="rank-label"></span>`;

    div.innerHTML = `
      <h4>${p.name} ${rankLabel}</h4>
      ${p.types.map(t => `<span class="type-badge ${t}">${t}</span>`).join("")}
    `;
    div.dataset.name = p.name;

    // 滑鼠與鍵盤都可操作
    div.setAttribute("tabindex","0");
    const selectThis = () => { selectedPokemon = p.name; renderDetail(); renderList(false); syncURL(); };
    div.onclick = selectThis;
    div.onkeydown = (e) => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); selectThis(); } };
    pokemonList.appendChild(div);

    // 下拉選單同步
    const opt = document.createElement("option");
    opt.value = p.name; opt.textContent = p.name; pokemonSelect.appendChild(opt);
  });
}

// —— 與原位卡片同寬同位，並加邊界保護，避免超出視窗 —— 
function syncFloatingRect(){
  if (detailCard.style.display === "none") return;

  const rect = detailCard.getBoundingClientRect();
  const PADDING = 10;                 // 視窗左右保留邊距
  const vw = window.innerWidth;

  let width = rect.width;             // 使用 border-box 寬
  width = Math.min(width, vw - 2 * PADDING);
  width = Math.max(width, 0);

  let left = rect.left;
  left = Math.max(left, PADDING);
  left = Math.min(left, vw - width - PADDING);

  floatingCard.style.width = width + "px";
  floatingCard.style.left  = left + "px";
}

// —— 頂邊觸發：卡片頂邊一到就浮起；rAF 平滑更新 —— 
let ticking = false;
function onScroll(){
  if (detailCard.style.display === "none") {
    if (floatingCard.style.display !== "none") floatingCard.style.display = "none";
    return;
  }
  if (!ticking){
    window.requestAnimationFrame(() => {
      const rect = detailCard.getBoundingClientRect();
      const shouldFloat = rect.top <= 10; // 10px 緩衝

      if (shouldFloat){
        if (floatingCard.style.display !== "block") {
          floatingCard.style.display = "block";
          syncFloatingRect();
          bindCloseX(floatingCard);
        } else {
          syncFloatingRect();
        }
      } else {
        if (floatingCard.style.display !== "none") {
          floatingCard.style.display = "none";
        }
      }
      ticking = false;
    });
    ticking = true;
  }
}

// —— URL 同步：可分享目前狀態 —— 
function syncURL(){
  const u = new URL(location);
  selectedType    ? u.searchParams.set("type", selectedType) : u.searchParams.delete("type");
  selectedPokemon ? u.searchParams.set("name", selectedPokemon) : u.searchParams.delete("name");
  searchTerm      ? u.searchParams.set("q", searchTerm) : u.searchParams.delete("q");
  history.replaceState(null,"",u);
}

// 互動
typeSelect.onchange = e => { selectedType = e.target.value; selectedPokemon = ""; renderDetail(); renderList(true); syncURL(); };
pokemonSelect.onchange = e => { selectedPokemon = e.target.value; renderDetail(); renderList(false); syncURL(); };
let debounceTimer;
searchInput.oninput = e => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { searchTerm = e.target.value; renderList(true); syncURL(); }, 300);
};
clearBtn.onclick = () => {
  selectedType = ""; selectedPokemon = ""; searchTerm = "";
  typeSelect.value = ""; pokemonSelect.value = ""; searchInput.value = "";
  detailCard.style.display = "none"; floatingCard.style.display = "none";
  renderList(true); syncURL();
};

// 事件（平滑、低抖動）
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", () => {
  if (floatingCard.style.display === "block") syncFloatingRect();
});

// —— 讀取 URL 參數預設狀態（可從分享連結打開） ——
(() => {
  const params = new URLSearchParams(location.search);
  selectedType    = params.get("type") || "";
  selectedPokemon = params.get("name") || "";
  searchTerm      = params.get("q") || "";
})();

// 初始化（雙保險關閉 Loading；支援快取離線）
(async function init(){
  const show = () => { if (loadingOverlay) loadingOverlay.style.display = "flex"; };
  const hide = () => { if (loadingOverlay) loadingOverlay.style.display = "none"; };
  const showTimer = setTimeout(show, 200); // 超過 200ms 才顯示 Loading

  // 1) 有快取先畫，讓行動裝置立即可互動
  const cache = loadCache();
  if (cache?.data?.length){
    data = cache.data;
    renderList();
    if (selectedPokemon){ renderDetail(); }
  }

  try {
    // 2) 背景抓最新資料
    await loadEnergy();
    await loadTypesAndMerge();
    renderList();
    if (selectedPokemon){ renderDetail(); }
    // 3) 存快取
    saveCache(data);
  } catch (err) {
    console.error("[init] 資料讀取失敗：", err);
    if (!cache?.data?.length){
      pokemonList.innerHTML = `<div style="color:#6b7280;padding:12px">目前連線異常，請稍後再試。</div>`;
    }
  } finally {
    clearTimeout(showTimer);
    hide();
  }
})();