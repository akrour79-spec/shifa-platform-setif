/**
 * Shifa Platform — doctors.js
 * ----------------------------------------------------------------------------
 * مقسّم من js/app.js إلى وحدات حسب الميزة (سكربتات كلاسيكية، نطاق عام مشترك).
 * يُحمَّل بالترتيب المذكور في index.html — لا تغيّر الترتيب.
 */

// Search and Filter logic
function initFilters() {
    const communeSelect = document.getElementById('filter-commune');
    const specialtySelect = document.getElementById('filter-specialty');
    const searchInput = document.getElementById('search-query');
    const searchBtn = document.getElementById('btn-do-search');

    if (!communeSelect || !specialtySelect || !searchInput || !searchBtn) return;

    // القوائم تأتي من الخادم — مصدر واحد للحقيقة.
    // الفلاتر تُرسل للخادم بدل الترشيح في المتصفح.
    let filterTimer = null;

    const triggerFilter = () => {
        loadDoctors({
            commune: communeSelect.value,
            specialty: specialtySelect.value,
            search: searchInput.value.trim(),
        }).catch(() => { /* renderDoctorsError يعرض التفاصيل */ });
    };

    const debouncedFilter = () => {
        if (filterTimer) clearTimeout(filterTimer);
        // 350ms: ننتظر توقف الكتابة قبل إرسال طلب لكل حرف
        filterTimer = setTimeout(triggerFilter, 350);
    };

    // ملء القوائم من الخادم
    // مهم: نضيف خيار "الكل" أولاً. القوائم فارغة في HTML، فالمتصفح
    // يختار أول خيار تلقائياً عند تعبئتها لاحقاً — فيقول المستخدم
    // "طب الأطفال" بينما الفلتر الفعلي هو "الطب العام"، أو يختفي كل
    // طبيب عند أول نقرة على البلدية.
    const addOption = (select, value, label) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        select.appendChild(opt);
    };

    loadReferenceData().then(() => {
        addOption(communeSelect, 'all', 'كل بلديات سطيف');
        addOption(specialtySelect, 'all', 'كل التخصصات');

        state.communes.forEach((c) => addOption(communeSelect, c.id, c.name));
        state.specialties.forEach((s) => addOption(specialtySelect, s.id, s.name));

        // نعيد الرسم فقط — لا نعيد الجلب.
        // الطلب الأول في DOMContentLoaded بلا فلاتر، أي أنه أصلاً يعرض
        // "الكل"، وهو نفس ما تعرضه القائمتان الآن. إعادة الجلب هنا كانت
        // تستبدل كائنات الأطباء بينما جلب الخانات جارٍ عليها.
        renderDoctors(state.doctors);
    }).catch(() => {
        showToast('تعذّر تحميل قوائم الفلترة', 'error');
    });

    const dropdown = document.getElementById('instant-search-dropdown');

    const updateDropdown = (query) => {
        if (!query || query.length < 2) {
            if (dropdown) dropdown.classList.remove('open');
            return;
        }

        const matches = state.doctors.filter(d =>
            d.name.toLowerCase().includes(query) ||
            d.specialtyName.toLowerCase().includes(query) ||
            d.communeName.toLowerCase().includes(query)
        );

        if (!matches.length) {
            if (dropdown) dropdown.classList.remove('open');
            return;
        }

        dropdown.innerHTML = matches.map(doc => `
            <div class="dropdown-item" data-doc-id="${api.escape(doc.id)}" role="button" tabindex="0">
                <img src="${api.escape(doc.image)}" alt="${api.escape(doc.name)}" class="dropdown-avatar" />
                <div class="dropdown-info">
                    <div class="dropdown-name">${api.escape(doc.name)}</div>
                    <div class="dropdown-spec">${api.escape(doc.title)} - ${api.escape(doc.communeName)}</div>
                </div>
                <button class="btn-primary" style="padding: 0.4rem 0.9rem; font-size: 0.8rem;">حجز</button>
            </div>
        `).join('');

        // تفويض الأحداث: نقرأ المعرّف من data-* بدل حقنه داخل onclick
        dropdown.querySelectorAll('[data-doc-id]').forEach((item) => {
            const go = () => selectDoctorFromDropdown(item.dataset.docId);
            item.addEventListener('click', go);
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
            });
        });

        dropdown.classList.add('open');
    };

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        debouncedFilter();
        updateDropdown(query);
    });

    document.addEventListener('click', (e) => {
        if (dropdown && !dropdown.contains(e.target) && e.target !== searchInput) {
            dropdown.classList.remove('open');
        }
    });

    searchBtn.addEventListener('click', () => { debouncedFilter(); });
    communeSelect.addEventListener('change', triggerFilter);
    specialtySelect.addEventListener('change', triggerFilter);
}

function selectDoctorFromDropdown(docId) {
    const dropdown = document.getElementById('instant-search-dropdown');
    if (dropdown) dropdown.classList.remove('open');
    openBookingModal(docId);
}


// Quick Category Pill Filter
function filterBySpecialtyPill(specialtyId, btnElement) {
    document.querySelectorAll('.cat-pill').forEach(btn => btn.classList.remove('active'));
    if (btnElement) {
        btnElement.classList.add('active');
    }
    
    const specialtySelect = document.getElementById('filter-specialty');
    if (specialtySelect) {
        specialtySelect.value = specialtyId;
        specialtySelect.dispatchEvent(new Event('change'));
    }
    
    // التسمية تأتي من الخيار نفسه في القائمة — لا حاجة لثابت محلي
    const chosen = specialtySelect.options[specialtySelect.selectedIndex];
    const label = chosen ? chosen.textContent : 'الجميع';
    showToast(`عرض أطباء وسجلات: ${label}`, 'info');
}

// Render Doctors Cards
/* ============================================================
   SHIFA MOTION PACK — مساعدات الحركة
   ------------------------------------------------------------
   prefersReducedMotion: يحترم إعدادات المستخدم لتقليل الحركة
   animateCount: عدّ تصاعدي متحرك للعناصر العددية
   tickNumber: وميض رقم الطابور عند تغيّره فقط
   renderDoctorsSkeleton: هيكل تحميل لبطاقات الأطباء
   ============================================================ */

/** هيكل تحميل يحاكي بطاقة الطبيب أثناء جلب البيانات */
function renderDoctorsSkeleton(count = 6) {
    const container = document.getElementById('doctors-container');
    if (!container) return;
    container.innerHTML = Array.from({ length: count }, () => `
        <div class="doctor-card doctor-card-skel" aria-hidden="true">
            <div style="display: flex; gap: 12px; align-items: center;">
                <div class="skel" style="width: 64px; height: 64px; border-radius: 50%; flex-shrink: 0;"></div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
                    <div class="skel" style="width: 70%;"></div>
                    <div class="skel" style="width: 45%;"></div>
                </div>
            </div>
            <div class="skel" style="width: 100%;"></div>
            <div class="skel" style="width: 85%;"></div>
            <div style="display: flex; gap: 8px; margin-top: auto;">
                <div class="skel" style="flex: 1; height: 38px;"></div>
                <div class="skel" style="flex: 1; height: 38px;"></div>
            </div>
        </div>`).join('');
}

function renderDoctors(doctorsList) {
    const container = document.getElementById('doctors-container');
    const resultsCount = document.getElementById('results-count');

    if (resultsCount) {
        resultsCount.textContent = `تم العثور على ${doctorsList.length} طبيب وعيادة في ولاية سطيف`;
    }

    // تنبيه شفافية البيانات: الأسماء المخيّلة تُعرض بلا تمييز فهي تبدو
    // أنان أحد شخصة نفسه لطبيب لم يوافق على الظهور.
    // لم يوافق على الظهور. يظهر فقط حين توجد عيادات تجريبية في النتائج.
    const demoCount = doctorsList.filter(d => d.isDemo).length;
    const banner = demoCount > 0 ? `
        <div class="demo-data-notice">
            <i data-lucide="flask-conical" style="width: 18px; height: 18px; flex-shrink: 0;"></i>
            <span>${demoCount === doctorsList.length
                ? 'كل الدرات في هذه القائمة بيانات تجريبية لأغراض العرض فقط، وليست عيادات حقيقية.'
                : `${demoCount} من هذه العيادات بيانات تجريبية لأغراض العرض فقط.`}</span>
        </div>` : '';

    if (!doctorsList.length) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 3.5rem; background: white; border-radius: 20px; box-shadow: var(--shadow-sm);">
                <i data-lucide="search-x" style="width: 54px; height: 54px; color: #94a3b8; margin: 0 auto 1rem;"></i>
                <h3 style="font-weight: 800; font-size: 1.25rem; margin-bottom: 0.5rem;">لم يتم العثور على أطباء وفق هذا البحث</h3>
                <p style="color: #64748b;">يرجى تجربة تغيير البلدية أو التخصص الطبي في سطيف.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

container.innerHTML = banner + doctorsList.map((doc, i) => `
        <div class="doctor-card stagger-in" style="--i:${Math.min(i, 11)}">
            <div>
                <div class="doc-top">
                    <div class="doc-avatar-wrap">
                        <img src="${api.escape(doc.image)}" alt="${api.escape(doc.name)}" class="doc-avatar" />
                        <span class="status-dot ${doc.availableToday ? 'online' : 'offline'}" title="${doc.availableToday ? 'حضور حي بالعيادة اليوم' : 'المواعيد مسبقة'}"></span>
                    </div>
                    <div class="doc-details">
                        <div class="doc-badge-wrap">
                            <span class="doc-badge">${api.escape(doc.badge)}</span>
                            ${doc.acceptsChifaCard ? '<span class="doc-chifa-badge">💳 بطاقة الشفاء</span>' : ''}
                            ${(doc.accepting_bookings === false || doc.acceptingBookings === false) ? '<span class="badge-booking-closed">🔴 مكتمل / استقبال متوقف</span>' : ''}
                            ${doc.isDemo ? '<span class="doc-demo-badge" title="اسم ومعلومات خيالية أُضيفت للتجربة — ليست عيادة حقيقية">بيانات تجريبية</span>' : ''}
                        </div>
                        <h3 class="doc-name">${api.escape(doc.name)}</h3>
                        <div class="doc-specialty">${api.escape(doc.title)}</div>
                        <div class="doc-location">
                            <i data-lucide="map-pin" style="width: 14px; height: 14px; color: var(--primary);"></i>
                            <span>${api.escape(doc.communeName)} - ${api.escape(doc.address)}</span>
                        </div>
                    </div>
                </div>

                <div class="doc-meta">
                    <div class="doc-meta-item">
                        <span class="doc-meta-label">سعر الكشف / الفحص</span>
                        <span class="doc-meta-val" style="color: var(--primary);">${api.escape(doc.price)} دج</span>
                    </div>
                    <div class="doc-meta-item">
                        <span class="doc-meta-label">التقييم المعتمد</span>
                        <span class="doc-meta-val" style="color: #d97706;">⭐ ${api.escape(doc.rating)} (${api.escape(doc.reviewsCount)} تقييم)</span>
                    </div>
                    <div class="doc-meta-item" style="grid-column: 1/-1;">
                        <span class="doc-meta-label">المعلم القريب في سطيف</span>
                        <span class="doc-meta-val" style="font-size: 0.82rem; font-weight: 500;">📍 ${api.escape(doc.nearLandmark)}</span>
                    </div>
                </div>

                <div>
                    <div class="slots-label">
                        <span>${doc.slotsLoaded && doc.slotsForDate !== localISODate()
                            ? `أقرب مواعيد مفتوحة (${formatShortDate(doc.slotsForDate)}):`
                            : 'اختر توقيت الحضور المناسب:'}</span>
                        <span style="font-size: 0.75rem; color: var(--primary); font-weight: 600;">حجز فوري</span>
                    </div>
                    <div class="slots-pills" data-slots-for="${api.escape(doc.id)}">
                        ${(doc.accepting_bookings === false || doc.acceptingBookings === false)
                            ? '<div class="slots-closed-banner">⚠️ العيادة متوقفة عن استقبال المواعيد حالياً (اكتمل العدد)</div>'
                            : ((doc.availableSlots || []).map(slot => `
                                <button class="slot-pill" data-doc-id="${api.escape(doc.id)}" data-slot="${api.escape(slot)}">${api.escape(slot)}</button>
                            `).join('') || (doc.slotsLoaded
                                ? '<span style="font-size: 0.8rem; color: #94a3b8;">لا توجد خانات مفتوحة حالياً — اختر تاريخاً آخر في نافذة الحجز</span>'
                                : '<span style="font-size: 0.8rem; color: #94a3b8;">جارٍ تحميل الأوقات المتاحة…</span>'))}
                    </div>
                </div>
            </div>

            <div class="doc-footer">
                <button class="btn-primary doc-book-btn" style="flex: 1;" data-doc-id="${api.escape(doc.id)}">
                    <i data-lucide="calendar-check" style="width: 18px; height: 18px;"></i>
                    احجز تذكرتك الآن
                </button>
                <button class="btn-outline doc-locate-btn" data-lat="${api.escape(doc.lat)}" data-lng="${api.escape(doc.lng)}" data-name="${api.escape(doc.name)}" title="عرض في الخريطة">
                    <i data-lucide="map-pin" style="width: 18px; height: 18px;"></i>
                </button>
            </div>
        </div>
    `).join('');

    lucide.createIcons();

    // تفويض الأحداث: نقرأ البيانات من data-* بدل حقنها داخل onclick.
    // هذا يُغلق مسار XSS عبر سمات HTML (قيمة منقولة داخل JS داخل HTML).
    container.querySelectorAll('.slot-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            selectDoctorSlot(btn.dataset.docId, btn.dataset.slot, btn);
        });
    });

    container.querySelectorAll('.doc-book-btn').forEach(btn => {
        btn.addEventListener('click', () => openBookingModal(btn.dataset.docId));
    });

    container.querySelectorAll('.doc-locate-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            locateDoctorOnMap(
                Number(btn.dataset.lat),
                Number(btn.dataset.lng),
                btn.dataset.name
            );
        });
    });

    // Attach Apple 3D Tilt Perspective on Mouse Move
    document.querySelectorAll('.doctor-card').forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            const rotateX = (-y / rect.height) * 10;
            const rotateY = (x / rect.width) * 10;
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px)`;
        });
        card.addEventListener('mouseleave', () => {
            card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)`;
        });
    });
}

// Map Initialization
let mapResizeObserver = null;

function initMap() {
    const mapContainer = document.getElementById('setif-map');
    if (!mapContainer) return;

    if (state.map) {
        state.map.invalidateSize();
        return;
    }

    try {
        state.map = L.map('setif-map', {
            center: [36.1912, 5.4137],
            zoom: 13,
            scrollWheelZoom: true
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap | منصة شفاء سطيف'
        }).addTo(state.map);

        updateMapMarkers(state.doctors);

        if (window.ResizeObserver && !mapResizeObserver) {
            mapResizeObserver = new ResizeObserver(() => {
                if (state.map) {
                    state.map.invalidateSize();
                }
            });
            mapResizeObserver.observe(mapContainer);
        }

        setTimeout(() => {
            if (state.map) state.map.invalidateSize();
        }, 150);
        setTimeout(() => {
            if (state.map) state.map.invalidateSize();
        }, 400);
    } catch (e) {
        console.error("Map initialization error:", e);
    }
}

function updateMapMarkers(doctorsList) {
    if (!state.map) return;

    // Clear old markers
    state.markers.forEach(m => state.map.removeLayer(m));
    state.markers = [];

    doctorsList.forEach(doc => {
        // Custom HTML Pin that never breaks or depends on external image files
        const isLabOrImg = (doc.specialty === 'laboratoire' || doc.specialty === 'imagerie');
        const pinColor = isLabOrImg ? '#0284c7' : '#059669';
        const pinEmoji = isLabOrImg ? '🔬' : '🩺';

        const customPin = L.divIcon({
            className: 'shifa-map-pin',
            html: `
                <div style="background: ${pinColor}; color: white; width: 38px; height: 38px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.35); border: 2.5px solid #ffffff; cursor: pointer; transition: transform 0.2s;">
                    <span style="transform: rotate(45deg); font-size: 16px; line-height: 1;">${pinEmoji}</span>
                </div>
            `,
            iconSize: [38, 38],
            iconAnchor: [19, 38],
            popupAnchor: [0, -36]
        });

        const marker = L.marker([doc.lat, doc.lng], { icon: customPin }).addTo(state.map);
        marker.bindPopup(`
            <div style="direction: rtl; text-align: right; font-family: 'Tajawal', system-ui, sans-serif; min-width: 200px;">
                <div style="font-size: 0.75rem; background: #ecfdf5; color: #065f46; display: inline-block; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-bottom: 4px;">
                    ${doc.communeName}
                </div>
                <h4 style="color: #059669; font-size: 1rem; font-weight: 800; margin: 0 0 2px;">${doc.name}</h4>
                <div style="font-size: 0.8rem; color: #0284c7; font-weight: 600;">${doc.title}</div>
                <div style="font-size: 0.75rem; color: #64748b; margin: 4px 0;">📍 ${doc.address}</div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin: 6px 0 8px; border-top: 1px dashed #e2e8f0; padding-top: 4px;">
                    <span style="font-size: 0.75rem; color: #64748b;">الكشف:</span>
                    <strong style="color: #059669; font-size: 0.95rem;">${doc.price} دج</strong>
                </div>
                <button data-ui="openBookingModalFromCard" data-arg="${doc.id}" style="width: 100%; background: #059669; color: white; border: none; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 0.85rem; font-family: inherit;">
                    حجز موعد عند الطبيب
                </button>
            </div>
        `);
        state.markers.push(marker);
    });
}

function locateDoctorOnMap(lat, lng, name) {
    // 1. Switch to Map Tab
    document.querySelectorAll('.nav-tab-btn').forEach(t => {
        if (t.dataset.view === 'map') t.classList.add('active');
        else t.classList.remove('active');
    });
    switchView('map');

    // 2. Focus on Doctor Coordinates & open popup
    setTimeout(() => {
        if (state.map) {
            state.map.invalidateSize();
            state.map.setView([lat, lng], 16);
            const marker = state.markers.find(m => {
                const pos = m.getLatLng();
                return Math.abs(pos.lat - lat) < 0.001 && Math.abs(pos.lng - lng) < 0.001;
            });
            if (marker) marker.openPopup();
        }
    }, 250);
}

