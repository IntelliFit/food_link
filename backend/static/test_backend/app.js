/**
 * 食物分析测试后台前端脚本
 */

let selectedFiles = [];
let batchFile = null;
let currentBatchId = null;
let currentBatchStatus = null;
let batchPollTimer = null;
let currentBatchItems = [];
let testDatasets = [];
let geminiPromptOptions = [];

// 提示词管理状态
const currentModelType = 'gemini';
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
    expectedItemsInput: document.getElementById('expected-items-input'),
    modelGeminiFlash: document.getElementById('model-gemini-flash'),
    modelGeminiFlashLite: document.getElementById('model-gemini-flash-lite'),
    executionModeSelect: document.getElementById('execution-mode-select'),
    analyzePromptSelect: document.getElementById('analyze-prompt-select'),
    analyzePromptHint: document.getElementById('analyze-prompt-hint'),
    isMultiView: document.getElementById('is-multi-view'),
    analyzeBtn: document.getElementById('analyze-btn'),

    analysisResult: document.getElementById('analysis-result'),
    summaryGrid: document.getElementById('summary-grid'),
    analyzeModelResults: document.getElementById('analyze-model-results'),

    loadingOverlay: document.getElementById('loading-overlay')
};

Object.assign(elements, {
    batchUploadArea: document.getElementById('batch-upload-area'),
    batchFileInput: document.getElementById('batch-file-input'),
    chooseBatchBtn: document.getElementById('choose-batch-btn'),
    batchFileCard: document.getElementById('batch-file-card'),
    batchFileName: document.getElementById('batch-file-name'),
    batchFileMeta: document.getElementById('batch-file-meta'),
    clearBatchBtn: document.getElementById('clear-batch-btn'),
    batchNotesInput: document.getElementById('batch-notes-input'),
    batchIsMultiView: document.getElementById('batch-is-multi-view'),
    batchModelGeminiFlash: document.getElementById('batch-model-gemini-flash'),
    batchModelGeminiFlashLite: document.getElementById('batch-model-gemini-flash-lite'),
    batchExecutionModeSelect: document.getElementById('batch-execution-mode-select'),
    batchPromptSelect: document.getElementById('batch-prompt-select'),
    batchPromptHint: document.getElementById('batch-prompt-hint'),
    prepareBatchBtn: document.getElementById('prepare-batch-btn'),
    startBatchBtn: document.getElementById('start-batch-btn'),
    batchSummaryCard: document.getElementById('batch-summary-card'),
    batchSummaryGrid: document.getElementById('batch-summary-grid'),
    batchProgressFill: document.getElementById('batch-progress-fill'),
    batchProgressText: document.getElementById('batch-progress-text'),
    batchListCard: document.getElementById('batch-list-card'),
    batchResultBadges: document.getElementById('batch-result-badges'),
    batchItemsBody: document.getElementById('batch-items-body'),
    batchDetailModal: document.getElementById('batch-detail-modal'),
    batchDetailTitle: document.getElementById('batch-detail-title'),
    batchDetailBody: document.getElementById('batch-detail-body'),
    batchDetailClose: document.getElementById('batch-detail-close'),
    datasetsBody: document.getElementById('datasets-body'),
    reloadDatasetsBtn: document.getElementById('reload-datasets-btn'),
    datasetNameInput: document.getElementById('dataset-name-input'),
    datasetSourceDirInput: document.getElementById('dataset-source-dir-input'),
    datasetDescriptionInput: document.getElementById('dataset-description-input'),
    importDatasetBtn: document.getElementById('import-dataset-btn'),
});

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initAnalyzePanel();
    initBatchPanel();
    loadGeminiPromptOptions();
});

function chooseAnalyzeFiles() {
    elements.analyzeFileInput?.click();
}
window.chooseAnalyzeFiles = chooseAnalyzeFiles;

function chooseBatchFile() {
    elements.batchFileInput?.click();
}
window.chooseBatchFile = chooseBatchFile;

function initTabs() {
    elements.tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            elements.tabBtns.forEach((item) => item.classList.remove('active'));
            elements.tabPanels.forEach((panel) => panel.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(`${tabId}-panel`).classList.add('active');

            if (tabId === 'batch') {
                loadTestDatasets();
            }
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

    elements.analyzePromptSelect?.addEventListener('change', () => {
        updatePromptSelectionHint(elements.analyzePromptSelect, elements.analyzePromptHint);
    });
    elements.executionModeSelect?.addEventListener('change', () => {
        syncPromptSelectState('analyze');
    });
    elements.analyzeBtn.addEventListener('click', startAnalyze);
    updateAnalyzeBtn();
}

function initBatchPanel() {
    const area = elements.batchUploadArea;
    const input = elements.batchFileInput;

    area?.addEventListener('click', (e) => {
        if (e.target.closest('.upload-trigger')) return;
        chooseBatchFile();
    });
    elements.chooseBatchBtn?.addEventListener('click', chooseBatchFile);

    area?.addEventListener('dragover', (e) => {
        e.preventDefault();
        area.classList.add('dragover');
    });

    area?.addEventListener('dragleave', () => {
        area.classList.remove('dragover');
    });

    area?.addEventListener('drop', (e) => {
        e.preventDefault();
        area.classList.remove('dragover');
        const file = e.dataTransfer.files?.[0];
        if (file) {
            setBatchFile(file);
        }
    });

    input?.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) {
            setBatchFile(file);
        }
        input.value = '';
    });

    elements.clearBatchBtn?.addEventListener('click', resetBatchState);
    elements.prepareBatchBtn?.addEventListener('click', prepareBatchZip);
    elements.startBatchBtn?.addEventListener('click', startBatchProcessing);
    elements.batchPromptSelect?.addEventListener('change', () => {
        updatePromptSelectionHint(elements.batchPromptSelect, elements.batchPromptHint);
    });
    elements.batchExecutionModeSelect?.addEventListener('change', () => {
        syncPromptSelectState('batch');
    });
    elements.batchDetailClose?.addEventListener('click', closeBatchDetail);
    elements.reloadDatasetsBtn?.addEventListener('click', loadTestDatasets);
    elements.importDatasetBtn?.addEventListener('click', importLocalDataset);
    elements.batchDetailModal?.addEventListener('click', (e) => {
        if (e.target === elements.batchDetailModal) {
            closeBatchDetail();
        }
    });
    loadTestDatasets();
}

function setBatchFile(file) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
        alert('请上传 ZIP 文件');
        return;
    }
    batchFile = file;
    currentBatchId = null;
    currentBatchStatus = null;
    stopBatchPolling();
    elements.batchFileCard.style.display = 'flex';
    elements.batchFileName.textContent = file.name;
    elements.batchFileMeta.textContent = `${formatFileSize(file.size)} · 等待解析`;
    elements.batchSummaryCard.style.display = 'none';
    elements.batchListCard.style.display = 'none';
    elements.startBatchBtn.disabled = true;
}

function resetBatchState() {
    batchFile = null;
    currentBatchId = null;
    currentBatchStatus = null;
    stopBatchPolling();
    elements.batchFileInput.value = '';
    elements.batchFileCard.style.display = 'none';
    elements.batchSummaryCard.style.display = 'none';
    elements.batchListCard.style.display = 'none';
    elements.startBatchBtn.disabled = true;
    elements.batchItemsBody.innerHTML = '';
    currentBatchItems = [];
}

async function loadTestDatasets() {
    if (!elements.datasetsBody) return;
    elements.datasetsBody.innerHTML = '<tr><td colspan="5" class="empty-row">正在加载测试集...</td></tr>';
    try {
        const response = await authFetch('/api/test-backend/datasets');
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail || '获取测试集失败');
        }
        testDatasets = Array.isArray(result.data) ? result.data : [];
        renderDatasetsTable();
    } catch (error) {
        elements.datasetsBody.innerHTML = `<tr><td colspan="5" class="empty-row">${escapeHtml(error.message || '获取测试集失败')}</td></tr>`;
    }
}

function renderDatasetsTable() {
    if (!elements.datasetsBody) return;
    if (!testDatasets.length) {
        elements.datasetsBody.innerHTML = '<tr><td colspan="5" class="empty-row">还没有可复用测试集</td></tr>';
        return;
    }
    elements.datasetsBody.innerHTML = testDatasets.map((dataset) => `
        <tr>
            <td>
                <div><strong>${escapeHtml(dataset.name || '-')}</strong></div>
                <div class="field-hint">${escapeHtml(dataset.description || '')}</div>
            </td>
            <td>${dataset.itemCount || dataset.labeledCount || 0}</td>
            <td>${escapeHtml(dataset.sourceRef || '-')}</td>
            <td>${formatDateTime(dataset.createdAt)}</td>
            <td><button type="button" class="detail-btn" onclick="prepareSavedDatasetBatch('${escapeHtml(String(dataset.id || ''))}')">载入批次</button></td>
        </tr>
    `).join('');
}

async function importLocalDataset() {
    const name = elements.datasetNameInput?.value?.trim() || '';
    const sourceDir = elements.datasetSourceDirInput?.value?.trim() || '';
    const description = elements.datasetDescriptionInput?.value?.trim() || '';
    if (!name || !sourceDir) {
        alert('请填写测试集名称和本机目录');
        return;
    }
    try {
        showLoading();
        const response = await authFetch('/api/test-backend/datasets/import-local', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                source_dir: sourceDir,
                description,
            }),
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail || '导入测试集失败');
        }
        await loadTestDatasets();
        if (result.dataset?.id) {
            await prepareSavedDatasetBatch(result.dataset.id);
        }
    } catch (error) {
        alert('导入测试集失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function prepareSavedDatasetBatch(datasetId) {
    if (!datasetId) return;
    try {
        showLoading();
        const response = await authFetch(`/api/test-backend/datasets/${datasetId}/prepare`, {
            method: 'POST',
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail || '载入测试集失败');
        }
        currentBatchId = result.batch_id;
        currentBatchStatus = result.status;
        batchFile = null;
        elements.batchFileCard.style.display = 'flex';
        elements.batchFileName.textContent = result.datasetName || '已载入测试集';
        elements.batchFileMeta.textContent = `来自可复用测试集 · ${result.summary?.total || 0} 项待处理`;
        renderBatchStatus(result);
        elements.startBatchBtn.disabled = false;
    } catch (error) {
        alert('载入测试集失败: ' + error.message);
    } finally {
        hideLoading();
    }
}
window.prepareSavedDatasetBatch = prepareSavedDatasetBatch;

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

function getSelectedAnalyzeModels() {
    const models = [];
    if (elements.modelGeminiFlash?.checked) models.push('gemini-3-flash-preview');
    if (elements.modelGeminiFlashLite?.checked) models.push('gemini-3.1-flash-lite-preview');
    return models.length ? models : ['gemini-3-flash-preview'];
}

function getSelectedBatchModels() {
    const models = [];
    if (elements.batchModelGeminiFlash?.checked) models.push('gemini-3-flash-preview');
    if (elements.batchModelGeminiFlashLite?.checked) models.push('gemini-3.1-flash-lite-preview');
    return models.length ? models : ['gemini-3-flash-preview'];
}

async function loadGeminiPromptOptions(preferredPromptId = null) {
    const currentAnalyzeValue = getSelectedPromptIds(elements.analyzePromptSelect);
    const currentBatchValue = getSelectedPromptIds(elements.batchPromptSelect);
    try {
        const response = await authFetch('/api/prompts?model_type=gemini');
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.detail || '加载 Gemini 提示词失败');
        }
        geminiPromptOptions = Array.isArray(result.data) ? result.data : [];
        renderGeminiPromptSelectors({
            analyzeSelected: preferredPromptId != null ? [String(preferredPromptId)] : currentAnalyzeValue,
            batchSelected: preferredPromptId != null ? [String(preferredPromptId)] : currentBatchValue,
        });
    } catch (error) {
        console.error('加载 Gemini 提示词选项失败:', error);
        geminiPromptOptions = [];
        renderGeminiPromptSelectors();
    }
}

function renderGeminiPromptSelectors({
    analyzeSelected = '',
    batchSelected = '',
} = {}) {
    const activePrompt = geminiPromptOptions.find((prompt) => prompt.is_active) || null;
    const optionHtml = geminiPromptOptions.length
        ? geminiPromptOptions.map((prompt) => {
            const promptId = String(prompt.id);
            const activeTag = prompt.is_active ? '（当前激活）' : '';
            return `<option value="${escapeHtml(promptId)}">${escapeHtml(prompt.prompt_name || `提示词 #${promptId}`)}${activeTag}</option>`;
        }).join('')
        : '<option value="">当前无 Gemini 自定义提示词，将回退默认 prompt</option>';

    [elements.analyzePromptSelect, elements.batchPromptSelect].forEach((select) => {
        if (!select) return;
        select.innerHTML = optionHtml;
    });

    const resolvedAnalyze = resolvePromptSelectValues(analyzeSelected, activePrompt);
    const resolvedBatch = resolvePromptSelectValues(batchSelected, activePrompt);
    setPromptSelectValues(elements.analyzePromptSelect, resolvedAnalyze);
    setPromptSelectValues(elements.batchPromptSelect, resolvedBatch);
    updatePromptSelectionHint(elements.analyzePromptSelect, elements.analyzePromptHint);
    updatePromptSelectionHint(elements.batchPromptSelect, elements.batchPromptHint);
    syncPromptSelectState('analyze');
    syncPromptSelectState('batch');
}

function resolvePromptSelectValues(candidateValue, activePrompt) {
    const normalized = normalizePromptIdValues(candidateValue);
    if (normalized.length) {
        return normalized.filter((value) => geminiPromptOptions.some((prompt) => String(prompt.id) === value));
    }
    if (activePrompt?.id != null) {
        return [String(activePrompt.id)];
    }
    return geminiPromptOptions[0]?.id != null ? [String(geminiPromptOptions[0].id)] : [];
}

function updatePromptSelectionHint(selectElement, hintElement) {
    if (!hintElement) return;
    const selectedPrompts = getSelectedPromptRecords(selectElement);
    if (selectedPrompts.length === 1) {
        const activeText = selectedPrompts[0].is_active ? '，也是当前激活提示词' : '，仅本次测试使用';
        hintElement.textContent = `当前选择：${selectedPrompts[0].prompt_name}${activeText}。`;
        return;
    }
    if (selectedPrompts.length > 1) {
        const activeCount = selectedPrompts.filter((prompt) => prompt.is_active).length;
        const names = selectedPrompts.map((prompt) => prompt.prompt_name).join(' / ');
        hintElement.textContent = `当前选择了 ${selectedPrompts.length} 个提示词${activeCount ? '（包含当前激活提示词）' : ''}：${names}。会按“模型 × 提示词”全部并跑。`;
        return;
    }
    hintElement.textContent = '当前无可选 Gemini 自定义提示词，将回退 worker 默认 prompt。';
}

function syncPromptSelectState(scope) {
    const isAnalyze = scope === 'analyze';
    const modeSelect = isAnalyze ? elements.executionModeSelect : elements.batchExecutionModeSelect;
    const promptSelect = isAnalyze ? elements.analyzePromptSelect : elements.batchPromptSelect;
    const hintElement = isAnalyze ? elements.analyzePromptHint : elements.batchPromptHint;
    const mode = String(modeSelect?.value || 'standard').trim().toLowerCase();
    const customEnabled = mode === 'custom';
    if (promptSelect) {
        promptSelect.disabled = !customEnabled;
    }
    if (!hintElement) return;
    if (!customEnabled) {
        hintElement.textContent = `当前为 ${mode} 模式，使用原有主链路 prompt；下方自定义提示词不会生效。`;
        return;
    }
    updatePromptSelectionHint(promptSelect, hintElement);
}

function getSelectedPromptRecord(selectElement) {
    return getSelectedPromptRecords(selectElement)[0] || null;
}

function normalizePromptIdValues(values) {
    const rawValues = Array.isArray(values)
        ? values
        : String(values || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    const normalized = [];
    rawValues.forEach((value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            const normalizedValue = String(parsed);
            if (!normalized.includes(normalizedValue)) {
                normalized.push(normalizedValue);
            }
        }
    });
    return normalized;
}

function getSelectedPromptIds(selectElement) {
    const values = Array.from(selectElement?.selectedOptions || [])
        .map((option) => String(option?.value || '').trim())
        .filter(Boolean);
    return normalizePromptIdValues(values).map((value) => Number(value));
}

function getSelectedPromptRecords(selectElement) {
    const selectedIds = new Set(normalizePromptIdValues(getSelectedPromptIds(selectElement)));
    if (!selectedIds.size) return [];
    return geminiPromptOptions.filter((prompt) => selectedIds.has(String(prompt.id)));
}

function getPromptVariantLabel(meta = {}) {
    if (String(meta?.execution_mode || '').trim().toLowerCase() !== 'custom') {
        return '';
    }
    if (meta?.prompt_name) {
        return String(meta.prompt_name).trim();
    }
    const promptSource = String(meta?.prompt_source || '').trim();
    if (promptSource.includes('custom-fallback')) {
        return 'worker 默认 prompt';
    }
    if (promptSource.includes('model_prompts.active')) {
        return '当前激活提示词';
    }
    return 'custom';
}

function getModelRunDisplayLabel(modelResult) {
    const baseLabel = String(modelResult?.model || modelResult?.provider || 'model').trim() || 'model';
    const promptLabel = getPromptVariantLabel(modelResult?.meta || {});
    return promptLabel ? `${baseLabel} · ${promptLabel}` : baseLabel;
}

function setPromptSelectValues(selectElement, values) {
    if (!selectElement) return;
    const selectedValues = normalizePromptIdValues(values);
    Array.from(selectElement.options || []).forEach((option) => {
        option.selected = selectedValues.includes(String(option.value || '').trim());
    });
}

function setPromptSelectValues(selectElement, values) {
    if (!selectElement) return;
    const selectedValues = normalizePromptIdValues(values);
    Array.from(selectElement.options || []).forEach((option) => {
        option.selected = selectedValues.includes(String(option.value || '').trim());
    });
}

async function startAnalyze() {
    if (selectedFiles.length === 0) return;

    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append('images', file));
    formData.append('notes', elements.notesInput.value.trim());
    const referenceWeight = elements.referenceWeightInput?.value?.trim?.() || '';
    if (referenceWeight) {
        formData.append('reference_weight', referenceWeight);
    }
    formData.append('expected_items_json', elements.expectedItemsInput?.value?.trim() || '');
    formData.append('models', getSelectedAnalyzeModels().join(','));
    const selectedMode = elements.executionModeSelect?.value || 'standard';
    formData.append('execution_mode', selectedMode);
    const selectedPromptIds = getSelectedPromptIds(elements.analyzePromptSelect);
    if (selectedMode === 'custom' && selectedPromptIds.length) {
        formData.append('prompt_ids', selectedPromptIds.join(','));
        if (selectedPromptIds.length === 1) {
            formData.append('prompt_id', String(selectedPromptIds[0]));
        }
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

        renderAnalyzeResult(result);
    } catch (error) {
        alert('分析失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function prepareBatchZip() {
    if (!batchFile) {
        alert('请先选择 ZIP 文件');
        return;
    }

    const formData = new FormData();
    formData.append('file', batchFile);

    try {
        showLoading();
        const response = await authFetch('/api/test-backend/batch/prepare', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail || '解析失败');
        }

        currentBatchId = result.batch_id;
        currentBatchStatus = result.status;
        renderBatchStatus(result);
        elements.startBatchBtn.disabled = false;
        elements.batchFileMeta.textContent = `${formatFileSize(batchFile.size)} · 已解析 ${result.summary.total} 项`;
    } catch (error) {
        alert('解析失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function startBatchProcessing() {
    if (!currentBatchId) {
        alert('请先解析 ZIP');
        return;
    }

    const formData = new FormData();
    formData.append('batch_id', currentBatchId);
    formData.append('notes', elements.batchNotesInput.value.trim());
    formData.append('is_multi_view', String(elements.batchIsMultiView.checked));
    formData.append('models', getSelectedBatchModels().join(','));
    const selectedMode = elements.batchExecutionModeSelect?.value || 'standard';
    formData.append('execution_mode', selectedMode);
    const selectedPromptIds = getSelectedPromptIds(elements.batchPromptSelect);
    if (selectedMode === 'custom' && selectedPromptIds.length) {
        formData.append('prompt_ids', selectedPromptIds.join(','));
        if (selectedPromptIds.length === 1) {
            formData.append('prompt_id', String(selectedPromptIds[0]));
        }
    }

    try {
        const response = await authFetch('/api/test-backend/batch/start', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail || '启动失败');
        }
        renderBatchStatus(result);
        elements.startBatchBtn.disabled = true;
        startBatchPolling();
    } catch (error) {
        alert('启动失败: ' + error.message);
    }
}

async function fetchBatchStatus() {
    if (!currentBatchId) return;
    try {
        const response = await authFetch(`/api/test-backend/batch/${currentBatchId}`);
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail || '获取进度失败');
        }
        renderBatchStatus(result);
        if (result.status === 'completed' || result.status === 'failed') {
            stopBatchPolling();
        }
    } catch (error) {
        stopBatchPolling();
        alert('获取批量进度失败: ' + error.message);
    }
}

function startBatchPolling() {
    stopBatchPolling();
    batchPollTimer = window.setInterval(fetchBatchStatus, 1000);
}

function stopBatchPolling() {
    if (batchPollTimer) {
        window.clearInterval(batchPollTimer);
        batchPollTimer = null;
    }
}

function renderBatchStatus(payload) {
    currentBatchStatus = payload.status;
    currentBatchItems = payload.items || [];
    const progress = payload.progress || {};
    const summary = payload.summary || {};
    const skipped = summary.skipped || [];
    const batchMode = String(payload.executionMode || elements.batchExecutionModeSelect?.value || 'standard').trim().toLowerCase();
    const batchPromptNames = Array.isArray(payload.promptNames) ? payload.promptNames.filter(Boolean) : [];
    const batchPromptCount = batchPromptNames.length || (Array.isArray(payload.promptIds) ? payload.promptIds.filter(Boolean).length : 0);
    const modelAggregates = computeBatchModelAggregates(currentBatchItems);
    const modelSummaryCards = modelAggregates.map((aggregate) => {
        if (aggregate.itemsModeCount) {
            return `
                <div class="stat-card">
                    <div class="label">${escapeHtml(aggregate.label)} 平均综合分</div>
                    <div class="value ${aggregate.avgCompositeScore != null && aggregate.avgCompositeScore >= 0.75 ? 'good' : aggregate.avgCompositeScore != null && aggregate.avgCompositeScore >= 0.5 ? 'medium' : 'bad'}">${formatRatioPercent(aggregate.avgCompositeScore)}</div>
                </div>
                <div class="stat-card">
                    <div class="label">${escapeHtml(aggregate.label)} 平均回答时长</div>
                    <div class="value">${formatDurationMs(aggregate.avgResponseDurationMs)}</div>
                </div>
            `;
        }
        return `
            <div class="stat-card">
                <div class="label">${escapeHtml(aggregate.label)} 平均总重误差</div>
                <div class="value ${aggregate.avgTotalDeviation != null && aggregate.avgTotalDeviation < 10 ? 'good' : aggregate.avgTotalDeviation != null && aggregate.avgTotalDeviation < 30 ? 'medium' : 'bad'}">${formatPercent(aggregate.avgTotalDeviation)}</div>
            </div>
            <div class="stat-card">
                <div class="label">${escapeHtml(aggregate.label)} 平均回答时长</div>
                <div class="value">${formatDurationMs(aggregate.avgResponseDurationMs)}</div>
            </div>
        `;
    }).join('');

    elements.batchSummaryCard.style.display = 'block';
    elements.batchListCard.style.display = 'block';
    elements.batchSummaryGrid.innerHTML = `
        <div class="stat-card">
            <div class="label">总数</div>
            <div class="value">${progress.total ?? summary.total ?? 0}</div>
        </div>
        <div class="stat-card">
            <div class="label">已完成</div>
            <div class="value good">${progress.completed ?? 0}</div>
        </div>
        <div class="stat-card">
            <div class="label">失败</div>
            <div class="value bad">${progress.failed ?? 0}</div>
        </div>
        <div class="stat-card">
            <div class="label">跳过</div>
            <div class="value">${skipped.length}</div>
        </div>
        ${modelSummaryCards}
    `;
    elements.batchProgressFill.style.width = `${progress.percent || 0}%`;
    elements.batchProgressText.textContent = progress.current_file
        ? `正在处理：${progress.current_file}`
        : (payload.status === 'completed' ? '批量处理已完成' : payload.status === 'failed' ? '批量处理已结束（含失败项）' : '等待开始');

    elements.batchResultBadges.innerHTML = `
        <span class="result-badge">${payload.status}</span>
        <span class="result-badge">${escapeHtml(batchMode)}</span>
        ${elements.batchIsMultiView.checked ? '<span class="result-badge success">多视角</span>' : ''}
        ${batchMode === 'custom' && batchPromptCount ? `<span class="result-badge">提示词 ${batchPromptCount} 个</span>` : ''}
        ${skipped.length ? `<span class="result-badge">跳过 ${skipped.length} 项</span>` : ''}
    `;

    elements.batchItemsBody.innerHTML = currentBatchItems.map((item, index) => `
        <tr>
            <td>${escapeHtml(item.filename)}</td>
            <td>${renderExpectedItemsInline(item.expectedItems, item.trueWeight, item.labelMode)}</td>
            <td>${renderBatchStatusTag(item.status)}</td>
            <td>${renderModelResultsSummary(item.modelResults)}</td>
            <td>${renderDeviationBadge(item.deviation)}</td>
            <td>${escapeHtml(item.error || buildRecognizedItemsSummary(item.items))}</td>
            <td><button type="button" class="detail-btn" ${item.status === 'pending' ? 'disabled' : ''} onclick="showBatchDetail(${index})">查看详情</button></td>
        </tr>
    `).join('');
}

function renderBatchStatusTag(status) {
    const labelMap = {
        pending: '待处理',
        processing: '处理中',
        done: '已完成',
        failed: '失败',
    };
    return `<span class="batch-status-tag ${status}">${labelMap[status] || status}</span>`;
}

function renderExpectedItemsInline(expectedItems, totalWeight, labelMode) {
    const items = Array.isArray(expectedItems) ? expectedItems : [];
    const mode = labelMode || (items.length === 1 && ['总重量', '总重', 'total', 'totalweight', 'total_weight'].includes(String(items[0]?.name || '').replace(/[\s_-]+/g, '').toLowerCase()) ? 'total' : 'items');
    if (mode === 'total') {
        const weight = items[0]?.trueWeightGrams ?? totalWeight;
        return weight != null ? `<span class="mini-chip total">总重量 ${formatNumber(weight)}g</span>` : '-';
    }
    if (!items.length) {
        return totalWeight != null ? `${formatNumber(totalWeight)}g` : '-';
    }
    return items.map((item) => {
        const name = escapeHtml(item.name || '食物');
        return `<span class="mini-chip">${name} ${formatNumber(item.trueWeightGrams)}g</span>`;
    }).join('');
}

function buildRecognizedItemsSummary(items, maxCount = 4) {
    const safeItems = Array.isArray(items) ? items : [];
    const names = safeItems
        .map((item) => String(item?.name || '').trim())
        .filter(Boolean);
    if (!names.length) return '-';
    const visible = names.slice(0, maxCount);
    return names.length > maxCount ? `${visible.join('、')} 等 ${names.length} 项` : visible.join('、');
}

function formatPercent(value, digits = 1) {
    if (value == null || value === '') return '-';
    const num = Number(value);
    return Number.isFinite(num) ? `${num.toFixed(digits)}%` : '-';
}

function formatRatioPercent(value, digits = 1) {
    if (value == null || value === '') return '-';
    const num = Number(value);
    return Number.isFinite(num) ? `${(num * 100).toFixed(digits)}%` : '-';
}

function formatNullableNumber(value, digits = 1) {
    if (value == null || value === '') return '-';
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(digits) : '-';
}

function formatDurationMs(value) {
    if (value == null || value === '') return '-';
    const num = Number(value);
    if (!Number.isFinite(num)) return '-';
    if (num < 1000) return `${num.toFixed(0)} ms`;
    return `${(num / 1000).toFixed(2)} s`;
}

function renderMatchType(matchType) {
    const labelMap = {
        exact: '精确匹配',
        synonym: '同义匹配',
        contain: '同类包含',
        close_equivalent: '近似等价',
        fuzzy: '模糊匹配',
        too_generic: '名称过泛',
        wrong_food: '识别成其他食物',
        missing: '未匹配',
        none: '未匹配',
    };
    return labelMap[matchType] || matchType || '-';
}

function renderDeviationBadge(value) {
    if (value == null) return '-';
    const cls = value >= 30 ? 'bad' : value >= 10 ? 'medium' : 'good';
    return `<span class="deviation ${cls}">${value}%</span>`;
}

function renderEvaluationItemRows(evaluation) {
    const matches = evaluation.itemMatches || [];
    return matches.map((item) => `
        <tr>
            <td>${escapeHtml(item.expectedName || '-')}</td>
            <td>${formatNumber(item.trueWeightGrams)}</td>
            <td>${escapeHtml(item.predictedName || '未识别')}</td>
            <td>${item.estimatedWeightGrams != null ? formatNumber(item.estimatedWeightGrams) : '-'}</td>
            <td>${item.absoluteErrorGrams != null ? formatNullableNumber(item.absoluteErrorGrams, 1) : '-'}</td>
            <td>${formatRatioPercent(item.clippedRelativeError)}</td>
            <td>${renderMatchType(item.matchType)}</td>
        </tr>
    `).join('') || '<tr><td colspan="7" class="empty-row">没有逐项评测数据</td></tr>';
}

function renderItemsBenchmarkContent(evaluation) {
    const rows = renderEvaluationItemRows(evaluation);
    const extras = (evaluation.extraItems || []).map((item) => `${escapeHtml(item.name)} ${formatNumber(item.estimatedWeightGrams)}g`).join('、') || '无';
    const evaluatorSourceMap = {
        deepseek: 'DeepSeek evaluator',
        fallback_local: '本地规则兜底',
        local_rule: '本地规则',
        local_empty_side: '本地空集判定',
        local_total_only: '总重直算',
    };
    const evaluatorLabel = evaluatorSourceMap[evaluation.evaluatorSource] || evaluation.evaluatorSource || '未知';
    return `
        <div class="detail-item"><span class="label">匹配评估器</span><span class="value">${escapeHtml(evaluatorLabel)}</span></div>
        <div class="detail-item"><span class="label">综合分</span><span class="value">${formatPercent(evaluation.finalCompositeScorePercent)}</span></div>
        <div class="detail-item"><span class="label">Food Precision</span><span class="value">${formatRatioPercent(evaluation.foodPrecision)}</span></div>
        <div class="detail-item"><span class="label">Food Recall</span><span class="value">${formatRatioPercent(evaluation.foodRecall)}</span></div>
        <div class="detail-item"><span class="label">Food F1</span><span class="value">${formatRatioPercent(evaluation.foodF1)}</span></div>
        <div class="detail-item"><span class="label">加权召回</span><span class="value">${formatRatioPercent(evaluation.weightedFoodRecall)}</span></div>
        <div class="detail-item"><span class="label">识别命中</span><span class="value">${evaluation.matchedCount ?? 0} / ${(evaluation.itemMatches || []).length}</span></div>
        <div class="detail-item"><span class="label">缺失项</span><span class="value">${evaluation.falseNegativeCount ?? evaluation.missingCount ?? 0}</span></div>
        <div class="detail-item"><span class="label">额外识别项</span><span class="value">${evaluation.falsePositiveCount ?? evaluation.extraCount ?? 0}</span></div>
        <div class="detail-item"><span class="label">匹配食物 MAE</span><span class="value">${evaluation.matchedWeightMaeGrams != null ? `${formatNullableNumber(evaluation.matchedWeightMaeGrams, 1)}g` : '-'}</span></div>
        <div class="detail-item"><span class="label">匹配食物相对误差</span><span class="value">${formatRatioPercent(evaluation.matchedWeightRelativeError)}</span></div>
        <div class="detail-item"><span class="label">匹配食物得分</span><span class="value">${formatPercent(evaluation.matchedWeightScorePercent)}</span></div>
        <div class="detail-item"><span class="label">总重量误差</span><span class="value">${formatPercent(evaluation.totalWeightRelativeErrorPercent ?? evaluation.totalDeviation)}</span></div>
        <div class="results-table-wrapper mini">
            <table class="results-table">
                <thead><tr><th>标准食物</th><th>标准g</th><th>识别结果</th><th>估算g</th><th>绝对误差</th><th>归一化相对误差</th><th>匹配类型</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="field-hint">额外识别：${extras}</p>
        <p class="field-hint">相对误差按 |pred-gt| / max(gt, 50g) 计算，小重量食物不会被百分比异常放大。</p>
        ${evaluation.evaluatorError ? `<p class="field-hint">DeepSeek 不可用时已自动回退：${escapeHtml(evaluation.evaluatorError)}</p>` : ''}
    `;
}

function renderEvaluationBenchmarkBlock(evaluation, options = {}) {
    const title = options.title || '标准标签评测';
    if ((options.labelMode === 'total' || evaluation.mode === 'total')) {
        return `
            <div class="result-section">
                <h4>${title}</h4>
                <div class="detail-item"><span class="label">评测模式</span><span class="value">整餐总重量</span></div>
                <div class="detail-item"><span class="label">标准总重量</span><span class="value">${formatNumber(evaluation.trueTotalWeight)}g</span></div>
                <div class="detail-item"><span class="label">估算总重量</span><span class="value">${formatNumber(evaluation.estimatedTotalWeight)}g</span></div>
                <div class="detail-item"><span class="label">总重量误差</span><span class="value">${formatPercent(evaluation.totalWeightRelativeErrorPercent ?? evaluation.totalDeviation)}</span></div>
                <p class="field-hint">当前标签只提供了整餐总重量，所以这里不做逐项食物匹配。</p>
            </div>
        `;
    }

    return `
        <div class="result-section">
            <h4>${title}</h4>
            <div class="detail-item"><span class="label">评测模式</span><span class="value">食物识别 + 匹配食物重量 + 总重量</span></div>
            ${renderItemsBenchmarkContent(evaluation)}
        </div>
    `;
}

function computeBatchModelAggregates(items) {
    const modelMap = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
        (item.modelResults || []).forEach((modelResult) => {
            const label = getModelRunDisplayLabel(modelResult);
            const entry = modelMap.get(label) || {
                label,
                successCount: 0,
                failureCount: 0,
                itemsModeCount: 0,
                totalModeCount: 0,
                compositeSum: 0,
                foodF1Sum: 0,
                matchedWeightErrorSum: 0,
                totalDeviationSum: 0,
                totalDeviationCount: 0,
                responseDurationSum: 0,
                responseDurationCount: 0,
            };
            if (modelResult.success) {
                const evaluation = modelResult.evaluation || {};
                entry.successCount += 1;
                const durationMs = Number(modelResult?.meta?.response_duration_ms);
                if (Number.isFinite(durationMs) && durationMs >= 0) {
                    entry.responseDurationSum += durationMs;
                    entry.responseDurationCount += 1;
                }
                if (evaluation.totalDeviation != null) {
                    entry.totalDeviationSum += Number(evaluation.totalDeviation);
                    entry.totalDeviationCount += 1;
                }
                if (evaluation.mode === 'items') {
                    entry.itemsModeCount += 1;
                    entry.compositeSum += Number(evaluation.finalCompositeScore || 0);
                    entry.foodF1Sum += Number(evaluation.foodF1 || 0);
                    entry.matchedWeightErrorSum += Number(evaluation.matchedWeightRelativeError || 0);
                } else {
                    entry.totalModeCount += 1;
                }
            } else {
                entry.failureCount += 1;
            }
            modelMap.set(label, entry);
        });
    });

    return Array.from(modelMap.values())
        .map((entry) => ({
            ...entry,
            avgCompositeScore: entry.itemsModeCount ? entry.compositeSum / entry.itemsModeCount : null,
            avgFoodF1: entry.itemsModeCount ? entry.foodF1Sum / entry.itemsModeCount : null,
            avgMatchedWeightError: entry.itemsModeCount ? entry.matchedWeightErrorSum / entry.itemsModeCount : null,
            avgTotalDeviation: entry.totalDeviationCount ? entry.totalDeviationSum / entry.totalDeviationCount : null,
            avgResponseDurationMs: entry.responseDurationCount ? entry.responseDurationSum / entry.responseDurationCount : null,
        }))
        .sort((a, b) => {
            const scoreA = a.avgCompositeScore ?? -1;
            const scoreB = b.avgCompositeScore ?? -1;
            if (scoreA !== scoreB) return scoreB - scoreA;
            return (a.avgTotalDeviation ?? Number.POSITIVE_INFINITY) - (b.avgTotalDeviation ?? Number.POSITIVE_INFINITY);
        });
}

function renderModelResultsSummary(modelResults) {
    const results = Array.isArray(modelResults) ? modelResults : [];
    if (!results.length) return '-';
    return results.map((result) => {
        const provider = escapeHtml(getModelRunDisplayLabel(result));
        const durationText = formatDurationMs(result?.meta?.response_duration_ms);
        if (!result.success) {
            return `<span class="model-pill failed">${provider}: 失败 / ${durationText}</span>`;
        }
        const evaluation = result.evaluation || {};
        if (evaluation.mode === 'items') {
            return `<span class="model-pill">${provider}: 综合分 ${formatPercent(evaluation.finalCompositeScorePercent)} / ${durationText}</span>`;
        }
        return `<span class="model-pill">${provider}: 总重 ${formatPercent(evaluation.totalWeightRelativeErrorPercent ?? evaluation.totalDeviation)} / ${durationText}</span>`;
    }).join('');
}

function renderModelEvaluationDetail(result) {
    const evaluation = result.evaluation || {};
    const modelLabel = escapeHtml(getModelRunDisplayLabel(result));
    const recognizedSummary = buildRecognizedItemsSummary(result?.data?.items);
    if (!result.success) {
        return `
            <div class="model-detail-block">
                <h4>${modelLabel}</h4>
                <p style="color:#c62828;">${escapeHtml(result.error || '分析失败')}</p>
            </div>
        `;
    }

    return `
        <div class="model-detail-block">
            <h4>${modelLabel}</h4>
            <div class="detail-item"><span class="label">回答时长</span><span class="value">${formatDurationMs(result?.meta?.response_duration_ms)}</span></div>
            <div class="detail-item"><span class="label">识别结果摘要</span><span class="value">${escapeHtml(recognizedSummary)}</span></div>
            ${renderEvaluationBenchmarkBlock(evaluation, { title: 'benchmark 详情' })}
        </div>
    `;
}

function showBatchDetail(index) {
    const item = currentBatchItems[index];
    if (!item) return;

    elements.batchDetailTitle.textContent = `${item.filename} - 识别详情`;

    const modelDetails = (item.modelResults || []).map(renderModelEvaluationDetail).join('');

    if (item.error && !modelDetails) {
        elements.batchDetailBody.innerHTML = `
            <div class="detail-section">
                <h4>基础信息</h4>
                <div class="detail-item"><span class="label">标准标签</span><span class="value">${renderExpectedItemsInline(item.expectedItems, item.trueWeight, item.labelMode)}</span></div>
                <div class="detail-item"><span class="label">状态</span><span class="value">失败</span></div>
            </div>
            <div class="detail-section">
                <h4>错误信息</h4>
                <p style="color:#c62828;">${escapeHtml(item.error)}</p>
            </div>
        `;
    } else {
        const foodItems = (item.items || []).map((food) => `
            <div class="food-item">
                <div class="name">${escapeHtml(food.name || '-')}</div>
                <div class="weight">${formatNumber(food.estimatedWeightGrams)}g</div>
            </div>
        `).join('') || '<p>无识别明细</p>';

        elements.batchDetailBody.innerHTML = `
            <div class="detail-section">
                <h4>基础信息</h4>
                <div class="detail-item"><span class="label">标准标签</span><span class="value">${renderExpectedItemsInline(item.expectedItems, item.trueWeight, item.labelMode)}</span></div>
                <div class="detail-item"><span class="label">估算重量</span><span class="value">${item.estimatedWeight != null ? formatNumber(item.estimatedWeight) + 'g' : '-'}</span></div>
                <div class="detail-item"><span class="label">主展示模型总重误差</span><span class="value">${formatPercent(item.deviation)}</span></div>
                <div class="detail-item"><span class="label">主展示模型识别结果</span><span class="value">${escapeHtml(buildRecognizedItemsSummary(item.items))}</span></div>
            </div>
            <div class="detail-section">
                <h4>多模型逐项评测</h4>
                ${modelDetails || '<p>暂无模型结果</p>'}
            </div>
            <div class="detail-section">
                <h4>识别食物明细</h4>
                <div class="food-list">${foodItems}</div>
            </div>
        `;
    }

    elements.batchDetailModal.classList.add('active');
}
window.showBatchDetail = showBatchDetail;

function closeBatchDetail() {
    elements.batchDetailModal?.classList.remove('active');
}

function renderAnalyzeModelCard(modelResult, sharedMeta = {}) {
    const meta = modelResult?.meta || {};
    const result = modelResult?.data || {};
    const items = Array.isArray(result.items) ? result.items : [];
    const evaluation = modelResult?.evaluation || {};
    const providerLabel = escapeHtml(getModelRunDisplayLabel(modelResult));
    const modeBadge = meta?.execution_mode ? `<span class="result-badge">${escapeHtml(meta.execution_mode)}</span>` : '';
    const promptBadge = '';
    const primaryBenchmarkBadge = modelResult?.success
        ? (evaluation.mode === 'items'
            ? `<span class="result-badge success">综合分 ${formatPercent(evaluation.finalCompositeScorePercent)}</span>`
            : `<span class="result-badge success">总重误差 ${formatPercent(evaluation.totalWeightRelativeErrorPercent ?? evaluation.totalDeviation)}</span>`)
        : `<span class="result-badge">${escapeHtml(modelResult?.error || '失败')}</span>`;
    const secondaryBenchmarkBadge = modelResult?.success && evaluation.mode === 'items'
        ? `<span class="result-badge">Food F1 ${formatRatioPercent(evaluation.foodF1)}</span>`
        : '';
    const totalWeightBadge = modelResult?.success
        ? `<span class="result-badge">估重 ${formatNumber(evaluation.estimatedTotalWeight)}g</span>`
        : '';
    const itemCountBadge = modelResult?.success
        ? `<span class="result-badge">识别 ${items.length} 项</span>`
        : '';
    const durationBadge = meta?.response_duration_ms != null
        ? `<span class="result-badge">耗时 ${formatDurationMs(meta.response_duration_ms)}</span>`
        : '';

    if (!modelResult?.success) {
        return `
            <div class="result-card analyze-model-card">
                <div class="result-header">
                    <div>
                        <h3 class="analyze-model-name">${providerLabel}</h3>
                        <div class="analyze-model-subtitle">该模型本次分析失败</div>
                    </div>
                    <div class="result-badges">${modeBadge}${promptBadge}${durationBadge}${primaryBenchmarkBadge}</div>
                </div>
                <div class="result-section">
                    <h4>错误信息</h4>
                    <p>${escapeHtml(modelResult?.error || '分析失败')}</p>
                </div>
            </div>
        `;
    }

    const notesText = meta?.notes || sharedMeta?.notes || '-';
    const evaluationSection = renderAnalyzeEvaluationSection(
        modelResult,
        sharedMeta?.labelMode,
        sharedMeta?.expectedItems,
    );
    const foodRows = items.map((item) => {
        return `
            <tr>
                <td>${escapeHtml(item.name || '-')}</td>
                <td>${formatNumber(item.estimatedWeightGrams)}</td>
            </tr>
        `;
    }).join('') || `
        <tr>
            <td colspan="2" class="empty-row">未识别到食物明细</td>
        </tr>
    `;

    return `
        <div class="result-card analyze-model-card">
            <div class="result-header">
                <div>
                    <h3 class="analyze-model-name">${providerLabel}</h3>
                    <div class="analyze-model-subtitle">当前测试页只关注食物识别和重量估算：先看 Food F1，再看匹配食物重量误差，最后补充看总重量误差。</div>
                </div>
                <div class="result-badges">${primaryBenchmarkBadge}${secondaryBenchmarkBadge}${totalWeightBadge}${itemCountBadge}${durationBadge}${modeBadge}${promptBadge}${meta?.is_multi_view ? '<span class="result-badge success">多视角</span>' : ''}</div>
            </div>
            <div class="result-section">
                <h4>文字补充</h4>
                <p>${escapeHtml(notesText)}</p>
            </div>
            ${evaluationSection}
            <div class="result-section">
                <h4>识别食物明细</h4>
                <div class="results-table-wrapper">
                    <table class="results-table">
                        <thead>
                            <tr>
                                <th>食物</th>
                                <th>重量 (g)</th>
                            </tr>
                        </thead>
                        <tbody>${foodRows}</tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function renderAnalyzeEvaluationSection(modelResult, labelMode, expectedItems) {
    const evaluation = modelResult?.evaluation || {};
    const hasExpectedItems = Array.isArray(expectedItems) && expectedItems.length > 0;
    if (!hasExpectedItems) {
        return `
            <div class="result-section">
                <h4>标准标签评测</h4>
                <p>当前没有填写标准标签，所以这里只展示模型分析结果，不计算识别命中率和重量误差。</p>
            </div>
        `;
    }
    return renderEvaluationBenchmarkBlock(evaluation, {
        title: '标准标签评测',
        labelMode,
    });
}

function renderAnalyzeResult(payload) {
    const modelResults = Array.isArray(payload.models) ? payload.models : [];
    const firstSuccess = modelResults.find((item) => item.success) || null;
    const result = payload.data || firstSuccess?.data || {};
    const meta = payload.meta || firstSuccess?.meta || {};
    const items = result.items || [];
    const expectedItems = Array.isArray(payload?.expectedItems) ? payload.expectedItems : [];
    const labelMode = payload?.labelMode || (expectedItems.length ? 'items' : null);
    const uniqueModelNames = new Set(modelResults.map((item) => String(item?.model || item?.provider || 'model').trim()).filter(Boolean));
    const bestModelResult = modelResults
        .filter((item) => item.success)
        .sort((a, b) => {
            const aEval = a.evaluation || {};
            const bEval = b.evaluation || {};
            const aScore = aEval.mode === 'items' && aEval.finalCompositeScore != null ? Number(aEval.finalCompositeScore) : null;
            const bScore = bEval.mode === 'items' && bEval.finalCompositeScore != null ? Number(bEval.finalCompositeScore) : null;
            if (aScore != null || bScore != null) {
                return (bScore ?? -1) - (aScore ?? -1);
            }
            return Number(aEval.totalWeightRelativeError ?? aEval.totalDeviation ?? Infinity) - Number(bEval.totalWeightRelativeError ?? bEval.totalDeviation ?? Infinity);
        })[0] || null;

    const modelStatCards = modelResults.map((modelResult) => {
        const evaluation = modelResult.evaluation || {};
        const isItemsBenchmark = evaluation.mode === 'items' && evaluation.finalCompositeScore != null;
        const valueClass = isItemsBenchmark
            ? (evaluation.finalCompositeScore >= 0.75 ? 'good' : evaluation.finalCompositeScore >= 0.5 ? 'medium' : 'bad')
            : (evaluation.totalDeviation == null ? '' : (evaluation.totalDeviation >= 30 ? 'bad' : evaluation.totalDeviation >= 10 ? 'medium' : 'good'));
        const modelLabel = escapeHtml(getModelRunDisplayLabel(modelResult));
        return `
            <div class="stat-card">
                <div class="label">${modelLabel} ${isItemsBenchmark ? '综合分' : '总重误差'}</div>
                <div class="value ${modelResult.success ? valueClass : 'bad'}">${modelResult.success ? (isItemsBenchmark ? formatPercent(evaluation.finalCompositeScorePercent) : formatPercent(evaluation.totalDeviation)) : '失败'}</div>
            </div>
            <div class="stat-card">
                <div class="label">${modelLabel} 回答时长</div>
                <div class="value">${formatDurationMs(modelResult?.meta?.response_duration_ms)}</div>
            </div>
        `;
    }).join('');

    elements.summaryGrid.innerHTML = `
        <div class="stat-card">
            <div class="label">图片数量</div>
            <div class="value">${meta?.image_count ?? selectedFiles.length}</div>
        </div>
        <div class="stat-card">
            <div class="label">参与结果数</div>
            <div class="value">${modelResults.length}</div>
        </div>
        <div class="stat-card">
            <div class="label">标签模式</div>
            <div class="value">${labelMode === 'total' ? '总重标签' : expectedItems.length ? '逐项标签' : '未填写'}</div>
        </div>
        <div class="stat-card">
            <div class="label">${labelMode === 'items' ? '标准食物数' : '参与模型数'}</div>
            <div class="value">${labelMode === 'items' ? expectedItems.length : uniqueModelNames.size}</div>
        </div>
        <div class="stat-card">
            <div class="label">标准总重量</div>
            <div class="value">${meta?.reference_weight != null ? formatNumber(meta.reference_weight) + 'g' : '-'}</div>
        </div>
        <div class="stat-card">
            <div class="label">${bestModelResult?.evaluation?.mode === 'items' ? '最佳综合分模型' : '最低总重误差模型'}</div>
            <div class="value">${bestModelResult ? escapeHtml(getModelRunDisplayLabel(bestModelResult)) : '-'}</div>
        </div>
        ${modelStatCards}
    `;

    if (!firstSuccess && modelResults.length) {
        elements.analyzeModelResults.innerHTML = modelResults.map((item) => renderAnalyzeModelCard(item, {
            ...meta,
            labelMode: payload?.labelMode,
            expectedItems: payload?.expectedItems,
        })).join('');
        elements.analysisResult.style.display = 'block';
        elements.analysisResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    elements.analyzeModelResults.innerHTML = modelResults.map((item) => renderAnalyzeModelCard(item, {
        ...meta,
        labelMode: payload?.labelMode,
        expectedItems: payload?.expectedItems,
    })).join('');

    elements.analysisResult.style.display = 'block';
    elements.analysisResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatNumber(value) {
    return Number(value || 0).toFixed(1);
}

function formatFileSize(size) {
    if (!size) return '0 B';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(dateStr) {
    return formatDate(dateStr);
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
            promptsList = (result.data || []).filter((prompt) => String(prompt.model_type || '').toLowerCase() === 'gemini');
            renderPromptsList();

            const active = promptsList.find((prompt) => prompt.is_active);
            if (active) {
                loadActivePrompt(active);
            } else {
                clearActivePromptEditor();
            }
            loadGeminiPromptOptions(active?.id ?? null);
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
            await loadPrompts();
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
            await loadPrompts();
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
            await loadPrompts();
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
            await loadPrompts();
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
