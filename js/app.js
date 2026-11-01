/*
 * منطق التطبيق:
 * 1) واجهة إدخال البيانات والتحقق منها.
 * 2) لوحات توقيع مستقلة مع حفظ النقاط/الصور.
 * 3) معاينة النموذج الرسمي بمقاس A4.
 * 4) تصدير المعاينة إلى PNG عالي الدقة.
 * 5) مسودة تلقائية وأرشيف محلي اختياري.
 */
(function () {
  'use strict';

  const cfg = window.LAUNDRY_CONFIG;
  const storage = window.LaundryStorage;

  if (!cfg || !storage) {
    document.body.textContent = 'تعذّر تحميل إعدادات التطبيق.';
    return;
  }

  const A4_WIDTH = 794;
  const A4_HEIGHT = 1123;
  const EXPORT_SCALE = 3;
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 1.75;
  const REQUIRED_FIELDS = ['formNumber', 'formDate', 'formTime', 'shift', 'department'];

  const state = {
    current: null,
    pads: {},
    hasEdits: false,
    autosaveTimer: 0,
    autoSaveFailedNotice: false,
    isPreview: false,
    isFit: true,
    zoom: 0.75,
    busy: false,
    entryScroll: 0,
    pendingDraft: null,
    confirmResolver: null,
    suppressInput: false
  };

  const dom = {};
  const itemInputs = {};
  const docCells = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheDom();
    applyHospitalIdentity();
    populateOptions();
    buildItemsTable();
    buildSignatureCards();
    buildDocumentTable();
    bindEvents();
    initNewForm({ initial: true });

    if (typeof window.SignaturePad !== 'function') {
      showToast('تعذّر تحميل أداة التوقيع. أعد تحميل الصفحة.', { type: 'error', duration: 8000 });
    } else {
      initSignaturePads();
    }

    const draft = storage.getCurrentDraft();
    if (draft && draft.state) {
      showRestoreBanner(draft);
    }

    updateUi();
    window.setTimeout(() => {
      dom.entryForm.classList.add('is-ready');
    }, 30);
  }

  function cacheDom() {
    const ids = [
      'entryView', 'previewView', 'entryForm', 'itemsTableHead', 'itemsTableBody',
      'formNumber', 'formDate', 'formTime', 'shift', 'department', 'departmentList',
      'signatureGrid', 'signatureCounter', 'saveState', 'saveStateText',
      'btnArchive', 'btnNew', 'btnClearAll', 'btnSaveDraft', 'btnGenerate',
      'btnBack', 'btnZoomIn', 'btnZoomOut', 'btnFit', 'btnExport', 'zoomValue',
      'previewStage', 'pageViewport', 'a4Page', 'pvFormNo', 'pvShift', 'pvDate',
      'pvDepartment', 'pvTime', 'docTableBody', 'restoreBanner', 'restoreMeta',
      'btnRestoreDraft', 'btnDismissDraft', 'dockLabel', 'dockNote',
      'archiveDialog', 'archiveList', 'btnCloseArchive', 'btnArchiveDone',
      'btnSaveFromArchive', 'confirmDialog', 'confirmTitle', 'confirmMessage',
      'btnConfirmCancel', 'btnConfirmAccept', 'busyOverlay', 'busyTitle',
      'busyText', 'toastRegion'
    ];
    ids.forEach((id) => {
      dom[id] = document.getElementById(id);
    });
  }

  function applyHospitalIdentity() {
    const hospital = cfg.hospital || {};
    document.querySelectorAll('[data-hospital]').forEach((element) => {
      const key = element.dataset.hospital;
      if (hospital[key]) element.textContent = hospital[key];
    });
  }

  function populateOptions() {
    cfg.shifts.forEach((shift) => {
      const option = document.createElement('option');
      option.value = shift;
      option.textContent = shift;
      dom.shift.append(option);
    });

    cfg.departments.forEach((department) => {
      const option = document.createElement('option');
      option.value = department;
      dom.departmentList.append(option);
    });
  }

  function buildItemsTable() {
    const groupDirty = 'المفروشات غير النظيفة (المتسخة)';
    const groupClean = 'المفروشات النظيفة (المستلمة)';

    dom.itemsTableHead.innerHTML = `
      <tr>
        <th rowspan="2" scope="col" class="th-item">نوع المفروشات</th>
        <th colspan="3" scope="colgroup" class="group-head group-head--dirty">
          <span class="group-dot"></span>${groupDirty}
        </th>
        <th colspan="3" scope="colgroup" class="group-head group-head--clean">
          <span class="group-dot"></span>${groupClean}
        </th>
      </tr>
      <tr>
        <th scope="col">العدد</th>
        <th scope="col">وقت التسليم<br>من القسم</th>
        <th scope="col">الوقت المستلم<br>بالمغسلة</th>
        <th scope="col">العدد</th>
        <th scope="col">وقت التسليم<br>من المغسلة</th>
        <th scope="col">وقت استلام<br>القسم</th>
      </tr>
    `;

    const fragment = document.createDocumentFragment();

    cfg.items.forEach((item) => {
      const row = document.createElement('tr');
      row.dataset.item = item.id;

      const nameCell = document.createElement('th');
      nameCell.scope = 'row';
      nameCell.className = 'item-name-cell';
      const name = document.createElement('span');
      name.className = 'item-name';
      name.textContent = item.name;
      nameCell.append(name);
      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'item-hint';
        hint.textContent = item.hint;
        nameCell.append(hint);
      }
      row.append(nameCell);

      itemInputs[item.id] = {};

      cfg.fields.forEach((field) => {
        const cell = document.createElement('td');
        cell.className = `cell cell--${field.group}`;
        cell.dataset.group = field.group === 'dirty' ? 'المتسخة' : 'النظيفة';
        cell.dataset.label = `${field.label} — ${field.group === 'dirty' ? 'المتسخة' : 'النظيفة'}`;

        const input = document.createElement('input');
        input.className = 'cell-input';
        input.id = `item-${item.id}-${field.key}`;
        input.dataset.item = item.id;
        input.dataset.field = field.key;
        input.dataset.kind = field.kind;
        input.setAttribute('aria-label', `${item.name} — ${field.label} (${field.group === 'dirty' ? 'غير نظيفة' : 'نظيفة'})`);

        if (field.kind === 'qty') {
          input.type = 'text';
          input.inputMode = 'numeric';
          input.pattern = '[0-9]*';
          input.maxLength = 4;
          input.autocomplete = 'off';
          input.placeholder = '0';
          input.lang = 'en';
          input.dir = 'ltr';
          const shell = document.createElement('div');
          shell.className = 'cell-input-shell';
          shell.append(input);
          cell.append(shell);
        } else {
          input.type = 'time';
          input.step = '60';
          const shell = document.createElement('div');
          shell.className = 'cell-input-shell';
          shell.append(input);
          cell.append(shell);
        }

        row.append(cell);
        itemInputs[item.id][field.key] = input;
      });

      fragment.append(row);
    });

    dom.itemsTableBody.append(fragment);
  }

  function buildSignatureCards() {
    cfg.signers.forEach((signer, index) => {
      const card = document.createElement('article');
      card.className = 'signature-card';
      card.dataset.signer = signer.id;

      const head = document.createElement('div');
      head.className = 'signature-head';

      const order = document.createElement('span');
      order.className = 'signature-order';
      order.textContent = String(index + 1).padStart(2, '0');
      order.setAttribute('aria-hidden', 'true');

      const copy = document.createElement('div');
      copy.className = 'signature-head-copy';
      const role = document.createElement('h3');
      role.textContent = signer.role;
      const description = document.createElement('p');
      description.textContent = signer.description;
      copy.append(role, description);

      const status = document.createElement('span');
      status.className = 'signature-status';
      status.dataset.signatureStatus = signer.id;
      status.textContent = 'بانتظار التوقيع';

      head.append(order, copy, status);

      const nameField = document.createElement('div');
      nameField.className = 'field signer-field';
      const label = document.createElement('label');
      label.htmlFor = `signer-${signer.id}`;
      label.textContent = signer.inputLabel;
      const input = document.createElement('input');
      input.className = 'input signer-input';
      input.id = `signer-${signer.id}`;
      input.type = 'text';
      input.maxLength = cfg.storage.maxNameLength;
      input.autocomplete = 'off';
      input.placeholder = signer.placeholder;
      input.dataset.signerName = signer.id;
      nameField.append(label, input);

      const padWrap = document.createElement('div');
      padWrap.className = 'signature-pad-wrap';
      padWrap.dataset.pad = signer.id;

      const canvas = document.createElement('canvas');
      canvas.className = 'signature-canvas';
      canvas.dataset.signatureCanvas = signer.id;
      canvas.setAttribute('aria-label', `مساحة توقيع ${signer.role}`);
      canvas.setAttribute('role', 'img');

      const placeholder = document.createElement('span');
      placeholder.className = 'signature-placeholder';
      const placeholderIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      placeholderIcon.setAttribute('class', 'icon');
      placeholderIcon.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-pen');
      placeholderIcon.append(use);
      const placeholderText = document.createElement('span');
      placeholderText.textContent = 'وقّع هنا';
      placeholder.append(placeholderIcon, placeholderText);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'signature-clear';
      clearBtn.type = 'button';
      clearBtn.dataset.clearSignature = signer.id;
      clearBtn.setAttribute('aria-label', `مسح توقيع ${signer.role}`);
      clearBtn.hidden = true;
      const clearIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      clearIcon.setAttribute('class', 'icon icon--xs');
      clearIcon.setAttribute('aria-hidden', 'true');
      const clearUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      clearUse.setAttribute('href', '#i-x');
      clearIcon.append(clearUse);
      const clearText = document.createElement('span');
      clearText.textContent = 'مسح';
      clearBtn.append(clearIcon, clearText);

      padWrap.append(canvas, placeholder, clearBtn);

      const padFoot = document.createElement('div');
      padFoot.className = 'signature-pad-foot';
      const hint = document.createElement('span');
      hint.textContent = 'استخدم الإصبع أو الماوس للتوقيع';
      const secured = document.createElement('span');
      secured.className = 'signature-local';
      secured.textContent = 'محلي فقط';
      padFoot.append(hint, secured);

      card.append(head, nameField, padWrap, padFoot);
      dom.signatureGrid.append(card);
    });
  }

  function buildDocumentTable() {
    const fragment = document.createDocumentFragment();

    cfg.items.forEach((item) => {
      const row = document.createElement('tr');
      const nameCell = document.createElement('th');
      nameCell.scope = 'row';
      nameCell.className = 'doc-item-cell';
      const name = document.createElement('span');
      name.textContent = item.name;
      nameCell.append(name);
      if (item.hint) {
        const hint = document.createElement('small');
        hint.textContent = item.hint;
        nameCell.append(hint);
      }
      row.append(nameCell);

      docCells[item.id] = {};
      cfg.fields.forEach((field) => {
        const cell = document.createElement('td');
        cell.dataset.docItem = item.id;
        cell.dataset.docField = field.key;
        if (field.kind === 'qty') cell.classList.add('doc-qty-cell');
        row.append(cell);
        docCells[item.id][field.key] = cell;
      });

      fragment.append(row);
    });

    dom.docTableBody.append(fragment);
  }

  function bindEvents() {
    dom.entryForm.addEventListener('input', handleFormInput);
    dom.entryForm.addEventListener('change', handleFormInput);
    dom.entryForm.addEventListener('blur', handleFormBlur, true);
    dom.entryForm.addEventListener('submit', (event) => event.preventDefault());

    dom.btnGenerate.addEventListener('click', generatePreview);
    dom.btnBack.addEventListener('click', closePreview);
    dom.btnZoomIn.addEventListener('click', () => {
      state.isFit = false;
      setZoom(state.zoom + 0.1);
    });
    dom.btnZoomOut.addEventListener('click', () => {
      state.isFit = false;
      setZoom(state.zoom - 0.1);
    });
    dom.btnFit.addEventListener('click', fitPreview);
    dom.btnExport.addEventListener('click', exportPng);

    dom.btnNew.addEventListener('click', requestNewForm);
    dom.btnClearAll.addEventListener('click', requestNewForm);
    dom.btnSaveDraft.addEventListener('click', () => saveDraft({ announce: true }));

    dom.btnArchive.addEventListener('click', openArchive);
    dom.btnCloseArchive.addEventListener('click', closeArchive);
    dom.btnArchiveDone.addEventListener('click', closeArchive);
    dom.btnSaveFromArchive.addEventListener('click', async () => {
      const ok = await saveDraft({ announce: false });
      if (ok) {
        closeArchive();
        showToast('تم حفظ النموذج كمسودة على هذا الجهاز.', { type: 'success' });
      }
    });
    dom.archiveList.addEventListener('click', handleArchiveClick);

    dom.btnRestoreDraft.addEventListener('click', restoreDraft);
    dom.btnDismissDraft.addEventListener('click', () => {
      storage.clearCurrentDraft();
      state.pendingDraft = null;
      hideRestoreBanner(false);
      showToast('تم تجاهل المسودة السابقة. بدأ نموذج جديد.', { type: 'info' });
    });

    dom.btnConfirmCancel.addEventListener('click', () => settleConfirm(false));
    dom.btnConfirmAccept.addEventListener('click', () => settleConfirm(true));

    document.querySelectorAll('dialog').forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        if (dialog === dom.confirmDialog) {
          settleConfirm(false);
        } else {
          dialog.close();
        }
      });
      dialog.addEventListener('close', syncBodyLock);
      dialog.addEventListener('open', syncBodyLock);
    });

    dom.confirmDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      settleConfirm(false);
    });

    dom.archiveDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeArchive();
    });

    window.addEventListener('resize', handleResize);
    window.addEventListener('pagehide', persistBeforeLeave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persistBeforeLeave();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.isPreview && !state.busy && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        closePreview();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        if (state.isPreview || document.querySelector('dialog[open]')) return;
        event.preventDefault();
        saveDraft({ announce: true });
      }
    });
  }

  function initSignaturePads() {
    cfg.signers.forEach((signer) => {
      const card = dom.signatureGrid.querySelector(`[data-signer="${signer.id}"]`);
      const canvas = card.querySelector('[data-signature-canvas]');
      if (!canvas) return;
      const field = new SignatureField(signer, card, canvas);
      field.init();
      state.pads[signer.id] = field;
    });
  }

  class SignatureField {
    constructor(signer, card, canvas) {
      this.signer = signer;
      this.card = card;
      this.canvas = canvas;
      this.placeholder = card.querySelector('.signature-placeholder');
      this.clearButton = card.querySelector('[data-clear-signature]');
      this.status = card.querySelector('[data-signature-status]');
      this.ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2.5);
      this.pad = null;
      this.cssWidth = 0;
      this.cssHeight = 0;
      this.resizeTimer = 0;
      this.initialized = false;
    }

    init() {
      this.resizeCanvas(true);
      this.pad = new window.SignaturePad(this.canvas, {
        backgroundColor: 'rgba(0,0,0,0)',
        penColor: '#193632',
        velocityFilterWeight: 0.72,
        minWidth: 0.8,
        maxWidth: 2.8,
        dotSize: 2.2,
        throttle: 8,
        canvasContextOptions: { desynchronized: true }
      });

      this.pad.addEventListener('endStroke', () => {
        const data = this.getDataURL();
        setSignerSignature(this.signer.id, data);
        this.refreshUi();
        markTouched();
      });

      this.pad.addEventListener('beginStroke', () => {
        this.card.classList.add('is-signing');
        this.placeholder.hidden = true;
        this.clearButton.hidden = false;
      });
      this.pad.addEventListener('endStroke', () => {
        this.card.classList.remove('is-signing');
      });

      this.clearButton.addEventListener('click', () => {
        if (this.pad.isEmpty()) return;
        this.clear();
        setSignerSignature(this.signer.id, null);
        markTouched();
        this.refreshUi();
        showToast(`تم مسح توقيع ${this.signer.role}.`, { type: 'info', duration: 2600 });
      });

      const resizeObserver = new ResizeObserver(() => {
        if (!this.initialized) return;
        window.clearTimeout(this.resizeTimer);
        this.resizeTimer = window.setTimeout(() => this.resizeCanvas(false), 120);
      });
      resizeObserver.observe(this.canvas);
      this.resizeObserver = resizeObserver;
      this.initialized = true;
      this.refreshUi();
    }

    resizeCanvas(initial) {
      const rect = this.canvas.getBoundingClientRect();
      const cssWidth = Math.round(rect.width);
      const cssHeight = Math.round(rect.height);
      if (cssWidth < 40 || cssHeight < 40) return;

      const changed = Math.abs(cssWidth - this.cssWidth) > 1 || Math.abs(cssHeight - this.cssHeight) > 1;
      if (!initial && !changed) return;
      if (initial && this.cssWidth && !changed) return;

      let previous = null;
      if (this.pad && !this.pad.isEmpty()) {
        try {
          previous = this.pad.toDataURL('image/png');
        } catch (error) {
          previous = null;
        }
      }

      this.cssWidth = cssWidth;
      this.cssHeight = cssHeight;
      this.canvas.width = Math.max(1, Math.round(cssWidth * this.ratio));
      this.canvas.height = Math.max(1, Math.round(cssHeight * this.ratio));

      const context = this.canvas.getContext('2d');
      context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);

      if (this.pad) {
        this.pad.clear();
        if (previous) {
          this.pad.fromDataURL(previous, { ratio: this.ratio })
            .then(() => {
              this.refreshUi();
              const data = this.getDataURL();
              const signerState = state.current.signers[this.signer.id];
              if (signerState && signerState.signature !== data) {
                signerState.signature = data;
              }
            })
            .catch(() => this.refreshUi());
        } else {
          this.refreshUi();
        }
      }
    }

    async applySignature(dataUrl) {
      if (!this.pad) return;
      this.pad.clear();
      this.refreshUi();
      if (!dataUrl) return;
      try {
        await this.pad.fromDataURL(dataUrl, { ratio: this.ratio });
      } catch (error) {
        this.pad.clear();
      }
      this.refreshUi();
    }

    getDataURL() {
      if (!this.pad || this.pad.isEmpty()) return null;
      try {
        return this.pad.toDataURL('image/png');
      } catch (error) {
        return null;
      }
    }

    syncToState() {
      if (!state.current) return;
      state.current.signers[this.signer.id].signature = this.getDataURL();
    }

    clear() {
      if (!this.pad) return;
      this.pad.clear();
      this.refreshUi();
    }

    refreshUi() {
      const hasSignature = Boolean(this.pad && !this.pad.isEmpty());
      this.placeholder.hidden = hasSignature;
      this.clearButton.hidden = !hasSignature;
      this.card.classList.toggle('is-signed', hasSignature);
      this.status.textContent = hasSignature ? 'تم التوقيع' : 'بانتظار التوقيع';
      this.status.classList.toggle('is-signed', hasSignature);
    }
  }

  function initNewForm(options = {}) {
    window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = 0;
    const now = new Date();
    const year = now.getFullYear();
    const current = createEmptyState(now, year);
    state.current = current;
    applyStateToForm(current);

    if (state.pads && Object.keys(state.pads).length) {
      Object.values(state.pads).forEach((pad) => pad.clear());
    }

    state.hasEdits = false;
    resetValidation();
    setSaveStatus('local', 'محلي على جهازك');

    if (!options.initial) {
      hideRestoreBanner(true);
      storage.clearCurrentDraft();
      updateUi();
    }
  }

  function createEmptyState(now, year, options = {}) {
    const items = {};
    cfg.items.forEach((item) => {
      items[item.id] = {};
      cfg.fields.forEach((field) => {
        items[item.id][field.key] = '';
      });
    });

    const signers = {};
    cfg.signers.forEach((signer) => {
      signers[signer.id] = { name: '', signature: null };
    });

    const iso = toIsoDate(now);
    return {
      schemaVersion: cfg.schemaVersion,
      id: createId(),
      formNumber: options.allocateNumber === false ? '' : storage.nextSerial(year),
      date: iso,
      time: toIsoTime(now),
      shift: shiftForDate(now),
      department: '',
      items,
      signers,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
  }

  function applyStateToForm(current) {
    state.suppressInput = true;
    dom.formNumber.value = current.formNumber;
    dom.formDate.value = current.date;
    dom.formTime.value = current.time;
    dom.shift.value = current.shift;
    dom.department.value = current.department;

    cfg.items.forEach((item) => {
      cfg.fields.forEach((field) => {
        const input = itemInputs[item.id] && itemInputs[item.id][field.key];
        const value = current.items[item.id] && current.items[item.id][field.key];
        if (input) input.value = value == null ? '' : String(value);
      });
    });

    cfg.signers.forEach((signer) => {
      const input = dom.signatureGrid.querySelector(`[data-signer-name="${signer.id}"]`);
      if (input) input.value = current.signers[signer.id].name || '';
    });

    state.suppressInput = false;
  }

  async function applySignaturesFromState() {
    const jobs = Object.values(state.pads).map((pad) => {
      const data = state.current.signers[pad.signer.id]
        ? state.current.signers[pad.signer.id].signature
        : null;
      return pad.applySignature(data);
    });
    await Promise.all(jobs);
  }

  function handleFormInput(event) {
    if (state.suppressInput) return;
    const target = event.target;
    if (!target || !target.matches('input, select')) return;

    if (target.matches('.cell-input[data-kind="qty"]')) {
      sanitizeQuantityInput(target);
    }

    if (target.id && REQUIRED_FIELDS.includes(target.id)) {
      clearFieldError(target.id);
    }

    syncStateFromDom();
    markTouched();
  }

  function handleFormBlur(event) {
    const target = event.target;
    if (!target || !target.matches('.cell-input[data-kind="qty"]')) return;
    sanitizeQuantityInput(target, true);
    syncStateFromDom();
  }

  function sanitizeQuantityInput(input, clampOnly) {
    let value = toWesternDigits(input.value || '');
    if (!clampOnly) {
      value = value.replace(/[^\d]/g, '');
      if (value.length > 4) value = value.slice(0, 4);
      value = value.replace(/^0+(?=\d)/, '');
    } else if (value !== '') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed < 0) value = '';
      else value = String(Math.min(parsed, cfg.storage.maxQuantity));
    }
    if (input.value !== value) input.value = value;
  }

  function toWesternDigits(value) {
    return String(value)
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
  }

  function syncStateFromDom() {
    if (!state.current) return;
    const current = state.current;
    current.formNumber = dom.formNumber.value.trim();
    current.date = dom.formDate.value;
    current.time = dom.formTime.value;
    current.shift = dom.shift.value;
    current.department = dom.department.value.trim();

    cfg.items.forEach((item) => {
      cfg.fields.forEach((field) => {
        const input = itemInputs[item.id] && itemInputs[item.id][field.key];
        current.items[item.id][field.key] = input ? input.value : '';
      });
    });

    cfg.signers.forEach((signer) => {
      const input = dom.signatureGrid.querySelector(`[data-signer-name="${signer.id}"]`);
      current.signers[signer.id].name = input ? input.value.trim() : '';
    });

    current.updatedAt = new Date().toISOString();
  }

  function syncSignaturePadsToState() {
    Object.values(state.pads).forEach((pad) => pad.syncToState());
  }

  function setSignerSignature(signerId, dataUrl) {
    if (!state.current || !state.current.signers[signerId]) return;
    state.current.signers[signerId].signature = dataUrl;
    state.current.updatedAt = new Date().toISOString();
  }

  function markTouched() {
    state.hasEdits = true;
    if (!dom.restoreBanner.hidden) {
      hideRestoreBanner(true);
    }
    setSaveStatus('saving', 'جارٍ الحفظ…');
    scheduleAutosave();
    updateUi();
  }

  function scheduleAutosave() {
    window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = window.setTimeout(persistDraftNow, cfg.storage.autosaveDelay);
  }

  function persistDraftNow() {
    if (!state.current) return;
    syncStateFromDom();
    const result = storage.saveCurrentDraft(state.current);
    if (result.ok) {
      setSaveStatus('saved', `محفوظ تلقائيًا ${formatClock(new Date())}`);
      state.autoSaveFailedNotice = false;
    } else {
      setSaveStatus('error', 'تعذّر الحفظ المحلي');
      if (!state.autoSaveFailedNotice) {
        state.autoSaveFailedNotice = true;
        showToast('تعذّر حفظ المسودة محليًا. قد تكون مساحة التخزين ممتلئة.', { type: 'error', duration: 7000 });
      }
    }
  }

  function persistBeforeLeave() {
    if (!state.current || !state.hasEdits) return;
    syncStateFromDom();
    syncSignaturePadsToState();
    storage.saveCurrentDraft(state.current);
  }

  function setSaveStatus(status, text) {
    dom.saveState.dataset.status = status;
    dom.saveStateText.textContent = text;
  }

  function updateUi() {
    if (!state.current) return;
    const signed = cfg.signers.filter((signer) => {
      const value = state.current.signers[signer.id];
      return Boolean(value && value.signature);
    }).length;

    dom.signatureCounter.textContent = `${signed} من ${cfg.signers.length} موقّع`;
    dom.signatureCounter.classList.toggle('is-complete', signed === cfg.signers.length);

    const missing = getMissingRequired();
    if (missing.length === 0) {
      if (signed === cfg.signers.length) {
        dom.dockLabel.textContent = 'جاهز للإنشاء';
        dom.dockNote.textContent = 'اكتملت البيانات والتوقيعات الثلاثة. يمكنك إنشاء النموذج الآن.';
      } else {
        dom.dockLabel.textContent = 'البيانات مكتملة';
        dom.dockNote.textContent = signed === 0
          ? 'يمكنك إضافة التوقيعات قبل الإنشاء، أو المتابعة دونها.'
          : `تم توقيع ${signed} من ${cfg.signers.length} أطراف.`;
      }
    } else {
      dom.dockLabel.textContent = 'أكمل البيانات المطلوبة';
      dom.dockNote.textContent = `تبقّى ${missing.length} من الحقول الأساسية.`;
    }
  }

  function getMissingRequired() {
    const current = state.current;
    const missing = [];
    if (!current.formNumber || !current.formNumber.trim()) missing.push('formNumber');
    if (!current.date) missing.push('formDate');
    if (!current.time) missing.push('formTime');
    if (!current.shift) missing.push('shift');
    if (!current.department || !current.department.trim()) missing.push('department');
    return missing;
  }

  function hasFormContent() {
    if (!state.current) return false;
    const current = state.current;
    if (current.department && current.department.trim()) return true;
    const hasItemValue = cfg.items.some((item) => {
      const record = current.items[item.id];
      return record && cfg.fields.some((field) => record[field.key] !== '' && record[field.key] != null);
    });
    if (hasItemValue) return true;
    return cfg.signers.some((signer) => {
      const record = current.signers[signer.id];
      return record && (record.signature || (record.name && record.name.trim()));
    });
  }

  function validateForm() {
    const current = state.current;
    const errors = {};
    if (!current.formNumber || !current.formNumber.trim()) {
      errors.formNumber = 'أدخل رقم النموذج.';
    }
    if (!current.date || !/^\d{4}-\d{2}-\d{2}$/.test(current.date)) {
      errors.formDate = 'اختر تاريخ النموذج.';
    }
    if (!current.time || !/^\d{2}:\d{2}$/.test(current.time)) {
      errors.formTime = 'حدّد وقت النموذج.';
    }
    if (!current.shift) {
      errors.shift = 'اختر الوردية.';
    }
    if (!current.department || !current.department.trim()) {
      errors.department = 'أدخل اسم القسم أو العيادة.';
    }

    REQUIRED_FIELDS.forEach((id) => clearFieldError(id));
    Object.entries(errors).forEach(([id, message]) => setFieldError(id, message));

    const firstKey = Object.keys(errors)[0];
    if (firstKey) {
      const first = document.getElementById(firstKey);
      if (first) {
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => first.focus({ preventScroll: true }), 180);
      }
      showToast(errors[firstKey], { type: 'error', duration: 4500 });
      return false;
    }
    return true;
  }

  function setFieldError(id, message) {
    const input = document.getElementById(id);
    const error = dom.entryForm.querySelector(`[data-error-for="${id}"]`);
    if (!input || !error) return;
    const field = input.closest('.field');
    if (field) field.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    if (error.id === '') error.id = `${id}-error`;
    input.setAttribute('aria-describedby', `${id}-error`);
    error.textContent = message;
    error.hidden = false;
  }

  function clearFieldError(id) {
    if (!id) return;
    const input = document.getElementById(id);
    const error = dom.entryForm.querySelector(`[data-error-for="${id}"]`);
    if (!input || !error) return;
    const field = input.closest('.field');
    if (field) field.classList.remove('is-invalid');
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    error.textContent = '';
    error.hidden = true;
  }

  function resetValidation() {
    REQUIRED_FIELDS.forEach((id) => clearFieldError(id));
  }

  async function generatePreview() {
    if (state.busy) return;
    syncStateFromDom();
    syncSignaturePadsToState();

    if (!validateForm()) return;

    state.current.updatedAt = new Date().toISOString();
    renderDocument();
    state.entryScroll = window.scrollY;

    storage.saveCurrentDraft(state.current);
    setSaveStatus('saved', `محفوظ تلقائيًا ${formatClock(new Date())}`);

    dom.entryView.hidden = true;
    dom.previewView.hidden = false;
    document.body.classList.add('is-preview');
    state.isPreview = true;
    window.scrollTo(0, 0);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        fitPreview();
        dom.previewView.focus({ preventScroll: true });
      });
    });
  }

  function closePreview() {
    if (state.busy) return;
    dom.previewView.hidden = true;
    dom.entryView.hidden = false;
    document.body.classList.remove('is-preview');
    state.isPreview = false;
    window.scrollTo(0, state.entryScroll || 0);
    updateUi();
    window.setTimeout(() => {
      const title = document.getElementById('pageTitle');
      if (title) title.focus({ preventScroll: true });
    }, 60);
  }

  function renderDocument() {
    const current = state.current;
    dom.pvFormNo.textContent = current.formNumber.trim() || '—';
    dom.pvShift.textContent = current.shift || '—';
    dom.pvDate.textContent = formatDate(current.date);
    dom.pvDepartment.textContent = current.department.trim() || '—';
    dom.pvTime.textContent = current.time || '—';

    cfg.items.forEach((item) => {
      cfg.fields.forEach((field) => {
        const cell = docCells[item.id] && docCells[item.id][field.key];
        if (!cell) return;
        const value = current.items[item.id] && current.items[item.id][field.key];
        cell.textContent = value == null ? '' : String(value);
      });
    });

    cfg.signers.forEach((signer) => {
      const signerState = current.signers[signer.id];
      const nameEl = dom.a4Page.querySelector(`[data-pv-name="${signer.id}"]`);
      const image = dom.a4Page.querySelector(`[data-pv-sign="${signer.id}"]`);
      if (nameEl) nameEl.textContent = signerState.name || '';
      if (image) {
        if (signerState.signature) {
          image.src = signerState.signature;
          image.hidden = false;
        } else {
          image.removeAttribute('src');
          image.hidden = true;
        }
      }
    });
  }

  function fitPreview() {
    state.isFit = true;
    const availableWidth = Math.max(200, dom.previewStage.clientWidth - 64);
    const availableHeight = Math.max(300, dom.previewStage.clientHeight - 80);
    const fit = Math.min(availableWidth / A4_WIDTH, availableHeight / A4_HEIGHT, 1);
    state.zoom = clamp(fit, MIN_ZOOM, MAX_ZOOM);
    applyZoom();
  }

  function setZoom(next) {
    state.zoom = clamp(Math.round(next * 100) / 100, MIN_ZOOM, MAX_ZOOM);
    applyZoom();
  }

  function applyZoom() {
    const scale = state.zoom;
    dom.pageViewport.style.width = `${Math.round(A4_WIDTH * scale)}px`;
    dom.pageViewport.style.height = `${Math.round(A4_HEIGHT * scale)}px`;
    dom.a4Page.style.transform = `scale(${scale})`;
    dom.zoomValue.textContent = `${Math.round(scale * 100)}%`;
    dom.zoomValue.setAttribute('title', `${Math.round(scale * 100)}%`);
    const fit = Math.min(
      Math.max(200, dom.previewStage.clientWidth - 64) / A4_WIDTH,
      Math.max(300, dom.previewStage.clientHeight - 80) / A4_HEIGHT,
      1
    );
    dom.previewStage.classList.toggle('is-zoomed', scale > fit + 0.015);
  }

  function handleResize() {
    if (!state.isPreview) return;
    if (state.isFit) {
      fitPreview();
    } else {
      applyZoom();
    }
  }

  async function exportPng() {
    if (state.busy) return;
    if (typeof window.html2canvas !== 'function') {
      showToast('تعذّر تحميل أداة تصدير الصورة. أعد تحميل الصفحة.', { type: 'error', duration: 7000 });
      return;
    }

    state.busy = true;
    syncStateFromDom();
    syncSignaturePadsToState();
    renderDocument();
    setBusy(true, 'جارٍ إنشاء الصورة', 'يتم تجهيز النموذج بدقة عالية. قد يستغرق ذلك لحظات.');
    dom.btnExport.disabled = true;

    try {
      await waitForFonts();
      await preloadSignatureImages();
      await nextFrame();
      await nextFrame();

      const clone = dom.a4Page.cloneNode(true);
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
      clone.querySelectorAll('img[hidden]').forEach((image) => image.remove());
      clone.classList.add('a4-page--export');
      clone.style.transform = 'none';
      clone.style.margin = '0';
      clone.style.boxShadow = 'none';
      clone.style.width = `${A4_WIDTH}px`;
      clone.style.height = `${A4_HEIGHT}px`;

      const host = document.createElement('div');
      host.className = 'export-host';
      host.setAttribute('aria-hidden', 'true');
      host.append(clone);
      document.body.append(host);

      await nextFrame();
      const canvas = await window.html2canvas(clone, {
        backgroundColor: '#ffffff',
        scale: EXPORT_SCALE,
        width: A4_WIDTH,
        height: A4_HEIGHT,
        windowWidth: 1200,
        windowHeight: 1400,
        scrollX: 0,
        scrollY: 0,
        useCORS: true,
        allowTaint: false,
        logging: false,
        imageTimeout: 15000,
        removeContainer: true
      });

      host.remove();

      const blob = await canvasToBlob(canvas);
      const filename = buildFilename();
      const url = downloadBlob(blob, filename);
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      showToast(
        isIOS
          ? 'تم تجهيز الصورة. إن لم تبدأ عملية الحفظ، استخدم زر «فتح الصورة» ثم احفظها من معرض الصور.'
          : `تم حفظ الصورة بدقة ${canvas.width} × ${canvas.height} بكسل.`,
        {
          type: 'success',
          duration: isIOS ? 9000 : 6500,
          actionLabel: 'فتح الصورة',
          onAction: () => window.open(url, '_blank', 'noopener')
        }
      );
      setSaveStatus('saved', 'تم إنشاء الصورة');
    } catch (error) {
      const host = document.querySelector('.export-host');
      if (host) host.remove();
      console.error('PNG export failed:', error && error.message ? error.message : 'unknown error');
      showToast('تعذّر إنشاء صورة PNG. جرّب تحديث الصفحة ثم أعد المحاولة.', { type: 'error', duration: 7000 });
    } finally {
      state.busy = false;
      dom.btnExport.disabled = false;
      setBusy(false);
    }
  }

  async function waitForFonts() {
    if (!document.fonts) return;
    try {
      await document.fonts.ready;
      await Promise.all([
        document.fonts.load('400 12px "Noto Naskh Arabic"'),
        document.fonts.load('600 12px "Noto Naskh Arabic"'),
        document.fonts.load('700 16px "Noto Naskh Arabic"'),
        document.fonts.load('400 14px "Cairo"'),
        document.fonts.load('700 14px "Cairo"')
      ]);
    } catch (error) {
      /* الخط البديل يكفي لاستمرار التصدير. */
    }
  }

  async function preloadSignatureImages() {
    const images = Array.from(dom.a4Page.querySelectorAll('.doc-signature-area img:not([hidden])'));
    await Promise.all(images.map((image) => {
      if (!image.getAttribute('src')) return Promise.resolve();
      if (image.decode) {
        return image.decode().catch(() => {
          return new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          });
        });
      }
      return Promise.resolve();
    }));
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas blob is null'));
      }, 'image/png');
    });
  }

  function buildFilename() {
    const date = state.current.date || toIsoDate(new Date());
    const number = (state.current.formNumber || 'form')
      .trim()
      .replace(/[^\w\u0600-\u06FF-]+/g, '_')
      .slice(0, 36);
    return `Laundry_Form_${date}_${number || 'form'}.png`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 300000);
    return url;
  }

  async function requestNewForm() {
    if (state.hasEdits || hasFormContent()) {
      const confirmed = await openConfirm({
        title: 'بدء نموذج جديد؟',
        message: 'سيتم مسح البيانات الموجودة في النموذج الحالي. المسودات المحفوظة في الأرشيف لن تتأثر.',
        acceptLabel: 'بدء نموذج جديد',
        danger: false
      });
      if (!confirmed) return;
    }

    initNewForm();
    showToast('تم إنشاء نموذج جديد بالتاريخ والوقت الحاليين.', { type: 'success' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    dom.formNumber.focus({ preventScroll: true });
  }

  async function saveDraft(options = {}) {
    if (!state.current) return false;
    syncStateFromDom();
    syncSignaturePadsToState();
    state.current.updatedAt = new Date().toISOString();
    window.clearTimeout(state.autosaveTimer);

    const result = await storage.putForm(state.current);
    if (!result.ok) {
      showToast('تعذّر حفظ المسودة على هذا الجهاز. تحقق من مساحة التخزين.', { type: 'error', duration: 7000 });
      setSaveStatus('error', 'تعذّر حفظ المسودة');
      return false;
    }

    state.hasEdits = false;
    setSaveStatus('saved', `مسودة محفوظة ${formatClock(new Date())}`);
    updateUi();

    if (options.announce !== false) {
      showToast(
        result.mode === 'localstorage'
          ? 'تم حفظ المسودة في التخزين المحلي للجهاز.'
          : 'تم حفظ المسودة على هذا الجهاز.',
        { type: 'success' }
      );
    }
    return true;
  }

  async function openArchive() {
    if (typeof dom.archiveDialog.showModal === 'function') {
      dom.archiveDialog.showModal();
    } else {
      dom.archiveDialog.setAttribute('open', '');
    }
    syncBodyLock();
    await refreshArchive();
  }

  function closeArchive() {
    if (dom.archiveDialog.open) dom.archiveDialog.close();
    else dom.archiveDialog.removeAttribute('open');
    syncBodyLock();
  }

  async function refreshArchive() {
    dom.archiveList.innerHTML = '';
    const loading = document.createElement('div');
    loading.className = 'archive-empty';
    loading.textContent = 'جارٍ تحميل المسودات…';
    dom.archiveList.append(loading);

    let forms = [];
    try {
      forms = await storage.listForms();
    } catch (error) {
      forms = [];
    }

    dom.archiveList.innerHTML = '';
    if (!forms.length) {
      const empty = document.createElement('div');
      empty.className = 'archive-empty';
      empty.innerHTML = `
        <span class="archive-empty-icon" aria-hidden="true">
          <svg class="icon"><use href="#i-archive"></use></svg>
        </span>
        <strong>لا توجد مسودات محفوظة بعد</strong>
        <p>اضغط «حفظ كمسودة» لحفظ النموذج الحالي داخل هذا المتصفح.</p>
      `;
      dom.archiveList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    forms.forEach((form) => {
      const item = document.createElement('article');
      item.className = 'archive-item';
      item.dataset.archiveId = form.id;

      const main = document.createElement('div');
      main.className = 'archive-item-main';
      const number = document.createElement('span');
      number.className = 'archive-number ltr';
      number.textContent = form.formNumber || 'بدون رقم';
      const department = document.createElement('h3');
      department.textContent = form.department || 'بدون قسم';
      const meta = document.createElement('p');
      meta.textContent = `${formatDate(form.date)} • ${form.shift || 'بدون وردية'} • ${formatTimestamp(form.updatedAt)}`;
      main.append(number, department, meta);

      const actions = document.createElement('div');
      actions.className = 'archive-item-actions';
      const openBtn = document.createElement('button');
      openBtn.className = 'btn btn--outline btn--sm';
      openBtn.type = 'button';
      openBtn.dataset.action = 'open';
      openBtn.dataset.id = form.id;
      openBtn.textContent = 'فتح';
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-btn icon-btn--danger';
      deleteBtn.type = 'button';
      deleteBtn.dataset.action = 'delete';
      deleteBtn.dataset.id = form.id;
      deleteBtn.setAttribute('aria-label', `حذف مسودة ${form.formNumber || ''}`);
      deleteBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg>';
      actions.append(openBtn, deleteBtn);

      item.append(main, actions);
      fragment.append(item);
    });
    dom.archiveList.append(fragment);
  }

  async function handleArchiveClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (!id) return;

    if (action === 'open') {
      await openArchivedForm(id);
    } else if (action === 'delete') {
      await deleteArchivedForm(id);
    }
  }

  async function openArchivedForm(id) {
    if (state.hasEdits || (hasFormContent() && state.current.id !== id)) {
      const confirmed = await openConfirm({
        title: 'فتح مسودة أخرى؟',
        message: 'سيتم استبدال محتوى النموذج الحالي بالمسودة التي اخترتها. المسودة الحالية تبقى محفوظة في الأرشيف إن كنت قد حفظتها.',
        acceptLabel: 'فتح المسودة',
        danger: false
      });
      if (!confirmed) return;
    }

    const record = await storage.getForm(id);
    if (!record) {
      showToast('تعذّر العثور على هذه المسودة.', { type: 'error' });
      await refreshArchive();
      return;
    }

    closeArchive();
    await loadState(record);
    showToast('تم فتح المسودة. يمكنك تعديلها أو تصديرها من جديد.', { type: 'success' });
  }

  async function deleteArchivedForm(id) {
    const record = await storage.getForm(id);
    const confirmed = await openConfirm({
      title: 'حذف المسودة؟',
      message: `سيتم حذف المسودة${record && record.formNumber ? ` ${record.formNumber}` : ''} نهائيًا من هذا المتصفح. لا يمكن التراجع.`,
      acceptLabel: 'حذف نهائي',
      danger: true
    });
    if (!confirmed) return;

    const result = await storage.deleteForm(id);
    if (result.ok) {
      showToast('تم حذف المسودة من هذا الجهاز.', { type: 'success' });
      await refreshArchive();
    } else {
      showToast('تعذّر حذف المسودة.', { type: 'error' });
    }
  }

  async function loadState(raw) {
    window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = 0;
    const normalized = normalizeState(raw);
    state.current = normalized;
    applyStateToForm(normalized);
    resetValidation();
    await applySignaturesFromState();
    state.hasEdits = false;
    setSaveStatus('saved', 'تم استئناف المسودة');
    hideRestoreBanner(false);
    storage.saveCurrentDraft(normalized);
    updateUi();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function normalizeState(raw) {
    const now = new Date();
    const fallback = createEmptyState(now, now.getFullYear(), { allocateNumber: false });
    if (!raw || typeof raw !== 'object') {
      fallback.formNumber = storage.nextSerial(now.getFullYear());
      return fallback;
    }
    const items = {};
    cfg.items.forEach((item) => {
      items[item.id] = {};
      cfg.fields.forEach((field) => {
        const value = raw.items && raw.items[item.id] ? raw.items[item.id][field.key] : '';
        items[item.id][field.key] = normalizeFieldValue(value, field.kind);
      });
    });

    const signers = {};
    cfg.signers.forEach((signer) => {
      const source = raw.signers && raw.signers[signer.id] ? raw.signers[signer.id] : {};
      signers[signer.id] = {
        name: normalizeText(source.name, cfg.storage.maxNameLength),
        signature: normalizeSignature(source.signature)
      };
    });

    return {
      schemaVersion: cfg.schemaVersion,
      id: normalizeText(raw.id, 80) || createId(),
      formNumber: normalizeText(raw.formNumber, 28),
      date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : fallback.date,
      time: /^\d{2}:\d{2}$/.test(raw.time) ? raw.time : fallback.time,
      shift: cfg.shifts.includes(raw.shift) ? raw.shift : fallback.shift,
      department: normalizeText(raw.department, 70),
      items,
      signers,
      createdAt: normalizeIsoDate(raw.createdAt) || fallback.createdAt,
      updatedAt: normalizeIsoDate(raw.updatedAt) || now.toISOString()
    };
  }

  function normalizeFieldValue(value, kind) {
    if (value == null) return '';
    const text = toWesternDigits(value);
    if (kind === 'qty') {
      const digits = text.replace(/[^\d]/g, '');
      return digits.slice(0, 4);
    }
    return /^\d{2}:\d{2}$/.test(text) ? text : '';
  }

  function normalizeText(value, maxLength) {
    if (value == null) return '';
    return String(value).trim().slice(0, maxLength);
  }

  function normalizeSignature(value) {
    if (typeof value !== 'string') return null;
    if (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return null;
    if (value.length > 3_500_000) return null;
    return value;
  }

  function normalizeIsoDate(value) {
    if (typeof value !== 'string') return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }

  function showRestoreBanner(draft) {
    state.pendingDraft = draft;
    const savedAt = formatTimestamp(draft.savedAt);
    const formNumber = draft.state && draft.state.formNumber ? draft.state.formNumber : '';
    const department = draft.state && draft.state.department ? draft.state.department : 'بدون قسم';
    dom.restoreMeta.textContent = `${formNumber ? `${formNumber} • ` : ''}${department} • ${savedAt}`;
    dom.restoreBanner.hidden = false;
  }

  function hideRestoreBanner(clearStored) {
    dom.restoreBanner.hidden = true;
    state.pendingDraft = null;
    if (clearStored) storage.clearCurrentDraft();
  }

  async function restoreDraft() {
    const draft = state.pendingDraft || storage.getCurrentDraft();
    if (!draft || !draft.state) {
      showToast('تعذّر استئناف المسودة.', { type: 'error' });
      return;
    }
    await loadState(draft.state);
    showToast('تم استئناف المسودة.', { type: 'success' });
  }

  function setBusy(visible, title, text) {
    if (title) dom.busyTitle.textContent = title;
    if (text) dom.busyText.textContent = text;
    dom.busyOverlay.hidden = !visible;
    document.body.classList.toggle('is-busy', visible);
  }

  function showToast(message, options = {}) {
    const type = options.type || 'success';
    const duration = options.duration == null ? 4400 : options.duration;
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    const symbol = type === 'error' ? 'i-alert' : type === 'info' ? 'i-info' : 'i-check';
    icon.innerHTML = `<svg class="icon"><use href="#${symbol}"></use></svg>`;

    const text = document.createElement('p');
    text.textContent = message;
    toast.append(icon, text);

    if (options.actionLabel && typeof options.onAction === 'function') {
      const action = document.createElement('button');
      action.className = 'toast-action';
      action.type = 'button';
      action.textContent = options.actionLabel;
      action.addEventListener('click', () => {
        options.onAction();
        removeToast(toast);
      });
      toast.append(action);
    }

    const close = document.createElement('button');
    close.className = 'toast-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'إغلاق التنبيه');
    close.innerHTML = '<svg class="icon icon--xs" aria-hidden="true"><use href="#i-x"></use></svg>';
    close.addEventListener('click', () => removeToast(toast));
    toast.append(close);

    dom.toastRegion.append(toast);
    while (dom.toastRegion.children.length > 3) {
      dom.toastRegion.firstElementChild.remove();
    }
    window.requestAnimationFrame(() => toast.classList.add('is-visible'));

    if (duration > 0) {
      window.setTimeout(() => removeToast(toast), duration);
    }
  }

  function removeToast(toast) {
    if (!toast || !toast.isConnected) return;
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 220);
  }

  function openConfirm({ title, message, acceptLabel, danger }) {
    if (typeof dom.confirmDialog.showModal !== 'function') {
      return Promise.resolve(window.confirm(`${title}\n\n${message}`));
    }
    if (dom.confirmDialog.open) {
      return Promise.resolve(false);
    }

    dom.confirmTitle.textContent = title;
    dom.confirmMessage.textContent = message;
    dom.btnConfirmAccept.textContent = acceptLabel || 'تأكيد';
    dom.btnConfirmAccept.className = danger === false ? 'btn btn--primary' : 'btn btn--danger';
    dom.btnConfirmCancel.textContent = 'إلغاء';
    dom.confirmDialog.showModal();
    syncBodyLock();
    window.setTimeout(() => dom.btnConfirmCancel.focus(), 30);

    return new Promise((resolve) => {
      state.confirmResolver = resolve;
    });
  }

  function settleConfirm(value) {
    const resolver = state.confirmResolver;
    state.confirmResolver = null;
    if (dom.confirmDialog.open) dom.confirmDialog.close();
    syncBodyLock();
    if (resolver) resolver(value);
  }

  function syncBodyLock() {
    document.body.classList.toggle('dialog-open', Boolean(document.querySelector('dialog[open]')));
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function nextFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  function toIsoDate(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function toIsoTime(date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function shiftForDate(date) {
    const hour = date.getHours();
    if (hour >= 7 && hour < 15) return 'صباحية';
    if (hour >= 15 && hour < 23) return 'مسائية';
    return 'ليلية';
  }

  function formatDate(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
    const [year, month, day] = value.split('-');
    return `${day} / ${month} / ${year}`;
  }

  function formatClock(date) {
    return new Intl.DateTimeFormat('ar-LY-u-nu-latn', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  function formatTimestamp(value) {
    if (!value) return 'وقت غير معروف';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'وقت غير معروف';
    try {
      return new Intl.DateTimeFormat('ar-LY-u-nu-latn', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }).format(date);
    } catch (error) {
      return date.toLocaleString();
    }
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `form-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }
})();
