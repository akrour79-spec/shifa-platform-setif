/**
 * Shifa Platform — init-patient.js
 * ----------------------------------------------------------------------------
 * تهيئة واجهة المريض (patient.html): البحث عن الأطباء، الحجز، الخريطة،
 * شاشة الانتظار، والملف الصحي — بدون أي كود خاص بالطبيب.
 */

const UI_ACTIONS = Object.freeze({
    openAuthModal,
    closeAuthModal,
    openBookingModalFromCard: (doctorId) => openBookingModal(doctorId),
    closeBookingModal,
    closeTicketModal,
    filterBySpecialtyPill,
    switchAuthTab,
    handleDoctorSortChange,
    handleAuthRoleChange,
    togglePasswordVisibility,
    quickDemoLogin,
    showForgotPassword,
    loadDoctors,
    toggleTheme,
    openEmergencyModal,
    closeEmergencyModal,
    filterEmergencyList,
    playQueueChime,
    installPWA,
    dismissPWABanner,
    loadPatientPortal,
    cancelAppointmentFromPortal: (arg) => cancelAppointmentFromPortal(arg),
});
const FORM_ACTIONS = Object.freeze({
    submitBooking: (...args) => submitBooking(...args),
    handleLoginSubmit: (...args) => handleLoginSubmit(...args),
    handleSignupSubmit: (...args) => handleSignupSubmit(...args),
    handleUpdateProfile: (...args) => handleUpdateProfile(...args),
});

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initUiDelegation();
    initAuth();
    initNavigation();
    initFilters();
    renderStats();
    initMap();
    renderQueue();
    initScrollReveal();

    try {
        await loadDoctors();
        loadSlotsForDoctors();
    } catch (e) { /* renderDoctorsError عرض التفاصيل */ }

    refreshAppointments();
});
