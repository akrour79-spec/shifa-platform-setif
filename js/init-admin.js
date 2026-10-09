/**
 * Shifa Platform — init-admin.js
 * ----------------------------------------------------------------------------
 * تهيئة صفحة الإدارة المستقلة (admin.html): لوحة تحكم مالك المنصة.
 * تحليلات المنصة، اعتماد العيادات، توزيع البلديات والتخصصات — بدون أي كود
 * خاص بالمريض أو الطبيب.
 */

function logoutAdmin() {
    if (typeof handleLogout === 'function') handleLogout();
    updateAdminGate();
}

/**
 * بوابة الإدارة: تُظهر المحتوى للمشرف فقط، ورسالة الدخول لغير المسجلين.
 * تُستدعى بعد initAuth() وعند كل تغيّر في حالة المصادقة.
 */
function updateAdminGate() {
    const isAdmin = !!(state.currentUser && state.currentUser.role === 'admin');
    const gate = document.getElementById('admin-gate');
    const content = document.getElementById('admin-content');
    const loginBtn = document.getElementById('admin-login-btn');
    const logoutBtn = document.getElementById('admin-logout-btn');
    const badge = document.getElementById('admin-role-badge');

    if (gate) gate.style.display = isAdmin ? 'none' : 'block';
    if (content) content.style.display = isAdmin ? 'block' : 'none';
    if (loginBtn) loginBtn.style.display = isAdmin ? 'none' : 'inline-flex';
    if (logoutBtn) logoutBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    if (badge) badge.style.display = isAdmin ? 'inline-block' : 'none';

    if (isAdmin && typeof loadAdminAnalytics === 'function') {
        loadAdminAnalytics();
    }
}

const UI_ACTIONS = Object.freeze({
    openAuthModal,
    closeAuthModal,
    togglePasswordVisibility,
    quickDemoLogin,
    handleAuthRoleChange,
    toggleTheme,
    refreshAdminAnalytics,
    approveClinicDirect,
    logoutAdmin,
    installPWA,
    dismissPWABanner,
});
const FORM_ACTIONS = Object.freeze({
    handleLoginSubmit: (...args) => handleLoginSubmit(...args),
});

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initUiDelegation();
    initAuth();

    // استعادة الجلسة المحفوظة (إن وجدت) ثم تحديث البوابة
    if (typeof api !== 'undefined' && typeof api.getUser === 'function') {
        try {
            const savedUser = api.getUser();
            if (savedUser && typeof state !== 'undefined') state.currentUser = savedUser;
        } catch (e) { /* تجاهل */ }
    }
    // ربط تحديث البوابة بتغيّرات المصادقة
    if (typeof updateUserUI === 'function') {
        const _origUpdateUserUI = updateUserUI;
        updateUserUI = function () {
            _origUpdateUserUI();
            updateAdminGate();
        };
    }
    updateAdminGate();
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
});
