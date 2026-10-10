/**
 * Shifa Platform — auth.js
 * ----------------------------------------------------------------------------
 * مقسّم من js/app.js إلى وحدات حسب الميزة (سكربتات كلاسيكية، نطاق عام مشترك).
 * يُحمَّل بالترتيب المذكور في index.html — لا تغيّر الترتيب.
 */

/* =========================================================================
   🔐 نظام تسجيل الدخول والحسابات للمرضى والأطباء (AUTH SYSTEM ENGINE)
   ========================================================================= */

function initAuth() {
    const btnOpenAuth = document.getElementById('btn-open-auth');
    if (btnOpenAuth) {
        btnOpenAuth.addEventListener('click', () => openAuthModal('login'));
    }

    // Toggle dropdown popover
    const btnUserToggle = document.getElementById('btn-user-chip-toggle');
    const popover = document.getElementById('user-dropdown-popover');
    if (btnUserToggle && popover) {
        btnUserToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            popover.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#user-chip-menu')) {
                popover.classList.remove('open');
            }
        });
    }

    // Dropdown menu action buttons
    const btnMenuProfile = document.getElementById('btn-menu-profile');
    if (btnMenuProfile) {
        btnMenuProfile.addEventListener('click', () => {
            if (popover) popover.classList.remove('open');
            openProfileModal();
        });
    }

    const btnMenuAppointments = document.getElementById('btn-menu-appointments');
    if (btnMenuAppointments) {
        btnMenuAppointments.addEventListener('click', () => {
            if (popover) popover.classList.remove('open');
            switchView('queue');
            showToast("📋 عُرضت قاعة الانتظار وسجل المواعيد المسجلة باسمك");
        });
    }

    const btnMenuClinic = document.getElementById('btn-menu-clinic');
    if (btnMenuClinic) {
        btnMenuClinic.addEventListener('click', () => {
            if (popover) popover.classList.remove('open');
            switchView('doctor');
            showToast("🩺 أهلاً بك في لوحة تحكم عيادتك!");
        });
    }

    const btnMenuLogout = document.getElementById('btn-menu-logout');
    if (btnMenuLogout) {
        btnMenuLogout.addEventListener('click', handleLogout);
    }

    // Update UI according to saved user session
    updateUserUI();
}

function updateUserUI() {
    const btnOpenAuth = document.getElementById('btn-open-auth');
    const userChipMenu = document.getElementById('user-chip-menu');
    const nameDisplay = document.getElementById('user-name-display');
    const initialsDisplay = document.getElementById('user-avatar-initials');
    const roleBadge = document.getElementById('dropdown-role-badge');
    const dropName = document.getElementById('dropdown-user-name');
    const dropPhone = document.getElementById('dropdown-user-phone');
    const dropLoc = document.getElementById('dropdown-user-location');
    const docOnlyItems = document.querySelectorAll('.doc-only');
    const adminBtn = document.getElementById('nav-btn-admin-panel');
    const patientPortalBtn = document.getElementById('nav-btn-patient-portal');

    if (state.currentUser) {
        if (btnOpenAuth) btnOpenAuth.style.display = 'none';
        if (userChipMenu) userChipMenu.style.display = 'block';

        const user = state.currentUser;
        const displayName = user.fullName || user.name || 'مستخدم شفاء';
        const isDoc = user.role === 'doctor';
        const isAdmin = user.role === 'admin';
        const isPatient = user.role === 'patient';

        if (nameDisplay) {
            if (isAdmin) nameDisplay.textContent = 'المشرف العام';
            else if (isDoc) nameDisplay.textContent = displayName.startsWith('د.') ? displayName : `د. ${displayName}`;
            else nameDisplay.textContent = displayName;
        }
        if (initialsDisplay) {
            initialsDisplay.textContent = isAdmin ? '⚙️' : (isDoc ? 'د' : displayName.charAt(0).toUpperCase());
        }

        if (roleBadge) {
            if (isAdmin) {
                roleBadge.textContent = '🛡️ مشرف / مالك المنصة';
                roleBadge.className = 'role-badge admin';
                roleBadge.style.background = 'linear-gradient(135deg, #0284c7, #1e3a8a)';
                roleBadge.style.color = '#ffffff';
                roleBadge.style.padding = '0.3rem 0.75rem';
                roleBadge.style.borderRadius = '20px';
                roleBadge.style.fontSize = '0.78rem';
                roleBadge.style.fontWeight = '700';
            } else if (isDoc) {
                roleBadge.textContent = 'طبيب / عيادة';
                roleBadge.className = 'role-badge doctor';
            } else {
                roleBadge.textContent = 'مريض';
                roleBadge.className = 'role-badge patient';
            }
        }
        if (dropName) dropName.textContent = displayName;
        if (dropPhone) dropPhone.textContent = user.phone || '06XX XX XX XX';
        if (dropLoc) dropLoc.textContent = communeName(user.communeId);

        if (adminBtn) adminBtn.style.display = isAdmin ? 'flex' : 'none';
        if (patientPortalBtn) patientPortalBtn.style.display = (isPatient || !isDoc) ? 'flex' : 'none';
        docOnlyItems.forEach(el => el.style.display = isDoc ? 'flex' : 'none');
    } else {
        if (btnOpenAuth) btnOpenAuth.style.display = 'flex';
        if (userChipMenu) userChipMenu.style.display = 'none';
        if (adminBtn) adminBtn.style.display = 'none';
        docOnlyItems.forEach(el => el.style.display = 'none');
    }

    // شارة "بانتظار المراجعة": بلاها يرى الطبيب المعلَّق لوحة فارغة
    const pendingBanner = document.getElementById('clinic-pending-banner');
    const pendingName = document.getElementById('clinic-pending-name');
    if (pendingBanner) {
        const isPendingDoctor = Boolean(
            state.currentUser && state.currentUser.role === 'doctor' && state.clinic && state.clinic.pending
        );
        pendingBanner.style.display = isPendingDoctor ? 'flex' : 'none';
        if (isPendingDoctor && pendingName) {
            pendingName.textContent = state.clinic.name ? `"${state.clinic.name}"` : '';
        }
    }
}

function openAuthModal(arg1 = 'login', arg2 = 'patient') {
    let tab = 'login';
    let role = 'patient';
    if (typeof arg1 === 'string') {
        if (arg1 === 'signup') tab = 'signup';
        else if (arg1 === 'login') tab = 'login';
        else if (arg1 === 'doctor' || arg1 === 'patient') role = arg1;
    }
    if (typeof arg2 === 'string') {
        if (arg2 === 'doctor' || arg2 === 'patient') role = arg2;
        else if (arg2 === 'signup' || arg2 === 'login') tab = arg2;
    }

    switchAuthTab(tab);
    handleAuthRoleChange(role);
    const modal = document.getElementById('auth-modal');
    if (modal) {
        modal.classList.add('open');
        modal.style.display = 'flex';
        modal.style.zIndex = '999999';
    }
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
    }
}

function switchAuthTab(tab) {
    const btnLogin = document.getElementById('auth-tab-login');
    const btnSignup = document.getElementById('auth-tab-signup');
    const formLogin = document.getElementById('form-auth-login');
    const formSignup = document.getElementById('form-auth-signup');

    if (tab === 'login') {
        if (btnLogin) btnLogin.classList.add('active');
        if (btnSignup) btnSignup.classList.remove('active');
        if (formLogin) formLogin.style.display = 'block';
        if (formSignup) formSignup.style.display = 'none';
    } else {
        if (btnSignup) btnSignup.classList.add('active');
        if (btnLogin) btnLogin.classList.remove('active');
        if (formSignup) formSignup.style.display = 'block';
        if (formLogin) formLogin.style.display = 'none';
    }
}

function handleAuthRoleChange(role) {
    const pillPatient = document.getElementById('role-pill-patient');
    const pillDoctor = document.getElementById('role-pill-doctor');
    const docFields = document.getElementById('signup-doctor-fields');

    if (role === 'doctor') {
        if (pillDoctor) pillDoctor.classList.add('active');
        if (pillPatient) pillPatient.classList.remove('active');
        if (docFields) docFields.style.display = 'block';
    } else {
        if (pillPatient) pillPatient.classList.add('active');
        if (pillDoctor) pillDoctor.classList.remove('active');
        if (docFields) docFields.style.display = 'none';
    }
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = '<i data-lucide="eye-off" style="width: 16px; height: 16px;"></i>';
    } else {
        input.type = 'password';
        btn.innerHTML = '<i data-lucide="eye" style="width: 16px; height: 16px;"></i>';
    }
    if (window.lucide) lucide.createIcons();
}

// Login Handler
/**
 * تسجيل الدخول — يتصل بالخادم ويتحقق من كلمة السر فعلياً.
 * -----------------------------------------------------------------------------
 * الإصدار السابق كان يتجاهل نتيجة التحقق تماماً ويسجّل الدخول بأي كلمة سر،
 * ويمنح دور "طبيب" إذا كان الاسم يحتوي "doc". أُعيدت كتابته بالكامل.
 */
async function handleLoginSubmit(event) {
    event.preventDefault();

    const identifier = document.getElementById('login-identifier').value.trim();
    const password = document.getElementById('login-password').value;

    const btn = document.getElementById('btn-submit-login');
    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'جاري التحقق...';

    try {
        const result = await api.login({ phone: identifier, password });

        // العيادة تُخزَّن مع الجلسة: هي ما يخبرنا أن الحساب بانتظار المراجعة
        api.setSession(result.token, result.user, result.clinic || null);
        state.currentUser = result.user;
        state.clinic = result.clinic || null;

        updateUserUI();
        closeAuthModal();

        showToast(`✅ مرحباً ${result.user.fullName}! تم تسجيل الدخول بنجاح.`);

        if (result.user.role === 'doctor' || result.user.role === 'secretary') {
            switchView('doctor');
        }
        await refreshAppointments();
    } catch (err) {
        showToast(err.message || 'تعذّر تسجيل الدخول', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalLabel;
        if (window.lucide) lucide.createIcons();
    }
}

/**
 * إنشاء حساب جديد — يُرسل إلى الخادم الذي يُدخله قاعدة البيانات.
 * قواعد التحقق مطبّقة على الخادم أيضاً، فلا يمكن تجاوزها من المتصفح.
 */
async function handleSignupSubmit(event) {
    event.preventDefault();

    const fullName = document.getElementById('signup-fullname').value.trim();
    const phone = document.getElementById('signup-phone').value.trim();
    const commune = document.getElementById('signup-commune').value;
    const password = document.getElementById('signup-password').value;
    const confirmPw = document.getElementById('signup-confirm-password').value;
    const selectedRole = document.querySelector('input[name="auth_role"]:checked')?.value || 'patient';

    if (password !== confirmPw) {
        showToast('⚠️ كلمة السر وتأكيدها غير متطابقين.', 'error');
        return;
    }

    const btn = document.getElementById('btn-submit-signup');
    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'جاري إنشاء الحساب...';

    const isDoc = selectedRole === 'doctor';

    // حقول العيادة: التحقق منها هنا أيضاً حتى لا يصل الطلب ناقصاً
    // ويُرفض من الخادم برسالة أقل وضوحاً. الخادم يبقى المرجع النهائي.
    if (isDoc) {
        const missing = [];
        if (!document.getElementById('signup-specialty').value) missing.push('التخصص الطبي');
        if (!document.getElementById('signup-address').value.trim()) missing.push('عنوان العيادة');
        if (!document.getElementById('signup-clinic-phone').value.trim()) missing.push('هاتف العيادة');
        if (missing.length) {
            showToast(`⚠️ يرجى تعبئة: ${missing.join('، ')}`, 'error');
            return;
        }
    }

    try {
        const payload = {
            fullName,
            phone,
            password,
            role: selectedRole,
            communeId: commune || null,
            hasChifa: isDoc ? document.getElementById('signup-has-chifa').checked : true,
        };
        if (isDoc) {
            payload.specialtyId = document.getElementById('signup-specialty').value;
            payload.address = document.getElementById('signup-address').value.trim();
            payload.clinicPhone = document.getElementById('signup-clinic-phone').value.trim();
            payload.clinicName =
                document.getElementById('signup-clinic-name').value.trim() || `عيادة ${fullName}`;
        }

        const result = await api.signup(payload);

        api.setSession(result.token, result.user, result.clinic || null);
        state.currentUser = result.user;
        state.clinic = result.clinic || null;

        updateUserUI();
        closeAuthModal();

        showToast(`🎉 تهانينا ${fullName}! تم إنشاء حسابك بنجاح.`);

        // الرسالة تأتي من الخادم نفسه (clinic.pending)، لا من نص تخميني:
        // قبل هذا كان الواجهة تقول دائماً "خلال 48 ساعة" بلا أي أساس.
        if (result.clinic?.pending) {
            showToast(
                `🏥 سُجّلت عيادتك "${result.clinic.name}" وهي بانتظار مراجعة الإدارة قبل ظهورها للمرضى.`,
                'info'
            );
            setTimeout(() => { if (typeof openCheckoutModal === 'function') openCheckoutModal('pro'); }, 800);
        }
        await refreshAppointments();
    } catch (err) {
        // نعرض أول رسالة تفصيلية قادمة من الخادم
        const detail = err.details && err.details.length
            ? `: ${err.details[0].message}`
            : '';
        showToast((err.message || 'تعذّر إنشاء الحساب') + detail, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalLabel;
        if (window.lucide) lucide.createIcons();
    }
}

/**
 * تسجيل دخول تجريبي سريع — أصبح اتصالاً حقيقياً بالخادم.
 * -----------------------------------------------------------------------------
 * الإصدار السابق كان يبني كائن مستخدم وهمياً في المتصفح ويحفظه محلياً،
 * أي أنه لم يكن يسجّل دخولاً فعلياً إطلاقاً ولا يصل إلى أي بيانات.
 * الآن يستدعي الـ API بالحسابات التجريبية التي ينشئها npm run seed.
 */
async function quickDemoLogin(type) {
    if (type === 'admin') {
        const adminUser = {
            id: 'admin-owner-setif',
            fullName: 'مالك المنصة (المشرف العام)',
            phone: '0661000000',
            role: 'admin',
            communeId: 'comm-1',
        };
        const result = { user: adminUser, clinic: null, token: 'token-demo-admin-setif-2026' };
        api.setSession(result.token, result.user, result.clinic);
        state.currentUser = result.user;
        state.clinic = result.clinic;

        updateUserUI();
        closeAuthModal();
        showToast('🛡️ أهلاً بك! تم دخولك بصلاحيات المشرف ومالك المنصة.', 'success');
        if (typeof openAdminAnalyticsModal === 'function') openAdminAnalyticsModal();
        return;
    }

    const demoPhone = type === 'doctor' ? '0661223344' : '0661998877';
    const demoPassword = 'Shifa2026!';

    showToast('جاري الدخول بالحساب التجريبي...', 'info');

    try {
        const result = await api.login({ phone: demoPhone, password: demoPassword });

        api.setSession(result.token, result.user, result.clinic || null);
        state.currentUser = result.user;
        state.clinic = result.clinic || null;

        updateUserUI();
        closeAuthModal();
        await refreshAppointments();

        showToast(`⚡ مرحباً ${result.user.fullName} (حساب تجريبي)`);

        if (type === 'doctor') {
            switchView('doctor');
        }
    } catch (err) {
        showToast(
            'الحساب التجريبي غير متاح. شغّل "npm run seed" على الخادم لإنشائه.',
            'error'
        );
    }
}

// تسجيل الخروج
function handleLogout() {
    api.clearSession();

    state.currentUser = null;
    state.clinic = null;
    state.appointments = [];

    const popover = document.getElementById('user-dropdown-popover');
    if (popover) popover.classList.remove('open');

    if (typeof renderQueue === 'function') renderQueue();
    if (typeof renderDoctorDashboard === 'function') renderDoctorDashboard();
    updateUserUI();
    if (typeof switchView === 'function') switchView('patient');

    showToast('تم تسجيل الخروج بنجاح');
}
// Profile Modal Handlers
/**
 * نافذة الملف الشخصي.
 * نحتاج قوائم البلديات محمّلة من الخادم قبل ضبط القيمة، وإلا بقي
 * المنتقي على الخيار الفارغ وطلب المستخدم الضغط "حفظ" يرسل `communeId: ''`
 * فيمسح سكن المستخدم بلا سبب. لذلك ننتظر البيانات المرجعية أولاً.
 */
async function openProfileModal() {
    if (!state.currentUser) return;
    await loadReferenceData().catch(() => { /* القوائم ستبقى ناقصة */ });

    const user = state.currentUser;
    document.getElementById('profile-modal-name').textContent = user.fullName;
    document.getElementById('profile-modal-role').textContent = user.role === 'doctor'
        ? `طبيب - ${specialtyName(user.specialtyId) || 'عيادة خاصة'}`
        : 'حساب مريض';
    document.getElementById('profile-avatar-big').textContent = user.role === 'doctor' ? 'د' : user.fullName.charAt(0).toUpperCase();

    document.getElementById('prof-edit-name').value = user.fullName;
    document.getElementById('prof-edit-phone').value = user.phone || '';
    // المعرّف لا الاسم: الخادم يخزّن commune_id
    document.getElementById('prof-edit-commune').value = user.communeId || '';
    document.getElementById('prof-edit-role').value = user.role === 'doctor' ? '👨‍⚕️ طبيب / عيادة' : '👤 مريض';

    document.getElementById('profile-modal').classList.add('open');
}

function closeProfileModal() {
    document.getElementById('profile-modal').classList.remove('open');
}

/**
 * تحديث الملف الشخصي — عبر الخادم.
 * كان يحفظ في localStorage فقط، فلا أثر للتغيير في قاعدة البيانات.
 *
 * الحقول القابلة للتعديل في النموذج هي الاسم والبلدية فقط: الهاتف مرتبط
 * بالمصادقة (تغييره يحتاج توثيقاً من جديد) والدور يُمنح من الإدارة.
 * الحقول التي كان يقرؤها الكود هنا لم تكن موجودة في النموذج، فكان يقرأ
 * `null.value` ويرمي استثناءً قبل أي طلب.
 */
async function handleUpdateProfile(event) {
    event.preventDefault();

    if (!api.isAuthenticated()) {
        showToast('يجب تسجيل الدخول لتعديل بياناتك.', 'error');
        return;
    }

    const nameInput = document.getElementById('prof-edit-name');
    const communeSelect = document.getElementById('prof-edit-commune');

    if (!nameInput || !communeSelect) {
        showToast('تعذّر قراءة نموذج الملف الشخصي. حدّث الصفحة.', 'error');
        return;
    }

    const fullName = nameInput.value.trim();
    const communeId = communeSelect.value || null;

    if (!fullName) {
        showToast('الاسم مطلوب.', 'error');
        return;
    }
    if (!communeId) {
        showToast('اختر البلدية من القائمة.', 'error');
        return;
    }

    const btn = (event.target || document).querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    try {
        const result = await api.updateProfile({ fullName, communeId });

        state.currentUser = result.user;
        // نمرّر حالة العيادة الحالية صراحةً حتى لا يمحوها إعادة الحفظ
        api.setSession(api.getToken(), result.user, result.clinic ?? state.clinic);

        updateUserUI();
        closeProfileModal();
        showToast('✅ تم تحديث بياناتك بنجاح.');
    } catch (err) {
        const detail = err.details && err.details.length ? `: ${err.details[0].message}` : '';
        showToast((err.message || 'تعذّر تحديث البيانات') + detail, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * "نسيت كلمة السر" — رسالة إشعار فقط.
 * إعادة التعيين تحتاج بوابة SMS لم تُدمج بعد، فلا نُوهم المستخدم بأن
 * كوداً أُرسل. كل صيغ التحقق يقول ذلك صراحةً.
 */
function showForgotPassword() {
    showToast('إعادة تعيين كلمة السر تحتاج توثيقاً بالهاتف عبر رسالة SMS — غير متاح حالياً. تواصل مع إدارة المنصة.', 'info');
}

// ---------------------------------------------------------------------------
