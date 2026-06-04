const state = {
  page: 1,
  limit: 50,
  total: 0,
  items: [],
  selectedId: '',
  adminKey: localStorage.getItem('snack_admin_key') || '',
};

const el = (id) => document.getElementById(id);

const fields = [
  ['brand', '品牌', 'text'],
  ['product_name', '商品名', 'text'],
  ['display_name', '展示名', 'text'],
  ['flavor_text', '口味', 'text'],
  ['spec_text', '规格说明', 'text'],
  ['barcode', '条码', 'text'],
  ['package_category', '分类', 'text'],
  ['review_status', '审核状态', 'select'],
  ['is_active', '是否启用', 'checkbox'],
  ['net_weight_g', '净重 g', 'number'],
  ['net_content_value', '净含量数值', 'number'],
  ['net_content_unit', '净含量单位', 'text'],
  ['unit_count', '内含数量', 'number'],
  ['unit_content_value', '单份规格', 'number'],
  ['unit_content_unit', '单份单位', 'text'],
  ['kcal_per_100g', '热量 kcal/100g', 'number'],
  ['protein_per_100g', '蛋白质 g/100g', 'number'],
  ['carbs_per_100g', '碳水 g/100g', 'number'],
  ['fat_per_100g', '脂肪 g/100g', 'number'],
  ['fiber_per_100g', '膳食纤维 g/100g', 'number'],
  ['sugar_per_100g', '糖 g/100g', 'number'],
  ['sodium_mg_per_100g', '钠 mg/100g', 'number'],
  ['ingredients_text', '配料', 'textarea'],
  ['source_image_urls', '图片 URL，每行一个', 'textarea'],
  ['ocr_raw_text', 'OCR 原文', 'textarea'],
  ['search_text', '搜索文本', 'textarea'],
];

function headers() {
  const out = { 'Content-Type': 'application/json' };
  if (state.adminKey) out['X-Admin-Key'] = state.adminKey;
  return out;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.code !== 0) {
    throw new Error(body.message || `请求失败 ${res.status}`);
  }
  return body.data;
}

function getFilters() {
  state.limit = Number(el('filter-limit').value) || 50;
  const params = new URLSearchParams({
    page: String(state.page),
    limit: String(state.limit),
    q: el('filter-q').value.trim(),
    review_status: el('filter-review').value,
    active: el('filter-active').value,
    image_state: el('filter-image').value,
  });
  return params.toString();
}

async function loadList() {
  setSummary('加载数据...');
  try {
    const data = await api(`/api/admin/packaged-foods?${getFilters()}`, { method: 'GET' });
    state.items = data.items || [];
    state.total = data.total || 0;
    renderGrid();
    updatePager();
    setSummary(`共 ${state.total} 条，当前显示 ${state.items.length} 条`);
    if (state.selectedId) {
      const selected = state.items.find((item) => item.id === state.selectedId);
      if (selected) renderEditor(selected);
    }
  } catch (err) {
    setSummary(err.message);
    el('grid').innerHTML = `<div class="empty-editor"><h2>无法加载</h2><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderGrid() {
  const grid = el('grid');
  if (!state.items.length) {
    grid.innerHTML = '<div class="empty-editor"><h2>没有结果</h2><p>换个关键词或筛选条件再试。</p></div>';
    return;
  }
  grid.innerHTML = state.items.map(renderCard).join('');
  grid.querySelectorAll('.food-card').forEach((card) => {
    card.addEventListener('click', () => selectItem(card.dataset.id));
  });
}

function renderCard(item) {
  const images = item.source_image_urls || [];
  const thumbs = images.length
    ? images.slice(0, 2).map((src) => `<img src="${escapeAttr(src)}" alt="${escapeAttr(item.display_name || item.product_name)}" loading="lazy" />`).join('')
    : '<div class="no-image">缺图片</div>';
  const selected = item.id === state.selectedId ? ' selected' : '';
  const activeClass = item.is_active ? 'active' : 'inactive';
  return `
    <article class="food-card${selected}" data-id="${escapeAttr(item.id)}">
      <div class="thumb-strip">${thumbs}</div>
      <div class="food-body">
        <h2 class="food-title">${escapeHtml(item.display_name || item.product_name || '未命名')}</h2>
        <div class="meta-row">
          <span class="pill ${activeClass}">${item.is_active ? '启用' : '停用'}</span>
          <span class="pill">${escapeHtml(item.review_status || '空状态')}</span>
          <span class="pill">${escapeHtml(item.net_content_value ? `${cleanNum(item.net_content_value)}${item.net_content_unit || ''}` : `${cleanNum(item.net_weight_g || 0)}g`)}</span>
          <span class="pill">${images.length} 图</span>
        </div>
        <div class="nutrition-line">
          <span><strong>${cleanNum(item.kcal_per_100g)}</strong>kcal</span>
          <span><strong>${cleanNum(item.protein_per_100g)}</strong>蛋白</span>
          <span><strong>${cleanNum(item.carbs_per_100g)}</strong>碳水</span>
          <span><strong>${cleanNum(item.fat_per_100g)}</strong>脂肪</span>
        </div>
      </div>
    </article>
  `;
}

async function selectItem(id) {
  state.selectedId = id;
  renderGrid();
  el('editor').innerHTML = '<div class="empty-editor"><h2>加载详情...</h2></div>';
  try {
    const data = await api(`/api/admin/packaged-foods/${encodeURIComponent(id)}`, { method: 'GET' });
    renderEditor(data.item);
  } catch (err) {
    el('editor').innerHTML = `<div class="empty-editor"><h2>详情加载失败</h2><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderEditor(item) {
  const images = item.source_image_urls || [];
  el('editor').innerHTML = `
    <form id="edit-form">
      <div class="editor-header">
        <div>
          <h2>${escapeHtml(item.display_name || item.product_name || '未命名')}</h2>
          <p>${escapeHtml(item.id)}</p>
        </div>
        <button type="button" id="reload-detail">重载</button>
      </div>
      <section class="editor-section">
        <h3>图片</h3>
        <div class="image-list">
          ${images.length ? images.map((src) => `<img src="${escapeAttr(src)}" alt="商品图片" data-full="${escapeAttr(src)}" loading="lazy" />`).join('') : '<p class="notice">这条记录没有图片。</p>'}
        </div>
      </section>
      <section class="editor-section">
        <h3>商品与规格</h3>
        <div class="form-grid">${renderFields(item, ['brand', 'product_name', 'display_name', 'flavor_text', 'spec_text', 'barcode', 'package_category', 'review_status', 'is_active', 'net_weight_g', 'net_content_value', 'net_content_unit', 'unit_count', 'unit_content_value', 'unit_content_unit'])}</div>
      </section>
      <section class="editor-section">
        <h3>核心营养</h3>
        <div class="form-grid">${renderFields(item, ['kcal_per_100g', 'protein_per_100g', 'carbs_per_100g', 'fat_per_100g', 'fiber_per_100g', 'sugar_per_100g', 'sodium_mg_per_100g'])}</div>
      </section>
      <section class="editor-section">
        <h3>证据与搜索</h3>
        <div class="form-grid">${renderFields(item, ['ingredients_text', 'source_image_urls', 'ocr_raw_text', 'search_text'])}</div>
        <p class="notice">保存商品名、规格、口味、净含量后，后台会同步刷新 normalized_name、product_key、display_name、search_text 等搜索字段。</p>
      </section>
      <div class="actions">
        <button type="button" id="copy-id">复制 ID</button>
        <button class="primary" type="submit">保存修改</button>
      </div>
    </form>
  `;
  el('reload-detail').addEventListener('click', () => selectItem(item.id));
  el('copy-id').addEventListener('click', () => navigator.clipboard?.writeText(item.id));
  el('edit-form').addEventListener('submit', (event) => saveCurrent(event, item.id));
  el('editor').querySelectorAll('.image-list img').forEach((img) => {
    img.addEventListener('click', () => openImage(img.dataset.full));
  });
}

function renderFields(item, keys) {
  return keys.map((key) => {
    const config = fields.find((field) => field[0] === key);
    if (!config) return '';
    const [, label, type] = config;
    const value = key === 'source_image_urls' ? (item[key] || []).join('\n') : item[key];
    const wide = type === 'textarea' || key === 'display_name' || key === 'spec_text' ? ' wide' : '';
    if (type === 'textarea') {
      return `<div class="field${wide}"><label>${label}<textarea name="${key}" rows="${key === 'ocr_raw_text' ? 8 : 4}">${escapeHtml(value || '')}</textarea></label></div>`;
    }
    if (type === 'select') {
      const options = ['active', 'pending', 'web_verified', 'rejected_missing_net_content', 'rejected', 'inactive'];
      return `<div class="field${wide}"><label>${label}<select name="${key}">${options.map((opt) => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('')}</select></label></div>`;
    }
    if (type === 'checkbox') {
      return `<div class="field${wide}"><label>${label}<select name="${key}"><option value="true" ${item.is_active ? 'selected' : ''}>启用</option><option value="false" ${!item.is_active ? 'selected' : ''}>停用</option></select></label></div>`;
    }
    return `<div class="field${wide}"><label>${label}<input name="${key}" type="${type}" step="0.01" value="${escapeAttr(value ?? '')}" /></label></div>`;
  }).join('');
}

async function saveCurrent(event, id) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {};
  fields.forEach(([key, , type]) => {
    if (!form.has(key)) return;
    const raw = String(form.get(key) ?? '').trim();
    if (key === 'source_image_urls') {
      payload[key] = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    } else if (type === 'number') {
      payload[key] = raw === '' ? 0 : Number(raw);
    } else if (type === 'checkbox') {
      payload[key] = raw === 'true';
    } else {
      payload[key] = raw;
    }
  });
  setSummary('正在保存...');
  try {
    const data = await api(`/api/admin/packaged-foods/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    setSummary('保存成功');
    const idx = state.items.findIndex((item) => item.id === id);
    if (idx >= 0) state.items[idx] = data.item;
    renderGrid();
    renderEditor(data.item);
  } catch (err) {
    setSummary(err.message);
    alert(err.message);
  }
}

function openImage(src) {
  if (!src) return;
  el('dialog-image').src = src;
  el('image-dialog').showModal();
}

function updatePager() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.limit));
  el('page-indicator').textContent = `第 ${state.page} / ${totalPages} 页`;
  el('prev-page').disabled = state.page <= 1;
  el('next-page').disabled = state.page >= totalPages;
}

function setSummary(text) {
  el('result-summary').textContent = text;
}

function cleanNum(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 0.005) return String(Math.round(n));
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

el('admin-key').value = state.adminKey;
el('auth-form').addEventListener('submit', (event) => {
  event.preventDefault();
  state.adminKey = el('admin-key').value.trim();
  localStorage.setItem('snack_admin_key', state.adminKey);
  loadList();
});
el('refresh-btn').addEventListener('click', () => {
  state.page = 1;
  loadList();
});
['filter-review', 'filter-active', 'filter-image', 'filter-limit'].forEach((id) => {
  el(id).addEventListener('change', () => {
    state.page = 1;
    loadList();
  });
});
el('filter-q').addEventListener('input', debounce(() => {
  state.page = 1;
  loadList();
}, 350));
el('prev-page').addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    loadList();
  }
});
el('next-page').addEventListener('click', () => {
  if (state.page * state.limit < state.total) {
    state.page += 1;
    loadList();
  }
});
el('close-image').addEventListener('click', () => el('image-dialog').close());
el('image-dialog').addEventListener('click', (event) => {
  if (event.target === el('image-dialog')) el('image-dialog').close();
});

loadList();
