/*
 * الإعدادات الثابتة للنموذج.
 * أسماء المفروشات وأسماء الأطراف معرفة هنا فقط، ولا يمكن تعديلها من واجهة الاستخدام.
 * لتغيير هوية المستشفى أو الأقسام المقترحة، عدّل هذا الملف مباشرة.
 */
(function () {
  'use strict';

  const items = [
    { id: 'bed_sheet', name: 'ملاية سرير', hint: '(أنصوله)' },
    { id: 'mattress_cover', name: 'غطاء مرتبة', hint: '(ستيك)' },
    { id: 'pillow_case', name: 'وسادة كيس وسادة', hint: '' },
    { id: 'towel', name: 'منشفة', hint: '' },
    { id: 'blanket', name: 'بطانية', hint: '' },
    { id: 'duvet_cover', name: 'كوبيرطة / لحاف', hint: '' },
    { id: 'gown', name: 'جاون', hint: '' },
    { id: 'other', name: 'مفروشات أخرى', hint: '' }
  ];

  const signers = [
    {
      id: 'first',
      role: 'الطرف الأول',
      description: 'اسم معاون / ممرض القسم',
      inputLabel: 'اسم معاون / ممرض القسم',
      placeholder: 'اكتب اسم معاون / ممرض القسم'
    },
    {
      id: 'intermediary',
      role: 'الوسيط',
      description: 'اسم موظف خدمات الغرف',
      inputLabel: 'اسم موظف خدمات الغرف',
      placeholder: 'اكتب اسم موظف خدمات الغرف'
    },
    {
      id: 'second',
      role: 'الطرف الثاني',
      description: 'اسم الطرف المستلم من المغسلة',
      inputLabel: 'اسم الطرف الثاني المستلم من المغسلة',
      placeholder: 'اكتب اسم الطرف المستلم من المغسلة'
    }
  ];

  window.LAUNDRY_CONFIG = Object.freeze({
    schemaVersion: 1,
    storageKeys: {
      currentDraft: 'laundry.currentDraft.v1',
      serial: 'laundry.serial.v1',
      fallbackArchive: 'laundry.archive.v1',
      draftRestoreDismissed: 'laundry.draftDismissedAt.v1'
    },
    dbName: 'laundry_handover_db',
    dbVersion: 1,
    dbStore: 'forms',
    formPrefix: 'LND',
    hospital: {
      name: 'مستشفى بنغازي التخصصي'
    },
    shifts: ['صباحية', 'مسائية', 'ليلية'],
    departments: [
      'الطوارئ',
      'الباطنة',
      'الجراحة',
      'العناية المركزة',
      'الحميات',
      'الجهاز الهضمي والكبد',
      'الأطفال',
      'النساء والولادة',
      'العمليات',
      'العيادات الخارجية',
      'الأشعة',
      'المختبر'
    ],
    items,
    signers,
    fields: [
      { key: 'dirtyCount', kind: 'qty', group: 'dirty', label: 'العدد' },
      { key: 'dirtyDeptTime', kind: 'time', group: 'dirty', label: 'وقت التسليم من القسم' },
      { key: 'dirtyLaundryTime', kind: 'time', group: 'dirty', label: 'الوقت المستلم بالمغسلة' },
      { key: 'cleanCount', kind: 'qty', group: 'clean', label: 'العدد' },
      { key: 'cleanLaundryTime', kind: 'time', group: 'clean', label: 'وقت التسليم من المغسلة' },
      { key: 'cleanDeptTime', kind: 'time', group: 'clean', label: 'وقت استلام القسم' }
    ],
    storage: {
      autosaveDelay: 650,
      maxQuantity: 9999,
      maxNameLength: 90
    }
  });
})();
