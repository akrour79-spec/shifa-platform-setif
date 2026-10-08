/**
 * Shifa Platform — admin.js
 * ----------------------------------------------------------------------------
 * مقسّم من js/app.js إلى وحدات حسب الميزة (سكربتات كلاسيكية، نطاق عام مشترك).
 * يُحمَّل بالترتيب المذكور في index.html — لا تغيّر الترتيب.
 */

// =========================================================================
// Admin Analytics & Clinic Approvals System (تحليلات المشرف وولاية سطيف)
// =========================================================================
function openAdminAnalyticsModal() {
    const modal = document.getElementById('admin-analytics-modal');
    if (modal) {
        modal.classList.add('open');
        refreshAdminAnalytics();
    }
}

function closeAdminAnalyticsModal() {
    const modal = document.getElementById('admin-analytics-modal');
    if (modal) modal.classList.remove('open');
}

async function refreshAdminAnalytics() {
    return loadAdminAnalytics();
}

async function loadAdminAnalytics() {
    try {
        const data = await api.getAdminAnalytics();
        if (!data) return;

        const kpis = data.kpis || {};

        // 1. Primary KPI elements (Modal & Page)
        const elActive = document.getElementById('admin-kpi-active-clinics') || document.getElementById('kpi-active-clinics');
        if (elActive) elActive.textContent = kpis.activeClinics ?? 0;

        const elPending = document.getElementById('admin-kpi-pending-clinics');
        if (elPending) elPending.textContent = kpis.pendingClinics ?? 0;

        const pendingTagEl = document.getElementById('kpi-pending-tag');
        if (pendingTagEl) pendingTagEl.textContent = `${kpis.pendingClinics ?? 0} عيادات بانتظار الاعتماد`;

        const elBookings = document.getElementById('admin-kpi-total-bookings') || document.getElementById('kpi-total-appts');
        if (elBookings) elBookings.textContent = kpis.totalAppointments ?? 0;

        const completedTagEl = document.getElementById('kpi-completed-tag');
        if (completedTagEl) completedTagEl.textContent = `${kpis.completedAppointments ?? 0} موعد مكتمل بنجاح`;

        // نسبة الغياب — تُعرض في عنصر kpi-noshow-tag
        const noShowTagEl = document.getElementById('kpi-noshow-tag');
        if (noShowTagEl) {
            const rate = kpis.noShowRate ?? 0;
            const missed = (kpis.cancelledAppointments ?? 0) + (kpis.noShowAppointments ?? 0);
            noShowTagEl.textContent = `${rate}% غياب (${missed} موعد)`;
            noShowTagEl.style.color = rate > 20 ? '#ef4444' : rate > 10 ? '#f59e0b' : '#10b981';
        }

        const elPatients = document.getElementById('admin-kpi-total-patients') || document.getElementById('kpi-total-patients');
        if (elPatients) elPatients.textContent = kpis.totalPatients ?? 0;

        const elMRR = document.getElementById('admin-kpi-mrr') || document.getElementById('kpi-mrr-value');
        if (elMRR) elMRR.textContent = `${(kpis.estimatedMRR || 0).toLocaleString()} دج`;

        // 2. Communes breakdown
        const communesListEl = document.getElementById('admin-communes-list');
        if (communesListEl && Array.isArray(data.communes)) {
            const maxBookings = Math.max(...data.communes.map(c => c.bookingCount), 1);
            communesListEl.innerHTML = data.communes.slice(0, 8).map(c => {
                const pct = Math.round((c.bookingCount / maxBookings) * 100);
                return `
                    <div style="background: var(--apple-card-bg, #f8fafc); border-radius: 8px; padding: 0.5rem 0.75rem;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 700; color: var(--apple-text); margin-bottom: 0.2rem;">
                            <span>📍 ${api.escape(c.communeName)}</span>
                            <span style="color: #0284c7;">${c.bookingCount} موعد (${c.clinicCount} عيادة)</span>
                        </div>
                        <div class="progress-bar-bg" style="height: 6px; background: rgba(0,0,0,0.06); border-radius: 3px; overflow: hidden;">
                            <div class="progress-bar-fill" style="width: ${pct}%; height: 100%; background: #0284c7; border-radius: 3px;"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 3. Specialties breakdown
        const specialtiesListEl = document.getElementById('admin-specialties-list');
        if (specialtiesListEl && Array.isArray(data.specialties)) {
            const maxSpec = Math.max(...data.specialties.map(s => s.bookingCount), 1);
            specialtiesListEl.innerHTML = data.specialties.slice(0, 8).map(s => {
                const pct = Math.round((s.bookingCount / maxSpec) * 100);
                return `
                    <div style="background: var(--apple-card-bg, #f8fafc); border-radius: 8px; padding: 0.5rem 0.75rem;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 700; color: var(--apple-text); margin-bottom: 0.2rem;">
                            <span>🩺 ${api.escape(s.specialtyName)}</span>
                            <span style="color: #10b981;">${s.bookingCount} موعد (${s.clinicCount} عيادة)</span>
                        </div>
                        <div class="progress-bar-bg" style="height: 6px; background: rgba(0,0,0,0.06); border-radius: 3px; overflow: hidden;">
                            <div class="progress-bar-fill" style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #10b981, #f59e0b); border-radius: 3px;"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 4. Pending clinics approval table / list
        const pendingBadgeEl = document.getElementById('pending-clinics-count-badge');
        if (pendingBadgeEl) {
            pendingBadgeEl.textContent = `${data.pendingClinics ? data.pendingClinics.length : 0} طلب بانتظار المراجعة`;
        }

        const pendingContainerEl = document.getElementById('admin-pending-clinics-list') || document.getElementById('pending-clinics-container');
        if (pendingContainerEl) {
            if (!data.pendingClinics || data.pendingClinics.length === 0) {
                pendingContainerEl.innerHTML = `
                    <div style="text-align: center; padding: 1.25rem; color: var(--apple-subtext); font-size: 0.88rem; background: var(--apple-card-bg, #f8fafc); border-radius: 8px;">
                        ✨ لا توجد عيادات بانتظار الاعتماد حالياً. جميع العيادات موثقة ومفعلة.
                    </div>
                `;
            } else {
                pendingContainerEl.innerHTML = data.pendingClinics.map(d => `
                    <div style="background: var(--apple-card-bg, #f8fafc); border: 1px solid var(--apple-border); padding: 0.85rem 1rem; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                        <div>
                            <strong style="font-size: 0.95rem; color: var(--apple-text);">${api.escape(d.name)}</strong>
                            <span style="font-size: 0.8rem; color: var(--apple-subtext); margin-right: 0.5rem;">(${api.escape(d.specialtyName || d.title || '')})</span>
                            <div style="font-size: 0.8rem; color: var(--apple-subtext); margin-top: 0.2rem;">
                                📍 ${api.escape(d.communeName || 'سطيف')} | 📞 ${api.escape(d.phone || 'غير محدد')} | 💰 ${d.price || 0} دج
                            </div>
                        </div>
                        <button class="btn-primary" style="padding: 0.4rem 0.9rem; font-size: 0.8rem; background: #10b981; border-radius: 8px;" data-ui="approveClinicDirect" data-arg="${d.id}">
                            <i data-lucide="check-circle" style="width: 14px; height: 14px;"></i>
                            اعتماد العيادة
                        </button>
                    </div>
                `).join('');
            }
        }

        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        console.error('فشل تحميل تحليلات المشرف:', err);
    }
}

async function approveClinicDirect(doctorId) {
    if (!doctorId) return;
    if (!confirm('هل أنت تأكد من تفعيل واعتماد هذه العيادة للمرضى؟')) return;
    try {
        const res = await api.approveClinic(doctorId);
        showToast(res.message || 'تم اعتماد وتفعيل العيادة بنجاح', 'success');
        await loadAdminAnalytics();
        if (typeof loadDoctors === 'function') await loadDoctors();
    } catch (err) {
        showToast(err.message || 'تعذر اعتماد العيادة', 'error');
    }
}



// =========================================================================
