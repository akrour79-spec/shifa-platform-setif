/**
 * Shifa Platform — init.js
 * ----------------------------------------------------------------------------
 * مقسّم من js/app.js إلى وحدات حسب الميزة (سكربتات كلاسيكية، نطاق عام مشترك).
 * يُحمَّل بالترتيب المذكور في index.html — لا تغيّر الترتيب.
 */

// ---------------------------------------------------------------------------
 // تفويض الأحداث للعناصر الساكنة في index.html
// ---------------------------------------------------------------------------
/**
 * كان index.html يحمل 42 معالجاً مضمّناً (onclick / onsubmit / onchange).
 * كلها كانت ميتة: سياسة CSP تضع `script-src-attr 'none'`، وهو ما يمنع
 * معالجات السمات حتى مع `'unsafe-inline'` في script-src. النتيجة أن أزرار
 * الإغلاق وفلاتر التخصص والنماذج كلها لا تفعل شيئاً — والنماذج تُرسل
 * الصفحة إلى `/?` فتضيع بيانات المريض.
 *
 * الحل: مفوّض أحداث واحد على مستوى المستند. كل زر يحمل `data-ui="اسم"`،
 * ويمرّر المفوّض الاسم إلى دالة من قائمة بيضاء — لا ننفّذ نص HTML كجافاسكربت
 * أبداً، وهذا يزيل مسار حقن عبر السمات نهائياً.
 *
 * ملاحظة: لا نستخدم `data-action` هنا لأن الجداول الديناميكية (الطابور
 * ولوحة الطبيب) تستعمله أصلاً بأسماء مختلفة.
 */
const UI_ACTIONS = Object.freeze({
    openAuthModal,
    closeAuthModal,
    openCheckoutModal,
    closeCheckoutModal,
    toggleBillingCycle,
    submitSubscriptionOrder,
    closeBookingModal,
    closeTicketModal,
    closeWalkinModal,
    closeClinicSettings,
    closeProfileModal,
    openWalkinModal,
    openClinicSettings,
    toggleClinicTVMode,
    callNextPatientWithSpeech,
    repeatCurrentCallout,
    filterBySpecialtyPill,
    switchAuthTab,
    handleAuthRoleChange,
    togglePasswordVisibility,
    quickDemoLogin,
    showForgotPassword,
    loadDoctors,
    toggleTheme,
    openEmergencyModal,
    playQueueChime,
    openPrescriptionModal,
    closePrescriptionModal,
    addMedicationRow,
    removeMedicationRow,
    printPrescription,
    sendPrescriptionWhatsApp,
    closeEmergencyModal,
    filterEmergencyList,

    openBookingModalFromCard: (doctorId) => openBookingModal(doctorId),
    toggleBookingStatus,
    installPWA,
    dismissPWABanner,
    print,
    refreshAdminAnalytics,
    approveClinicDirect,
    openAdminAnalyticsModal,
    closeAdminAnalyticsModal,
    closePatientHistoryModal,
    openPatientHistoryModal,
    handleDoctorSortChange,
    loadPatientPortal,
    cancelAppointmentFromPortal: (arg) => cancelAppointmentFromPortal(arg),
});
const FORM_ACTIONS = Object.freeze({
    submitBooking: (...args) => submitBooking(...args),
    handleLoginSubmit: (...args) => handleLoginSubmit(...args),
    handleSignupSubmit: (...args) => handleSignupSubmit(...args),
    handleClinicSettingsSubmit: (...args) => handleClinicSettingsSubmit(...args),
    handleWalkinSubmit: (...args) => handleWalkinSubmit(...args),
    handleUpdateProfile: (...args) => handleUpdateProfile(...args),
});
// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initUiDelegation();
    initAuth();
    initNavigation();
    initFilters();
    renderStats();
    initMap();
    renderQueue();
    renderDoctorDashboard();
    startConnectionStatusPolling();
    renderSubscriptions();
    renderPricingCards();

    // قائمة الأطباء تأتي من الخادم — الواجهة ترسم بعد وصوله
    try {
        await loadDoctors();
        loadSlotsForDoctors();
    } catch (e) { /* renderDoctorsError عرض التفاصيل */ }

    // حالة العيادة (مفعّلة أم بانتظار المراجعة) تتغيّر في الخادم عبر أداة
    // التفعيل، لا في المتصفح. فقيمة localStorage قد تكون قديمة، فنسأل
    // الخادم عند كل إقلاع بدل الاعتماد على ما حُفظ آخر مرة.
    await refreshClinicState();

    refreshAppointments();
});
