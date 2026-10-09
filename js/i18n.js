/**
 * Shifa Platform — i18n.js
 * ----------------------------------------------------------------------------
 * نظام الترجمة: العربية (افتراضي، RTL) والفرنسية (LTR).
 * - القاموس: I18N_STRINGS[lang][key]
 * - t(key): إرجاع الترجمة للغة الحالية
 * - setLang(lang): تبديل اللغة + الاتجاه + الحفظ
 * - applyI18n(): تطبيق data-i18n على العناصر الثابتة
 */

const I18N_STRINGS = {
    ar: {
        // التنقل العام
        'nav.home': 'الرئيسية',
        'nav.appointments': 'المواعيد',
        'nav.pharmacies': 'الصيدليات',
        'nav.services': 'الخدمات',
        'nav.emergency': 'الطوارئ',
        'nav.dashboard': 'لوحة التحكم',
        'nav.queue': 'الطابور',
        'nav.prescriptions': 'الوصفات',
        'nav.analytics': 'الإحصائيات',
        'nav.settings': 'الإعدادات',
        'nav.subscription': 'الاشتراك',
        'nav.logout': 'تسجيل الخروج',
        'nav.login': 'تسجيل الدخول',
        // البوابة الرئيسية
        'gateway.title': 'منصة شفاء',
        'gateway.subtitle': 'أول منصة طبية في ولاية سطيف — احجز موعدك في ثوانٍ',
        'gateway.patient': 'أنا مريض',
        'gateway.patient.desc': 'ابحث عن طبيب واحجز موعدك',
        'gateway.doctor': 'أنا طبيب',
        'gateway.doctor.desc': 'أدر عيادتك ومواعيدك',
        // المريض
        'patient.book.title': 'حجز موعد طبي',
        'patient.search.doctor': 'اسم الطبيب',
        'patient.search.specialty': 'التخصص',
        'patient.search.commune': 'البلدية',
        'patient.search.btn': 'ابحث',
        'patient.book.now': 'احجز تذكرتك الآن',
        'patient.rate': 'قيّم هذا الطبيب',
        'patient.portal.title': 'بوابتي الصحية',
        // الطبيب
        'doctor.queue.title': 'طابور الانتظار',
        'doctor.queue.next': 'استدعاء التالي',
        'doctor.tv.mode': 'شاشة TV',
        // عام
        'common.loading': 'جاري التحميل...',
        'common.save': 'حفظ',
        'common.cancel': 'إلغاء',
        'common.close': 'إغلاق',
        'common.search': 'بحث',
        'common.price': 'السعر',
        'common.reviews': 'تقييم',
        'common.language': 'اللغة',
    },
    fr: {
        // Navigation générale
        'nav.home': 'Accueil',
        'nav.appointments': 'Rendez-vous',
        'nav.pharmacies': 'Pharmacies',
        'nav.services': 'Services',
        'nav.emergency': 'Urgences',
        'nav.dashboard': 'Tableau de bord',
        'nav.queue': "File d'attente",
        'nav.prescriptions': 'Ordonnances',
        'nav.analytics': 'Statistiques',
        'nav.settings': 'Paramètres',
        'nav.subscription': 'Abonnement',
        'nav.logout': 'Déconnexion',
        'nav.login': 'Connexion',
        // Portail principal
        'gateway.title': 'Shifa',
        'gateway.subtitle': 'Première plateforme médicale de la wilaya de Sétif — réservez en quelques secondes',
        'gateway.patient': 'Je suis patient',
        'gateway.patient.desc': 'Trouvez un médecin et réservez',
        'gateway.doctor': 'Je suis médecin',
        'gateway.doctor.desc': 'Gérez votre clinique et vos rendez-vous',
        // Patient
        'patient.book.title': 'Prendre rendez-vous médical',
        'patient.search.doctor': 'Nom du médecin',
        'patient.search.specialty': 'Spécialité',
        'patient.search.commune': 'Commune',
        'patient.search.btn': 'Rechercher',
        'patient.book.now': 'Réserver maintenant',
        'patient.rate': 'Noter ce médecin',
        'patient.portal.title': 'Mon dossier santé',
        // Médecin
        'doctor.queue.title': "File d'attente",
        'doctor.queue.next': 'Appeler le suivant',
        'doctor.tv.mode': 'Écran TV',
        // Commun
        'common.loading': 'Chargement...',
        'common.save': 'Enregistrer',
        'common.cancel': 'Annuler',
        'common.close': 'Fermer',
        'common.search': 'Rechercher',
        'common.price': 'Prix',
        'common.reviews': 'avis',
        'common.language': 'Langue',
    }
};

const LANG_KEY = 'shifa_lang';

function getLang() {
    try {
        const saved = localStorage.getItem(LANG_KEY);
        if (saved === 'fr' || saved === 'ar') return saved;
    } catch (e) {}
    return 'ar';
}

/** ترجمة مفتاح — تُرجع المفتاح نفسه إن لم توجد ترجمة */
function t(key) {
    const lang = getLang();
    return (I18N_STRINGS[lang] && I18N_STRINGS[lang][key])
        || I18N_STRINGS.ar[key]
        || key;
}

function setLang(lang) {
    if (lang !== 'ar' && lang !== 'fr') return;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    applyI18n();
    // إعادة رسم الواجهات الديناميكية باللغة الجديدة
    if (typeof renderDoctors === 'function') {
        try { renderDoctors(); } catch (e) {}
    }
}

/** تطبيق الترجمات على كل عنصر يحمل data-i18n */
function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        el.placeholder = t(el.getAttribute('data-i18n-ph'));
    });
    // تحديث زر اللغة
    document.querySelectorAll('[data-lang-toggle]').forEach(btn => {
        btn.textContent = getLang() === 'ar' ? 'FR' : 'عر';
    });
}

function toggleLang() {
    setLang(getLang() === 'ar' ? 'fr' : 'ar');
}

// تهيئة عند التحميل
(function initI18n() {
    const lang = getLang();
    if (document.documentElement) {
        document.documentElement.lang = lang;
        document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyI18n);
    } else {
        applyI18n();
    }
})();
