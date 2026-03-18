/**
 * 食物分析测试后台前端脚本
 */

let selectedFiles = [];

// 提示词管理状态
let currentModelType = 'qwen';
let promptsList = [];
let activePrompt = null;
let originalActivePrompt = null;

const elements = {
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabPanels: document.querySelectorAll('.tab-panel'),

    analyzeUploadArea: document.getElementById('analyze-upload-area'),
    chooseFilesBtn: document.getElementById('choose-files-btn'),
    analyzeFileInput: document.getElementById('analyze-file-input'),
    previewGrid: document.getElementById('preview-grid'),
    notesInput: document.getElementById('notes-input'),
    referenceWeightInput: document.getElementById('reference-weight-input'),
    isMultiView: document.getElementById('is-multi-view'),
    analyzeBtn: document.getElementById('analyze-btn'),

    analysisResult: document.getElementById('analysis-result'),
    summaryGrid: document.getElementById('summary-grid'),
    resultBadges: document.getElementById('result-badges'),
    resultDescription: document.getElementById('result-description'),
    resultNotes: document.getElementById('result-notes'),
    resultInsight: document.getElementById('result-insight'),
    resultPfc: document.getElementById('result-pfc'),
    resultAbsorption: document.getElementById('result-absorption'),
    resultContext: document.getElementById('result-context'),
    foodItemsBody: document.getElementById('food-items-body'),

    loadingOverlay: document.getElementById('loading-overlay')
};

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initAnalyzePanel();
    initPromptsManagement();
});

function chooseAnalyzeFiles() {
    elements.analyzeFileInput?.click();
}
window.chooseAnalyzeFiles = chooseAnalyzeFiles;

function initTabs() {
    elements.tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            elements.tabBtns.forEach((item) => item.classList.remove('active'));
            elements.tabPanels.forEach((panel) => panel.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(`${tabId}-panel`).classList.add('active');

            if (tabId === 'prompts') {
                loadPrompts();
            }
        });
    });
}

function initAnalyzePanel() {
    const area = elements.analyzeUploadArea;
    const input = elements.analyzeFileInput;

    area.addEventListener('click', (e) => {
        if (e.target.closest('.upload-trigger')) return;
        chooseAnalyzeFiles();
    });
    elements.chooseFilesBtn?.addEventListener('click', chooseAnalyzeFiles);

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
        if (e.dataTransfer.files?.length) {
            addFiles(Array.from(e.dataTransfer.files));
        }
    });

    input.addEventListener('change', () => {
        if (input.files?.length) {
            addFiles(Array.from(input.files));
        }
        input.value = '';
    });

    elements.analyzeBtn.addEventListener('click', startAnalyze);
    updateAnalyzeBtn();
}

function addFiles(files) {
    const imageFiles = files.filter((file) => !file.type || file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
        alert('请上传图片文件');
        return;
    }

    const nextFiles = [...selectedFiles];
    for (const file of imageFiles) {
        if (nextFiles.length >= 3) break;
        nextFiles.push(file);
    }

    if (files.length > 0 && nextFiles.length === selectedFiles.length) {
        alert('最多上传 3 张图片');
        return;
    }

    selectedFiles = nextFiles;
    renderPreviewGrid();
    updateAnalyzeBtn();
    console.log('[test-backend] selected files:', selectedFiles.map((file) => file.name));
}

function removeSelectedFile(index) {
    selectedFiles = selectedFiles.filter((_, fileIndex) => fileIndex !== index);
    renderPreviewGrid();
    updateAnalyzeBtn();
}
window.removeSelectedFile = removeSelectedFile;

function clearSelectedFiles() {
    selectedFiles = [];
    renderPreviewGrid();
    updateAnalyzeBtn();
}
window.clearSelectedFiles = clearSelectedFiles;

function renderPreviewGrid() {
    if (selectedFiles.length === 0) {
        elements.previewGrid.innerHTML = '';
        return;
    }

    elements.previewGrid.innerHTML = selectedFiles.map((file, index) => {
        const objectUrl = URL.createObjectURL(file);
        return `
            <div class="preview-card">
                <img src="${objectUrl}" alt="${escapeHtml(file.name)}">
                <button class="clear-btn preview-remove-btn" onclick="removeSelectedFile(${index})">✕</button>
                <div class="preview-name">${escapeHtml(file.name)}</div>
            </div>
        `;
    }).join('') + `
        <button class="text-btn clear-all-btn" onclick="clearSelectedFiles()">清空图片</button>
    `;
}

function updateAnalyzeBtn() {
    elements.analyzeBtn.disabled = selectedFiles.length === 0;
    elements.analyzeBtn.textContent = selectedFiles.length === 0
        ? '请先上传图片'
        : `分析 ${selectedFiles.length} 张图片`;
}

async function startAnalyze() {
    if (selectedFiles.length === 0) return;

    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append('images', file));
    formData.append('notes', elements.notesInput.value.trim());
    const referenceWeight = elements.referenceWeightInput.value.trim();
    if (referenceWeight) {
        formData.append('reference_weight', referenceWeight);
    }
    formData.append('is_multi_view', String(elements.isMultiView.checked));

    try {
        showLoading();
        const response = await authFetch('/api/test-backend/analyze', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail || '分析失败');
        }
        if (!result.success) {
            throw new Error(result.message || '分析失败');
        }

        renderAnalyzeResult(result.data, result.meta);
    } catch (error) {
        alert('分析失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

function renderAnalyzeResult(result, meta) {
    const items = result.items || [];
    const totals = items.reduce((acc, item) => {
        const nutrients = item.nutrients || {};
        acc.totalWeight += Number(item.estimatedWeightGrams || 0);
        acc.totalCalories += Number(nutrients.calories || 0);
        return acc;
    }, { totalWeight: 0, totalCalories: 0 });

    elements.summaryGrid.innerHTML = `
        <div class="stat-card">
            <div class="label">图片数量</div>
            <div class="value">${meta?.image_count ?? selectedFiles.length}</div>
        </div>
        <div class="stat-card">
            <div class="label">识别食物数</div>
            <div class="value good">${items.length}</div>
        </div>
        <div class="stat-card">
            <div class="label">估算总重量</div>
            <div class="value">${formatNumber(meta?.estimated_weight ?? totals.totalWeight)}g</div>
        </div>
        <div class="stat-card">
            <div class="label">估算总热量</div>
            <div class="value">${totals.totalCalories.toFixed(1)} kcal</div>
        </div>
        <div class="stat-card">
            <div class="label">参考克数</div>
            <div class="value">${meta?.reference_weight != null ? formatNumber(meta.reference_weight) + 'g' : '-'}</div>
        </div>
        <div class="stat-card">
            <div class="label">偏差</div>
            <div class="value ${meta?.deviation == null ? '' : (meta.deviation >= 30 ? 'bad' : meta.deviation >= 10 ? 'medium' : 'good')}">${meta?.deviation != null ? meta.deviation + '%' : '-'}</div>
        </div>
    `;

    elements.resultBadges.innerHTML = `
        <span class="result-badge">${escapeHtml(meta?.provider || 'unknown')}</span>
        <span class="result-badge">${escapeHtml(meta?.model || '-')}</span>
        ${meta?.is_multi_view ? '<span class="result-badge success">多视角</span>' : ''}
    `;

    elements.resultDescription.textContent = result.description || '-';
    elements.resultNotes.textContent = meta?.notes || '-';
    elements.resultInsight.textContent = result.insight || '-';
    elements.resultPfc.textContent = result.pfc_ratio_comment || '-';
    elements.resultAbsorption.textContent = result.absorption_notes || '-';
    elements.resultContext.textContent = result.context_advice || '-';

    elements.foodItemsBody.innerHTML = items.map((item) => {
        const nutrients = item.nutrients || {};
        return `
            <tr>
                <td>${escapeHtml(item.name || '-')}</td>
                <td>${formatNumber(item.estimatedWeightGrams)}</td>
                <td>${formatNumber(nutrients.calories)}</td>
                <td>${formatNumber(nutrients.protein)}</td>
                <td>${formatNumber(nutrients.carbs)}</td>
                <td>${formatNumber(nutrients.fat)}</td>
                <td>${formatNumber(nutrients.fiber)}</td>
                <td>${formatNumber(nutrients.sugar)}</td>
            </tr>
        `;
    }).join('') || `
        <tr>
            <td colspan="8" class="empty-row">未识别到食物明细</td>
        </tr>
    `;

    elements.analysisResult.style.display = 'block';
    elements.analysisResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatNumber(value) {
    return Number(value || 0).toFixed(1);
}

window.showAddPromptModal = showAddPromptModal;
window.closePromptModal = closePromptModal;
window.createNewPrompt = createNewPrompt;
window.activatePrompt = activatePrompt;
window.deletePrompt = deletePrompt;
window.saveActivePrompt = saveActivePrompt;
window.resetActivePrompt = resetActivePrompt;
window.logout = logout;

function showLoading() {
    elements.loadingOverlay.classList.add('active');
}

function hideLoading() {
    elements.loadingOverlay.classList.remove('active');
}

// ========== 提示词管理 ==========

function initPromptsManagement() {
    document.querySelectorAll('.model-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            const modelType = tab.dataset.model;
            if (modelType !== currentModelType) {
                if (hasUnsavedChanges()) {
                    const confirmed = confirm('当前有未保存的修改，切换模型将丢失修改。是否继续？');
                    if (!confirmed) return;
                }

                currentModelType = modelType;
                document.querySelectorAll('.model-tab').forEach((item) => item.classList.remove('active'));
                tab.classList.add('active');
                loadPrompts();
            }
        });
    });
}

function hasUnsavedChanges() {
    if (!activePrompt || !originalActivePrompt) return false;

    const currentName = document.getElementById('active-prompt-name')?.value || '';
    const currentContent = document.getElementById('active-prompt-content')?.value || '';

    return currentName !== originalActivePrompt.prompt_name ||
        currentContent !== originalActivePrompt.prompt_content;
}

async function loadPrompts() {
    try {
        const response = await authFetch(`/api/prompts?model_type=${currentModelType}`);
        const result = await response.json();

        if (result.success) {
            promptsList = result.data;
            renderPromptsList();

            const active = promptsList.find((prompt) => prompt.is_active);
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

    container.innerHTML = promptsList.map((prompt) => `
        <div class="prompt-card ${prompt.is_active ? 'active' : ''}" data-id="${prompt.id}">
            <div class="prompt-card-info">
                <div class="prompt-card-name">${escapeHtml(prompt.prompt_name)}</div>
                <div class="prompt-card-desc">${escapeHtml(prompt.description || '无描述')}</div>
                <div class="prompt-card-meta">更新于: ${formatDate(prompt.updated_at || prompt.created_at)}</div>
            </div>
            <div class="prompt-card-actions">
                <span class="prompt-status ${prompt.is_active ? 'active' : 'inactive'}">
                    ${prompt.is_active ? '激活中' : '未激活'}
                </span>
                ${!prompt.is_active ? `
                    <button class="prompt-action-btn activate" onclick="activatePrompt(${prompt.id})">激活</button>
                    <button class="prompt-action-btn delete" onclick="deletePrompt(${prompt.id})">删除</button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

function loadActivePrompt(prompt) {
    activePrompt = prompt;
    originalActivePrompt = { ...prompt };

    document.getElementById('active-prompt-name').value = prompt.prompt_name;
    document.getElementById('active-prompt-content').value = prompt.prompt_content;
}

function clearActivePromptEditor() {
    activePrompt = null;
    originalActivePrompt = null;

    document.getElementById('active-prompt-name').value = '';
    document.getElementById('active-prompt-content').value = '';
}

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
            alert('保存成功');
            originalActivePrompt = { ...activePrompt, prompt_name: name, prompt_content: content };
            loadPrompts();
        } else {
            throw new Error(result.detail || '保存失败');
        }
    } catch (error) {
        alert('保存失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

function resetActivePrompt() {
    if (!originalActivePrompt) return;

    if (hasUnsavedChanges()) {
        const confirmed = confirm('确定要放弃当前修改吗？');
        if (!confirmed) return;
    }

    document.getElementById('active-prompt-name').value = originalActivePrompt.prompt_name;
    document.getElementById('active-prompt-content').value = originalActivePrompt.prompt_content;
}

function showAddPromptModal() {
    document.getElementById('prompt-modal-title').textContent = '新建提示词';
    document.getElementById('new-prompt-name').value = '';
    document.getElementById('new-prompt-description').value = '';
    document.getElementById('new-prompt-content').value = '';
    document.getElementById('new-prompt-active').checked = false;
    document.getElementById('prompt-modal').classList.add('active');
}

function closePromptModal() {
    document.getElementById('prompt-modal').classList.remove('active');
}

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
                description,
                is_active: isActive
            })
        });

        const result = await response.json();
        if (result.success) {
            alert('创建成功');
            closePromptModal();
            loadPrompts();
        } else {
            throw new Error(result.detail || '创建失败');
        }
    } catch (error) {
        alert('创建失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

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
        alert('激活失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

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
        alert('删除失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

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

document.getElementById('prompt-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'prompt-modal') {
        closePromptModal();
    }
});

async function authFetch(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 401) {
        alert('登录已过期，请重新登录');
        window.location.href = '/test-backend/login';
        throw new Error('未登录');
    }
    return response;
}

async function logout() {
    try {
        await fetch('/api/test-backend/logout', { method: 'POST' });
    } catch (e) {
        console.warn('logout failed', e);
    }
    window.location.href = '/test-backend/login';
}
