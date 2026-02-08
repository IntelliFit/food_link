/**
 * 食物分析测试后台前端脚本
 */

// 全局状态
let currentResults = [];
let batchFile = null;
let singleFile = null;

// 提示词管理状态
let currentModelType = 'qwen';
let promptsList = [];
let activePrompt = null;
let originalActivePrompt = null; // 用于重置

// DOM 元素
const elements = {
    // 选项卡
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabPanels: document.querySelectorAll('.tab-panel'),
    
    // 批量测试
    batchUploadArea: document.getElementById('batch-upload-area'),
    batchFileInput: document.getElementById('batch-file-input'),
    batchFileInfo: document.getElementById('batch-file-info'),
    batchAnalyzeBtn: document.getElementById('batch-analyze-btn'),
    batchProgress: document.getElementById('batch-progress'),
    progressFill: document.getElementById('progress-fill'),
    progressText: document.getElementById('progress-text'),
    
    // 单张图片测试
    singleUploadArea: document.getElementById('single-upload-area'),
    singleFileInput: document.getElementById('single-file-input'),
    imagePreview: document.getElementById('image-preview'),
    previewImg: document.getElementById('preview-img'),
    trueWeight: document.getElementById('true-weight'),
    singleAnalyzeBtn: document.getElementById('single-analyze-btn'),
    
    // 结果区域
    resultsSection: document.getElementById('results-section'),
    summaryCard: document.getElementById('summary-card'),
    summaryGrid: document.getElementById('summary-grid'),
    sortSelect: document.getElementById('sort-select'),
    exportBtn: document.getElementById('export-btn'),
    resultsBody: document.getElementById('results-body'),
    
    // 模态框
    detailModal: document.getElementById('detail-modal'),
    modalTitle: document.getElementById('modal-title'),
    modalBody: document.getElementById('modal-body'),
    
    // 加载遮罩
    loadingOverlay: document.getElementById('loading-overlay')
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initBatchUpload();
    initSingleUpload();
    initSortAndExport();
    initPromptsManagement();
});

// 选项卡初始化
function initTabs() {
    elements.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            
            elements.tabBtns.forEach(b => b.classList.remove('active'));
            elements.tabPanels.forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(`${tabId}-panel`).classList.add('active');
            
            // 切换到提示词管理时加载数据
            if (tabId === 'prompts') {
                loadPrompts();
            }
        });
    });
}

// 批量上传初始化
function initBatchUpload() {
    const area = elements.batchUploadArea;
    const input = elements.batchFileInput;
    
    // 点击上传
    area.addEventListener('click', () => input.click());
    
    // 拖拽上传
    area.addEventListener('dragover', (e) => {
        e.preventDefault();
        area.classList.add('dragover');
    });
    
    area.addEventListener('dragleave', () => {
        area.classList.remove('dragover');
    });
    
    area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.zip')) {
            setBatchFile(file);
        } else {
            alert('请上传 ZIP 文件');
        }
    });
    
    // 文件选择
    input.addEventListener('change', () => {
        if (input.files[0]) {
            setBatchFile(input.files[0]);
        }
    });
    
    // 开始分析
    elements.batchAnalyzeBtn.addEventListener('click', startBatchAnalysis);
}

// 单张图片上传初始化
function initSingleUpload() {
    const area = elements.singleUploadArea;
    const input = elements.singleFileInput;
    
    area.addEventListener('click', () => input.click());
    
    input.addEventListener('change', () => {
        if (input.files[0]) {
            setSingleFile(input.files[0]);
        }
    });
    
    // 监听重量输入
    elements.trueWeight.addEventListener('input', updateSingleAnalyzeBtn);
    
    // 开始分析
    elements.singleAnalyzeBtn.addEventListener('click', startSingleAnalysis);
}

// 排序和导出初始化
function initSortAndExport() {
    elements.sortSelect.addEventListener('change', () => {
        sortResults(elements.sortSelect.value);
    });
    
    elements.exportBtn.addEventListener('click', exportToCSV);
}

// 设置批量文件
function setBatchFile(file) {
    batchFile = file;
    elements.batchFileInfo.style.display = 'flex';
    elements.batchFileInfo.querySelector('.file-name').textContent = file.name;
    elements.batchAnalyzeBtn.disabled = false;
}

// 清除批量文件
function clearBatchFile() {
    batchFile = null;
    elements.batchFileInput.value = '';
    elements.batchFileInfo.style.display = 'none';
    elements.batchAnalyzeBtn.disabled = true;
}

// 设置单张图片文件
function setSingleFile(file) {
    singleFile = file;
    
    // 显示预览
    const reader = new FileReader();
    reader.onload = (e) => {
        elements.previewImg.src = e.target.result;
        elements.imagePreview.style.display = 'block';
        elements.singleUploadArea.style.display = 'none';
    };
    reader.readAsDataURL(file);
    
    updateSingleAnalyzeBtn();
}

// 清除单张图片文件
function clearSingleFile() {
    singleFile = null;
    elements.singleFileInput.value = '';
    elements.imagePreview.style.display = 'none';
    elements.singleUploadArea.style.display = 'block';
    updateSingleAnalyzeBtn();
}

// 更新单张图片分析按钮状态
function updateSingleAnalyzeBtn() {
    const hasFile = singleFile !== null;
    const hasWeight = elements.trueWeight.value && parseFloat(elements.trueWeight.value) > 0;
    elements.singleAnalyzeBtn.disabled = !(hasFile && hasWeight);
}

// 开始批量分析
async function startBatchAnalysis() {
    if (!batchFile) return;
    
    // 如果已有结果，提示用户确认
    if (currentResults.length > 0) {
        const confirmed = confirm('当前已有分析结果，重新分析将覆盖现有数据。\n\n是否已保存当前结果？点击"确定"继续分析，点击"取消"返回保存。');
        if (!confirmed) return;
    }
    
    showLoading();
    elements.batchProgress.style.display = 'block';
    elements.progressFill.style.width = '0%';
    elements.progressText.textContent = '上传文件中...';
    
    try {
        const formData = new FormData();
        formData.append('file', batchFile);
        
        const response = await authFetch('/api/test/batch-upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || '分析失败');
        }
        
        const result = await response.json();
        
        if (result.success) {
            currentResults = result.data;
            displayResults(result.data, result.summary);
            elements.progressFill.style.width = '100%';
            elements.progressText.textContent = '分析完成！';
        } else {
            throw new Error(result.message || '分析失败');
        }
    } catch (error) {
        alert('分析失败: ' + error.message);
        elements.batchProgress.style.display = 'none';
    } finally {
        hideLoading();
    }
}

// 开始单张图片分析
async function startSingleAnalysis() {
    if (!singleFile || !elements.trueWeight.value) return;
    
    // 如果已有结果，提示用户确认
    if (currentResults.length > 0) {
        const confirmed = confirm('当前已有分析结果，重新分析将覆盖现有数据。\n\n是否已保存当前结果？点击"确定"继续分析，点击"取消"返回保存。');
        if (!confirmed) return;
    }
    
    showLoading();
    
    try {
        const formData = new FormData();
        formData.append('image', singleFile);
        formData.append('trueWeight', elements.trueWeight.value);
        
        const response = await authFetch('/api/test/single-image', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || '分析失败');
        }
        
        const result = await response.json();
        
        if (result.success) {
            currentResults = [result.data];
            displayResults([result.data], null);
        } else {
            throw new Error(result.message || '分析失败');
        }
    } catch (error) {
        alert('分析失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 显示结果
function displayResults(results, summary) {
    elements.resultsSection.style.display = 'block';
    
    // 显示汇总统计
    if (summary) {
        elements.summaryCard.style.display = 'block';
        elements.summaryGrid.innerHTML = `
            <div class="stat-card">
                <div class="label">总图片数</div>
                <div class="value">${summary.totalImages}</div>
            </div>
            <div class="stat-card">
                <div class="label">成功分析</div>
                <div class="value good">${summary.successfulCount}</div>
            </div>
            <div class="stat-card">
                <div class="label">千问平均偏差</div>
                <div class="value qwen">${summary.qwenStats.avgDeviation ?? '-'}%</div>
            </div>
            <div class="stat-card">
                <div class="label">Gemini 平均偏差</div>
                <div class="value gemini">${summary.geminiStats.avgDeviation ?? '-'}%</div>
            </div>
            <div class="stat-card">
                <div class="label">千问中位数偏差</div>
                <div class="value qwen">${summary.qwenStats.medianDeviation ?? '-'}%</div>
            </div>
            <div class="stat-card">
                <div class="label">Gemini 中位数偏差</div>
                <div class="value gemini">${summary.geminiStats.medianDeviation ?? '-'}%</div>
            </div>
        `;
    } else {
        elements.summaryCard.style.display = 'none';
    }
    
    // 显示表格
    renderResultsTable(results);
    
    // 滚动到结果区域
    elements.resultsSection.scrollIntoView({ behavior: 'smooth' });
}

// 渲染结果表格
function renderResultsTable(results) {
    elements.resultsBody.innerHTML = results.map((item, index) => {
        const qwenWeight = item.qwenResult?.estimatedWeight ?? '-';
        const qwenDeviation = item.qwenResult?.deviation;
        const geminiWeight = item.geminiResult?.estimatedWeight ?? '-';
        const geminiDeviation = item.geminiResult?.deviation;
        
        return `
            <tr>
                <td>
                    <div class="image-cell">
                        <span>${item.imageName}</span>
                    </div>
                </td>
                <td>${item.trueWeight}g</td>
                <td>${qwenWeight === '-' ? '-' : qwenWeight + 'g'}</td>
                <td>${renderDeviation(qwenDeviation, item.qwenResult?.error)}</td>
                <td>${geminiWeight === '-' ? '-' : geminiWeight + 'g'}</td>
                <td>${renderDeviation(geminiDeviation, item.geminiResult?.error)}</td>
                <td>
                    <button class="detail-btn" onclick="showDetail(${index})">查看详情</button>
                </td>
            </tr>
        `;
    }).join('');
}

// 渲染偏差值
function renderDeviation(deviation, error) {
    if (error) {
        return `<span class="deviation error" title="${error}">错误</span>`;
    }
    if (deviation === undefined || deviation === null) {
        return '-';
    }
    
    let className = 'good';
    if (deviation >= 30) {
        className = 'bad';
    } else if (deviation >= 10) {
        className = 'medium';
    }
    
    return `<span class="deviation ${className}">${deviation}%</span>`;
}

// 显示详情
function showDetail(index) {
    const item = currentResults[index];
    elements.modalTitle.textContent = `${item.imageName} - 分析详情`;
    
    elements.modalBody.innerHTML = `
        <div class="detail-section">
            <h4>基本信息</h4>
            <div class="detail-item">
                <span class="label">真实重量</span>
                <span class="value">${item.trueWeight}g</span>
            </div>
        </div>
        
        <div class="detail-section">
            <h4>模型对比</h4>
            <div class="detail-grid">
                ${renderModelDetail('千问模型', 'qwen', item.qwenResult)}
                ${renderModelDetail('Gemini 模型', 'gemini', item.geminiResult)}
            </div>
        </div>
    `;
    
    elements.detailModal.classList.add('active');
}

// 渲染模型详情
function renderModelDetail(title, type, result) {
    if (!result) {
        return `
            <div class="detail-column">
                <h5 class="${type}">${title}</h5>
                <p>无数据</p>
            </div>
        `;
    }
    
    if (result.error) {
        return `
            <div class="detail-column">
                <h5 class="${type}">${title}</h5>
                <p style="color: #c62828;">错误: ${result.error}</p>
            </div>
        `;
    }
    
    const foodItems = (result.items || []).map(food => `
        <div class="food-item">
            <div class="name">${food.name}</div>
            <div class="weight">${food.estimatedWeightGrams}g | ${food.nutrients?.calories || 0} kcal</div>
        </div>
    `).join('');
    
    return `
        <div class="detail-column">
            <h5 class="${type}">${title}</h5>
            <div class="detail-item">
                <span class="label">估算总重量</span>
                <span class="value">${result.estimatedWeight}g</span>
            </div>
            <div class="detail-item">
                <span class="label">偏差</span>
                <span class="value">${result.deviation}%</span>
            </div>
            <div class="detail-item">
                <span class="label">描述</span>
                <span class="value">${result.description || '-'}</span>
            </div>
            <div class="detail-item">
                <span class="label">建议</span>
                <span class="value">${result.insight || '-'}</span>
            </div>
            <div class="food-list">
                <div class="label">识别食物:</div>
                ${foodItems || '<p>无</p>'}
            </div>
        </div>
    `;
}

// 关闭模态框
function closeModal() {
    elements.detailModal.classList.remove('active');
}

// 点击模态框外部关闭
elements.detailModal.addEventListener('click', (e) => {
    if (e.target === elements.detailModal) {
        closeModal();
    }
});

// 排序结果
function sortResults(sortBy) {
    const sorted = [...currentResults];
    
    switch (sortBy) {
        case 'name':
            sorted.sort((a, b) => a.imageName.localeCompare(b.imageName));
            break;
        case 'qwen-deviation':
            sorted.sort((a, b) => (a.qwenResult?.deviation ?? 999) - (b.qwenResult?.deviation ?? 999));
            break;
        case 'qwen-deviation-desc':
            sorted.sort((a, b) => (b.qwenResult?.deviation ?? -1) - (a.qwenResult?.deviation ?? -1));
            break;
        case 'gemini-deviation':
            sorted.sort((a, b) => (a.geminiResult?.deviation ?? 999) - (b.geminiResult?.deviation ?? 999));
            break;
        case 'gemini-deviation-desc':
            sorted.sort((a, b) => (b.geminiResult?.deviation ?? -1) - (a.geminiResult?.deviation ?? -1));
            break;
    }
    
    currentResults = sorted;
    renderResultsTable(sorted);
}

// 导出 CSV
function exportToCSV() {
    if (currentResults.length === 0) return;
    
    const headers = ['图片名称', '真实重量(g)', '千问估算(g)', '千问偏差(%)', 'Gemini估算(g)', 'Gemini偏差(%)'];
    const rows = currentResults.map(item => [
        item.imageName,
        item.trueWeight,
        item.qwenResult?.estimatedWeight ?? '',
        item.qwenResult?.deviation ?? '',
        item.geminiResult?.estimatedWeight ?? '',
        item.geminiResult?.deviation ?? ''
    ]);
    
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `food_analysis_results_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
}

// 显示加载遮罩
function showLoading() {
    elements.loadingOverlay.classList.add('active');
}

// 隐藏加载遮罩
function hideLoading() {
    elements.loadingOverlay.classList.remove('active');
}


// ========== 提示词管理功能 ==========

// 初始化提示词管理
function initPromptsManagement() {
    // 模型选择标签点击事件
    document.querySelectorAll('.model-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const modelType = tab.dataset.model;
            if (modelType !== currentModelType) {
                // 检查是否有未保存的修改
                if (hasUnsavedChanges()) {
                    const confirmed = confirm('当前有未保存的修改，切换模型将丢失修改。是否继续？');
                    if (!confirmed) return;
                }
                
                currentModelType = modelType;
                document.querySelectorAll('.model-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                loadPrompts();
            }
        });
    });
}

// 检查是否有未保存的修改
function hasUnsavedChanges() {
    if (!activePrompt || !originalActivePrompt) return false;
    
    const currentName = document.getElementById('active-prompt-name')?.value || '';
    const currentContent = document.getElementById('active-prompt-content')?.value || '';
    
    return currentName !== originalActivePrompt.prompt_name || 
           currentContent !== originalActivePrompt.prompt_content;
}

// 加载提示词列表
async function loadPrompts() {
    try {
        const response = await authFetch(`/api/prompts?model_type=${currentModelType}`);
        const result = await response.json();
        
        if (result.success) {
            promptsList = result.data;
            renderPromptsList();
            
            // 加载激活的提示词到编辑区
            const active = promptsList.find(p => p.is_active);
            if (active) {
                loadActivePrompt(active);
            } else {
                clearActivePromptEditor();
            }
        }
    } catch (error) {
        console.error('加载提示词失败:', error);
        alert('加载提示词失败: ' + error.message);
    }
}

// 渲染提示词列表
function renderPromptsList() {
    const container = document.getElementById('prompts-list');
    
    if (promptsList.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">📝</div>
                <p>暂无提示词，点击上方按钮创建</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = promptsList.map(prompt => `
        <div class="prompt-card ${prompt.is_active ? 'active' : ''}" data-id="${prompt.id}">
            <div class="prompt-card-info">
                <div class="prompt-card-name">${escapeHtml(prompt.prompt_name)}</div>
                <div class="prompt-card-desc">${escapeHtml(prompt.description || '无描述')}</div>
                <div class="prompt-card-meta">
                    更新于: ${formatDate(prompt.updated_at || prompt.created_at)}
                </div>
            </div>
            <div class="prompt-card-actions">
                <span class="prompt-status ${prompt.is_active ? 'active' : 'inactive'}">
                    ${prompt.is_active ? '激活中' : '未激活'}
                </span>
                ${!prompt.is_active ? `
                    <button class="prompt-action-btn activate" onclick="activatePrompt(${prompt.id})">
                        激活
                    </button>
                    <button class="prompt-action-btn delete" onclick="deletePrompt(${prompt.id})">
                        删除
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

// 加载激活提示词到编辑区
function loadActivePrompt(prompt) {
    activePrompt = prompt;
    originalActivePrompt = { ...prompt };
    
    document.getElementById('active-prompt-name').value = prompt.prompt_name;
    document.getElementById('active-prompt-content').value = prompt.prompt_content;
}

// 清空激活提示词编辑区
function clearActivePromptEditor() {
    activePrompt = null;
    originalActivePrompt = null;
    
    document.getElementById('active-prompt-name').value = '';
    document.getElementById('active-prompt-content').value = '';
}

// 保存激活提示词修改
async function saveActivePrompt() {
    if (!activePrompt) {
        alert('没有激活的提示词');
        return;
    }
    
    const name = document.getElementById('active-prompt-name').value.trim();
    const content = document.getElementById('active-prompt-content').value.trim();
    
    if (!name || !content) {
        alert('名称和内容不能为空');
        return;
    }
    
    try {
        showLoading();
        
        const response = await authFetch(`/api/prompts/${activePrompt.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt_name: name,
                prompt_content: content
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('保存成功！');
            originalActivePrompt = { ...activePrompt, prompt_name: name, prompt_content: content };
            loadPrompts(); // 刷新列表
        } else {
            throw new Error(result.detail || '保存失败');
        }
    } catch (error) {
        console.error('保存失败:', error);
        alert('保存失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 重置激活提示词
function resetActivePrompt() {
    if (!originalActivePrompt) return;
    
    if (hasUnsavedChanges()) {
        const confirmed = confirm('确定要放弃当前修改吗？');
        if (!confirmed) return;
    }
    
    document.getElementById('active-prompt-name').value = originalActivePrompt.prompt_name;
    document.getElementById('active-prompt-content').value = originalActivePrompt.prompt_content;
}

// 显示新建提示词弹窗
function showAddPromptModal() {
    document.getElementById('prompt-modal-title').textContent = '新建提示词';
    document.getElementById('new-prompt-name').value = '';
    document.getElementById('new-prompt-description').value = '';
    document.getElementById('new-prompt-content').value = '';
    document.getElementById('new-prompt-active').checked = false;
    
    document.getElementById('prompt-modal').classList.add('active');
}

// 关闭提示词弹窗
function closePromptModal() {
    document.getElementById('prompt-modal').classList.remove('active');
}

// 创建新提示词
async function createNewPrompt() {
    const name = document.getElementById('new-prompt-name').value.trim();
    const description = document.getElementById('new-prompt-description').value.trim();
    const content = document.getElementById('new-prompt-content').value.trim();
    const isActive = document.getElementById('new-prompt-active').checked;
    
    if (!name || !content) {
        alert('名称和内容不能为空');
        return;
    }
    
    try {
        showLoading();
        
        const response = await authFetch('/api/prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model_type: currentModelType,
                prompt_name: name,
                prompt_content: content,
                description: description,
                is_active: isActive
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('创建成功！');
            closePromptModal();
            loadPrompts();
        } else {
            throw new Error(result.detail || '创建失败');
        }
    } catch (error) {
        console.error('创建失败:', error);
        alert('创建失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 激活提示词
async function activatePrompt(promptId) {
    try {
        showLoading();
        
        const response = await authFetch(`/api/prompts/${promptId}/activate`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            loadPrompts();
        } else {
            throw new Error(result.detail || '激活失败');
        }
    } catch (error) {
        console.error('激活失败:', error);
        alert('激活失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除提示词
async function deletePrompt(promptId) {
    const confirmed = confirm('确定要删除这个提示词吗？此操作不可恢复。');
    if (!confirmed) return;
    
    try {
        showLoading();
        
        const response = await authFetch(`/api/prompts/${promptId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            loadPrompts();
        } else {
            throw new Error(result.detail || '删除失败');
        }
    } catch (error) {
        console.error('删除失败:', error);
        alert('删除失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 工具函数：HTML 转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 工具函数：格式化日期
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// 点击提示词弹窗外部关闭
document.getElementById('prompt-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'prompt-modal') {
        closePromptModal();
    }
});


// ========== 登录认证 ==========

// 封装 fetch，自动处理 401 错误
async function authFetch(url, options = {}) {
    const response = await fetch(url, options);
    
    if (response.status === 401) {
        alert('登录已过期，请重新登录');
        window.location.href = '/test-backend/login';
        throw new Error('未登录');
    }
    
    return response;
}

// 登出
async function logout() {
    try {
        await fetch('/api/test-backend/logout', { method: 'POST' });
    } catch (e) {
        // 忽略错误
    }
    window.location.href = '/test-backend/login';
}
