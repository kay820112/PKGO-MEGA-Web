// === Google Sheet 兩個工作表 ===
const SHEET_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSrBQ6lQHjl-iuSWbQJjlgJXovQRFHqQ0ML4L4VoPVjIQYXygc3VxlINrGs8nY3NqDh_z-bE38M4I-Z/pub";
const urlTypes  = `${SHEET_BASE}?gid=0&single=true&output=csv`;           // 超級淨化（名稱+屬性✔）
const urlEnergy = `${SHEET_BASE}?gid=557191716&single=true&output=csv`;   // 所需能量表（開圖、總量）

// === 狀態 ===
let data = [];           // [{ name, types:[…], open, total }]
let energyMap = {};      // { normalizedName: { open, total, rawName } }
let selectedType = "", selectedPokemon = "", searchTerm = "";

// === DOM ===
const typeSelect = document.getElementById("typeSelect");
const pokemonSelect = document.getElementById("pokemonSelect");
const searchInput = document.getElementById("searchInput");
const detailCard = document.getElementById("detailCard");
const floatingCard = document.getElementById("floatingCard");
const pokemonList = document.getElementById("pokemonList");
const listTitle = document.getElementById("listTitle");
const loadingOverlay = document.getElementById("loadingOverlay");
const clearBtn = document.getElementById("clearBtn");

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

  // 只取 B~S 欄的屬性（避免把「開放日期」抓進來）
  const headers = rows[0].slice(1, 20);

  const byName = new Set();
  data = rows.slice(1).map(r => {
    const rawName = (r[0] || "").trim();
    const name = normalizeName(rawName);
    const types = headers.filter((_, i) => r[i+1] && r[i+1].trim() === "✔");
    const e = energyMap[name] || { open:"", total:"" };
    byName.add(name);
    return { name: rawName || name, types, open: e.open, total: e.total };
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
      data.push({ name: displayName, types: [], open: e.open, total: e.total });
      const opt = document.createElement("option");
      opt.value = displayName; opt.textContent = displayName; pokemonSelect.appendChild(opt);
    }
  });
}

// ——— 卡片 HTML（抽掉 inline style，靠 CSS 控制間距） ———
function detailHTML(p){
  return `
    <span class="close-x" role="button" aria-label="關閉" title="關閉">×</span>
    <h2>${p.name}</h2>
    <div class="detail-types">
      ${p.types.map(t => `<span class="type-badge ${t}">${t}</span>`).join("") || '<span style="color:#6b7280">（此項目未標註屬性）</span>'}
    </div>
    <p>開圖能量：${p.open !== "" ? p.open : "－"}</p>
    <p>練滿能量：${p.total !== "" ? p.total : "－"}</p>
  `;
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
  };
}

function renderList(withAnimation=false){
  const filtered = data.filter(p =>
    (!selectedType || p.types.includes(selectedType)) &&
    (!searchTerm || p.name.includes(searchTerm))
  );
  listTitle.textContent = selectedType
    ? `${selectedType}屬性寶可夢 (共 ${filtered.length} 隻)`
    : `所有超級進化 / 原始回歸 (共 ${filtered.length} 隻)`;

  pokemonList.innerHTML = "";
  pokemonSelect.innerHTML = `<option value="">請選擇寶可夢</option>`;
  filtered.forEach((p, idx) => {
    const div = document.createElement("div");
    div.className = "pokemon-item" + (selectedPokemon === p.name ? " active" : "");
    if (withAnimation){ div.classList.add("fade-up"); div.style.animationDelay = `${idx*0.05}s`; }
    div.innerHTML = `<h4>${p.name}</h4>` + p.types.map(t => `<span class="type-badge ${t}">${t}</span>`).join("");
    div.onclick = () => { selectedPokemon = p.name; renderDetail(); renderList(false); };
    pokemonList.appendChild(div);

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

// 互動
typeSelect.onchange = e => { selectedType = e.target.value; selectedPokemon = ""; renderDetail(); renderList(true); };
pokemonSelect.onchange = e => { selectedPokemon = e.target.value; renderDetail(); renderList(false); };
let debounceTimer;
searchInput.oninput = e => { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => { searchTerm = e.target.value; renderList(true); }, 500); };
clearBtn.onclick = () => {
  selectedType = ""; selectedPokemon = ""; searchTerm = "";
  typeSelect.value = ""; pokemonSelect.value = ""; searchInput.value = "";
  detailCard.style.display = "none"; floatingCard.style.display = "none";
  renderList(true);
};

// 事件（平滑、低抖動）
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", () => {
  if (floatingCard.style.display === "block") syncFloatingRect();
});

// 初始化
(async function init(){
  await loadEnergy();            // 先抓能量
  await loadTypesAndMerge();     // 再抓屬性，並補齊缺漏
  renderList();
  setTimeout(() => loadingOverlay.style.display = "none", 1000);
})();
