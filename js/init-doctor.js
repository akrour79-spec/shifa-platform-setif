/**
 * Shifa Platform — init-doctor.js
 * ----------------------------------------------------------------------------
 * تهيئة واجهة الطبيب (doctor.html): لوحة التحكم، إدارة المواعيد والطابور،
 * الوصفات، الإحصائيات — بدون أي كود خاص بحجز المريض.
 */

const UI_ACTIONS = Object.freeze({
    openAuthModal,
    closeAuthModal,
    openCheckoutModal,
    closeCheckoutModal,
    toggleBillingCycle,
    submitSubscriptionOrder,
    switchAuthTab,
    handleAuthRoleChange,
    togglePasswordVisibility,
    quickDemoLogin,
    showForgotPassword,
    toggleTheme,
    toggleLang,
    openWalkinModal,
    closeWalkinModal,
    openClinicSettings,
    closeClinicSettings,
    toggleClinicTVMode,
    callNextPatientWithSpeech,
    repeatCurrentCallout,
    playQueueChime,
    openPrescriptionModal,
    closePrescriptionModal,
    addMedicationRow,
    removeMedicationRow,
    printPrescription,
    sendPrescriptionWhatsApp,
    openPatientHistoryModal,
    closePatientHistoryModal,
    openAdminAnalyticsModal,
    closeAdminAnalyticsModal,
    refreshAdminAnalytics,
    approveClinicDirect,
    installPWA,
    dismissPWABanner,
    print,
    // إصلاح 2026-10-09: زر إيقاف/استئناف الحجوزات في لوحة الطبيب كان
    // غير مسجَّل — الدالة موجودة في js/dashboard.js.
    toggleBookingStatus,
});
const FORM_ACTIONS = Object.freeze({
    handleLoginSubmit: (...args) => handleLoginSubmit(...args),
    handleSignupSubmit: (...args) => handleSignupSubmit(...args),
    handleClinicSettingsSubmit: (...args) => handleClinicSettingsSubmit(...args),
    handleWalkinSubmit: (...args) => handleWalkinSubmit(...args),
    handleUpdateProfile: (...args) => handleUpdateProfile(...args),
});

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initUiDelegation();
    initAuth();
    initNavigation();
    renderQueue();
    renderDoctorDashboard();
    startConnectionStatusPolling();
    initScrollReveal();
    renderSubscriptions();
    renderPricingCards();

    // حالة العيادة (مفعّلة أم بانتظار المراجعة) تتغيّر في الخادم
    await refreshClinicState();

    refreshAppointments();
});
