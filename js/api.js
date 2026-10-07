/**
 * js/api.js — عميل الـ API الوحيد
 * -----------------------------------------------------------------------------
 * كل التواصل مع الخادم يمرّ من هنا.
 * لا يوجد أي اتصال بقاعدة البيانات من المتصفح — وهذا هو المبدأ الأمني
 * الأساسي: مفتاح anon الذي كان منشوراً في هذا الملف سابقاً أصبح بلا فائدة،
 * لأن الوصول إلى البيانات يمرّ عبر الخادم الذي يتحقق من الهوية والصلاحيات.
 */

(function (global) {
  'use strict';

  const TOKEN_KEY = 'shifa_token';
  const USER_KEY  = 'shifa_user';
  // حالة العيادة تُحفظ بمفتاح منفصل: هي التي تميّز عيادة بانتظار المراجعة
  // عن عادية مفعّلة. كانت تضيع سابقاً لأن setSession كان يخزّن المستخدم فقط،
  // فيرى الطبيب المعلَّق لوحة فارغة بلا أي تفسير.
  const CLINIC_KEY = 'shifa_clinic';

  const api = {
    baseUrl: '',

    // ---------------------------------------------------------------------
    // إدارة رمز الجلسة
    // ---------------------------------------------------------------------
    getToken() {
      try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
    },

    setSession(token, user, clinic) {
      try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        if (user)  localStorage.setItem(USER_KEY, JSON.stringify(user));
        // عيادة غائبة (nil) تُمسح: تسجيل دخول مريض لا يجب أن يترك
        // عيادة قديمة في التخزين من جلسة سابقة.
        if (clinic !== undefined) {
          if (clinic) localStorage.setItem(CLINIC_KEY, JSON.stringify(clinic));
          else localStorage.removeItem(CLINIC_KEY);
        }
      } catch (e) { /* الوضع الخاص في المتصفح */ }
    },

    getUser() {
      try {
        const raw = localStorage.getItem(USER_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },

    /** حالة عيادة المستخدم الحالي كما عرفها الخادم آخر مرة */
    getClinic() {
      try {
        const raw = localStorage.getItem(CLINIC_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },

    clearSession() {
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(CLINIC_KEY);
      } catch (e) { /* تجاهل */ }
    },

    isAuthenticated() {
      return Boolean(this.getToken());
    },

    // ---------------------------------------------------------------------
    // طلب HTTP أساسي
    // ---------------------------------------------------------------------
    async request(method, path, body, options = {}) {
      const url = (this.baseUrl || '') + path;
      const headers = { Accept: 'application/json' };

      const token = this.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      let payload;
      if (body !== undefined && body !== null) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }

      let response;
      try {
        response = await fetch(url, { method, headers, body: payload });
      } catch (networkErr) {
        throw new ApiError(
          'تعذّر الاتصال بالخادم. تحقّق من اتصالك بالإنترنت.',
          0,
          'network_error'
        );
      }

      // 204 = لا محتوى
      if (response.status === 204) return null;

      let data = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try { data = await response.json(); }
        catch (e) { data = null; }
      }

      if (!response.ok) {
        // انتهاء الجلسة: نمسحها ونعيد تحميل الصفحة لعرض شاشة الدخول
        if (response.status === 401 && !options.skipSessionClear) {
          const isAuthPath = path.startsWith('/api/auth/login') || path.startsWith('/api/auth/signup');
          if (!isAuthPath) {
            this.clearSession();
            document.dispatchEvent(new CustomEvent('shifa:session-expired'));
          }
        }
        throw new ApiError(
          (data && data.message) || `حدث خطأ (${response.status})`,
          response.status,
          (data && data.error) || 'unknown',
          data && data.details
        );
      }

      return data;
    },

    get(path, options)          { return this.request('GET', path, null, options); },
    post(path, body, options)   { return this.request('POST', path, body || {}, options); },
    patch(path, body, options)  { return this.request('PATCH', path, body || {}, options); },
    put(path, body, options)    { return this.request('PUT', path, body || {}, options); },
    del(path, options)          { return this.request('DELETE', path, null, options); },

    // ---------------------------------------------------------------------
    // المصادقة
    // ---------------------------------------------------------------------
    async signup(data)        { return this.post('/api/auth/signup', data); },
    async login(data)         { return this.post('/api/auth/login', data); },
    me()                      { return this.get('/api/auth/me'); },
    updateProfile(data)       { return this.patch('/api/auth/me', data); },
    changePassword(oldPw, newPw) {
      return this.post('/api/auth/change-password', {
        currentPassword: oldPw, newPassword: newPw,
      });
    },

    // ---------------------------------------------------------------------
    // الأطباء
    // ---------------------------------------------------------------------
    listDoctors(filters = {}) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null && v !== '' && v !== 'all') qs.set(k, v);
      }
      const query = qs.toString();
      return this.get('/api/doctors' + (query ? `?${query}` : ''));
    },
    doctorMeta()               { return this.get('/api/doctors/meta'); },
    getDoctor(id)              { return this.get(`/api/doctors/${encodeURIComponent(id)}`); },
    availability(id, date, leadMinutes) {
      const qs = new URLSearchParams({ date });
      if (leadMinutes) qs.set('leadMinutes', String(leadMinutes));
      return this.get(`/api/doctors/${encodeURIComponent(id)}/availability?${qs}`);
    },
    doctorDays(id)             { return this.get(`/api/doctors/${encodeURIComponent(id)}/days`); },

    // ---------------------------------------------------------------------
    // المواعيد
    // ---------------------------------------------------------------------
    book(data)                 { return this.post('/api/appointments', data); },
    myAppointments(params = {}) {
      const qs = new URLSearchParams(params).toString();
      return this.get('/api/appointments' + (qs ? `?${qs}` : ''));
    },
    appointment(id)            { return this.get(`/api/appointments/${encodeURIComponent(id)}`); },
    setAppointmentStatus(id, status) {
      return this.patch(`/api/appointments/${encodeURIComponent(id)}/status`, { status });
    },

    // ---------------------------------------------------------------------
    // الطابور (شاشة العيادة)
    // ---------------------------------------------------------------------
    queue(params = {}) {
      const qs = new URLSearchParams(params).toString();
      return this.get('/api/queue' + (qs ? `?${qs}` : ''));
    },
    queueScreen(doctorId, date) {
      const qs = new URLSearchParams({ doctorId });
      if (date) qs.set('date', date);
      return this.get(`/api/queue/screen?${qs}`);
    },
    callNext(date) {
      const qs = date ? `?date=${encodeURIComponent(date)}` : '';
      return this.post(`/api/queue/call-next${qs}`);
    },
    callPatient(id)            { return this.post(`/api/queue/call/${encodeURIComponent(id)}`); },
    completeVisit(id)          { return this.post(`/api/queue/complete/${encodeURIComponent(id)}`); },
    walkIn(data, date) {
      const qs = date ? `?date=${encodeURIComponent(date)}` : '';
      return this.post(`/api/queue/walk-in${qs}`, data);
    },
    cancelFromClinic(id)       { return this.del(`/api/queue/${encodeURIComponent(id)}`); },

    // ---------------------------------------------------------------------
    // ملف العيادة
    // ---------------------------------------------------------------------
    /** تحديث ملف العيادة — الخادم يحُدّث الأحوال ويعيد مسمّيات القاعدة */
    updateClinic(payload)      { return this.put('/api/doctors/me', payload); },
    toggleBookingStatus(accepting) { return this.put('/api/doctors/me', { accepting_bookings: Boolean(accepting) }); },

    // ---------------------------------------------------------------------
    // الإشعارات والـ WhatsApp
    // ---------------------------------------------------------------------
    getWhatsAppLink(appointmentId, customMessage) {
      return this.post('/api/notifications/whatsapp-link', { appointmentId, customMessage });
    },
    listNotifications(params = {}) {
      const qs = new URLSearchParams(params).toString();
      return this.get('/api/notifications' + (qs ? `?${qs}` : ''));
    },
    processNotificationsQueue(limit = 20) {
      return this.post('/api/notifications/process', { limit });
    },

    // ---------------------------------------------------------------------
    // مدفوعات Chargily Pay v2 (البطاقة الذهبية / CIB)
    // ---------------------------------------------------------------------
    createPaymentCheckout(data) {
      return this.post('/api/payments/checkout', data);
    },
    confirmDemoPayment(checkoutId) {
      return this.post('/api/payments/confirm-demo', { checkoutId });
    },
        getPaymentHistory() {
      return this.get('/api/payments/history');
    },
    getAdminAnalytics() {
      return this.get('/api/admin/analytics');
    },
    approveClinicAdmin(id) {
      return this.post('/api/admin/clinics/' + encodeURIComponent(id) + '/approve', {});
    },
    getPatientMedicalHistory(identifier) {
      return this.get('/api/medical-records/patient/' + encodeURIComponent(identifier));
    },
    saveMedicalRecord(data) {
      return this.post('/api/medical-records', data);
    },
    getPatientPortal() {
      return this.get('/api/patient/portal');
    },
    updateClinicProfile(data) {
      return this.put('/api/doctors/me', data);
    },
    cancelPatientAppointment(appointmentId) {
      return this.post('/api/patient/cancel-appointment', { appointmentId });
    },
  };

  // =========================================================================
  // خطأ الـ API — يحمل الرسالة العربية الجاهزة للعرض
  // =========================================================================
  function ApiError(message, status, code, details) {
    const err = new Error(message);
    err.name = 'ApiError';
    err.status = status;
    err.code = code;
    err.details = details;
    return err;
  }
  api.ApiError = ApiError;

  // -------------------------------------------------------------------------
  // تهريب النصوص — الإصلاح الأساسي لثغرة XSS
  // -------------------------------------------------------------------------
  /**
   * أي قيمة قادمة من قاعدة البيانات تُمرّ عبر هذه الدالة قبل إدراجها في
   * innerHTML. بدونها، إدخال "<img src=x onerror=...>" كاسم مريض يعني
   * تنفيذ كود داخل جهاز الطبيب.
   */
  api.escape = function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // -------------------------------------------------------------------------
  // تطبيع صفوف المواعيد
  // -------------------------------------------------------------------------
  /**
   * الخادم يُرجع حقولاً بصيغة snake_case (لغة قاعدة البيانات).
   * الواجهة بُنيت أصلاً على camelCase بالعربية، فنُطبّعها هنا مرة واحدة
   * بدل أن نمرّر عشرات التعديلات عبر كل دالة عرض.
   *
   * الحالة تُترجم من الإنجليزية (canonical) إلى العربية كما تعرضها الواجهة،
   * لأن مقارنات الواجهة القديمة تستخدم النص العربي مباشرة
   * (مثلاً: apt.status === 'مكتمل').
   */
  const STATUS_AR = {
    confirmed: 'مؤكد',
    waiting: 'في قاعة الانتظار',
    in_consultation: 'عند الطبيب',
    completed: 'مكتمل',
    cancelled: 'ملغى',
    no_show: 'لم يحضر',
  };

  api.normalizeAppointment = function normalizeAppointment(row) {
    if (!row) return null;
    return {
      id: row.id,
      doctorId: row.doctor_id,
      doctorName: row.doctor_name,
      doctorTitle: row.doctor_title,
      specialtyName: row.specialty_name,
      clinicAddress: row.clinic_address,
      communeName: row.commune_name,
      communeId: row.commune_id,
      lat: row.lat,
      lng: row.lng,
      patientId: row.patient_id,
      patientName: row.patient_name,
      patientPhone: row.patient_phone,
      date: row.appt_date || row.date,
      time: row.appt_time || row.time,
      status: STATUS_AR[row.status] || row.status,
      statusKey: row.status,
      queueNumber: row.queue_number,
      hasChifa: row.has_chifa ?? true,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  };

  api.normalizeAppointments = function normalizeAppointments(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(api.normalizeAppointment);
  };

// -------------------------------------------------------------------------
  // تطبيع صفوف الأطباء
  // -------------------------------------------------------------------------
  /**
   * الخادم يُرجع الحقول بصيغة قاعدة البيانات (specialty_id, has_chifa...).
   * الواجهة بُنيت على camelCase (specialty, acceptsChifaCard...) وتقرأ أيضاً
   * حقولاً لم تُخزَّن أصلاً في القاعدة (الصورة، الشارة، المعالم القريبة).
   *
   * نُطبّع هنا مرة واحدة: نطابق الأسماء، ونستنتج ما يمكن استنتاجه
   * (مثل تحويل work_hours "08:00 - 16:30" إلى قائمة أوقات).
   *
   * الحقول غير الموجودة في القاعدة تُشتق من البيانات الفعلية، ولا تُخترع:
   * الصورة تُبنى من الأحرف الأولى للاسم، والشارة من التقييم.
   */
  const AVATAR_TINTS = [
    '#0e9f6e', '#0284c7', '#7c3aed', '#d97706', '#db2777', '#0891b2',
  ];

  /** صورة رمزية من الأحرف الأولى — بدون طلب خارجي ولا بيانات شخصية */
  function initialsAvatar(name, tint) {
    const initials = String(name || '؟')
      .replace(/^(د\.|مخبر|مركز|عيادة)\s*/gi, '')                 // إزالة "د."
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('');
    const ch = Math.abs(String(name).split('').reduce((a, c) => a + c.charCodeAt(0), 0));
    const bg = tint || AVATAR_TINTS[ch % AVATAR_TINTS.length];
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">` +
      `<rect width="120" height="120" fill="${bg}"/>` +
      `<text x="60" y="60" dy=".35em" text-anchor="middle" ` +
      `font-family="system-ui,sans-serif" font-size="44" font-weight="700" ` +
      `fill="#ffffff">${initials}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /**
   * تحويل "08:00 - 16:30 (السبت - الخميس)" إلى { start, end, days }
   * الخانات الفعلية تُجلب من الخادم عبر availability() — هنا نوفّر
   * عرضاً مبسّطاً للبطاقة فقط، ومن المصدر نفسه لا من قيم ثابتة.
   */
  function parseWorkHours(raw) {
    const text = String(raw || '').trim();
    const times = text.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    const days = text.match(/([\u0600-\u06FF]+(?:\s*-\s*[\u0600-\u06FF]+)?)\s*$/);

    return {
      start: times ? `${times[1].padStart(2, '0')}:${times[2]}` : '08:00',
      end: times ? `${times[3].padStart(2, '0')}:${times[4]}` : '16:30',
      days: days ? days[1].trim() : 'السبت - الخميس',
    };
  }

  /** شارة العرض مشتقّة من التقييم الفعلي، لا من نص جاهز */
  function badgeFor(rating, reviews) {
    if (rating >= 4.8 && reviews >= 50) return 'طبيب متميز';
    if (rating >= 4.5) return 'موثوق';
    return 'عيادة مسجلة';
  }

  api.normalizeDoctor = function normalizeDoctor(row) {
    if (!row) return null;

    const rating = Number(row.rating) || 0;
    const reviews = Number(row.reviews_count ?? row.reviewsCount) || 0;
    const hours = parseWorkHours(row.work_hours || row.workHours);

    return {
      id: row.id,
      name: row.name,
      title: row.title,
      specialty: row.specialty_id ?? row.specialty,
      specialtyName: (row.specialty_name ?? row.specialtyName) || '',
      commune: row.commune_id ?? row.commune,
      communeName: (row.commune_name ?? row.communeName) || '',
      address: row.address || '',
      nearLandmark: (row.near_landmark ?? row.nearLandmark) || row.address || '',
      phone: row.phone || '',
      price: Number(row.price) || 0,
      rating,
      reviewsCount: reviews,
      reviews,
      experience: row.experience || '',
      workHours: (row.work_hours ?? row.workHours) || '',
      availableDays: (row.available_days ?? row.availableDays) || hours.days,
      slotMinutes: Number(row.slot_minutes ?? row.slotMinutes) || 30,
      lat: Number(row.lat) || 0,
      lng: Number(row.lng) || 0,
      hasChifa: Boolean(row.has_chifa ?? row.hasChifa),
      acceptsChifaCard: Boolean(row.has_chifa ?? row.hasChifa),
      // بيانات تجريبية (بذر) — الواجهة ملزمة بإعلان ذلك صراحةً
      isDemo: Boolean(row.is_demo ?? row.isDemo),
      badge: badgeFor(rating, reviews),
      image: initialsAvatar(row.name),
      // الخانات تُملأ لاحقاً من availability() — لا نخترع أوقات هنا
      availableSlots: Array.isArray(row.availableSlots) ? row.availableSlots : [],
      availableToday: Boolean(row.availableToday),
    };
  };

  api.normalizeDoctors = function normalizeDoctors(rows) {
    return Array.isArray(rows) ? rows.map(api.normalizeDoctor).filter(Boolean) : [];
  };

  api.initialsAvatar = initialsAvatar;

  // -------------------------------------------------------------------------
  // لوحة الإدارة واعتماد العيادات
  // -------------------------------------------------------------------------
  api.getAdminAnalytics = async function getAdminAnalytics() {
    return this.request('GET', '/api/admin/analytics');
  };

  api.approveClinic = async function approveClinic(doctorId) {
    return this.request('POST', `/api/admin/clinics/${encodeURIComponent(doctorId)}/approve`);
  };

  global.api = api;
})(window);
