/**
 * Shifa Platform — billing.js
 * ----------------------------------------------------------------------------
 * مقسّم من js/app.js إلى وحدات حسب الميزة (سكربتات كلاسيكية، نطاق عام مشترك).
 * يُحمَّل بالترتيب المذكور في index.html — لا تغيّر الترتيب.
 */

// Monetization & Subscription Management
function renderSubscriptions() {
    const list = document.getElementById('subscriptions-list');
    if (!list) return;

    // لا نستبدل القائمة الفارغة بعينات مسبوكة تُظهر للمستخدم
    // كأنها اشتراكات حقيقية — هذا مبدأ "لا بيانات وهمية كأنها حقيقية".
    // إن لم تُسجّل اشتراكات بعد، تبقى القائمة فارغة وMRR صفراً.

    const totalMRR = state.subscriptions.reduce((sum, s) => sum + s.amount, 0);
    const mrrDisplay = document.getElementById('stat-mrr');
    if (mrrDisplay) {
        mrrDisplay.textContent = `${totalMRR.toLocaleString('ar-DZ')} دج`;
    }

    list.innerHTML = state.subscriptions.map(sub => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; background: #f8fafc; border-radius: 14px; border: 1px solid var(--apple-border); margin-bottom: 0.75rem;">
            <div>
                <strong style="color: var(--apple-text); font-size: 1rem;">${api.escape(sub.doctorName)}</strong>
                <div style="font-size: 0.8rem; color: var(--apple-subtext); margin-top: 2px;">
                    تاريخ الاشتراك: ${api.escape(sub.date)} | نوع الباقة: <span style="font-weight: 700; color: var(--primary-emerald-dark);">${api.escape(sub.plan.toUpperCase())}</span>
                </div>
            </div>
            <div style="text-align: left;">
                <strong style="color: var(--primary-emerald-dark); font-size: 1.15rem;">${sub.amount.toLocaleString('ar-DZ')} دج</strong>
                <div><span style="font-size: 0.75rem; background: #dcfce7; color: #15803d; padding: 0.2rem 0.6rem; border-radius: 999px; font-weight: 700;">${api.escape(sub.status)}</span></div>
            </div>
        </div>
    `).join('');
}

function renderPricingCards() {
    const container = document.getElementById('pricing-cards-container');
    if (!container) return;

    const isYearly = state.billingCycle === 'yearly';

    container.innerHTML = SUBSCRIPTION_PLANS.map(plan => {
        const price = isYearly ? plan.priceYearly : plan.priceMonthly;
        const periodText = isYearly ? 'دج / سنوياً' : 'دج / شهرياً';
        const monthlyEquivalent = isYearly ? Math.round(plan.priceYearly / 12) : plan.priceMonthly;
        const isPopular = plan.popular;

        return `
            <div class="pricing-card ${isPopular ? 'featured' : ''}">
                ${plan.badge ? `<span class="pricing-badge">${api.escape(plan.badge)}</span>` : ''}
                <div>
                    <h4 style="font-size: 1.3rem; font-weight: 800; ${isPopular ? 'color: var(--primary-emerald-dark);' : ''}">${api.escape(plan.name)}</h4>
                    <p style="font-size: 0.85rem; color: var(--apple-subtext); margin-top: 0.25rem;">${api.escape(plan.target)}</p>
                    <div class="price-val" style="${isPopular ? 'color: var(--primary-emerald-dark);' : ''}">
                        ${price.toLocaleString('ar-DZ')} <small>${periodText}</small>
                    </div>
                    ${isYearly ? `<div style="font-size: 0.8rem; color: var(--primary-emerald); font-weight: 700; margin-bottom: 0.5rem;">توفير 20% (يعادل ${monthlyEquivalent.toLocaleString('ar-DZ')} دج/شهر)</div>` : ''}
                    <ul class="feature-list">
                        ${plan.features.map(f => `<li><i data-lucide="check" style="width: 16px; color: var(--primary-emerald);"></i> ${api.escape(f)}</li>`).join('')}
                    </ul>
                </div>
                <button class="${isPopular ? 'btn-primary' : 'btn-outline'}" style="width: 100%; ${isPopular ? 'background: linear-gradient(135deg, var(--primary-emerald), #0071e3);' : ''}" data-ui="openCheckoutModal" data-arg="${plan.id}">
                    <i data-lucide="zap" style="width: 16px; height: 16px;"></i>
                    ${isYearly ? 'اشترك سنوياً ووفر 20%' : 'اشترك بالبطاقة الذهبية / CIB'}
                </button>
            </div>
        `;
    }).join('');

    if (window.lucide) {
        lucide.createIcons();
    }
}

function toggleBillingCycle(cycle) {
    if (cycle === 'monthly' || cycle === 'yearly') {
        state.billingCycle = cycle;
    } else {
        state.billingCycle = state.billingCycle === 'monthly' ? 'yearly' : 'monthly';
    }

    const toggleBtn = document.getElementById('billing-toggle');
    const labelMonthly = document.getElementById('label-monthly');
    const labelYearly = document.getElementById('label-yearly');

    if (toggleBtn) {
        if (state.billingCycle === 'yearly') {
            toggleBtn.classList.add('active');
        } else {
            toggleBtn.classList.remove('active');
        }
    }

    if (labelMonthly && labelYearly) {
        if (state.billingCycle === 'yearly') {
            labelYearly.classList.add('active');
            labelMonthly.classList.remove('active');
        } else {
            labelMonthly.classList.add('active');
            labelYearly.classList.remove('active');
        }
    }

    renderPricingCards();
}

function openCheckoutModal(planId) {
    const plan = SUBSCRIPTION_PLANS.find(p => p.id === planId);
    if (!plan) return;

    const isYearly = state.billingCycle === 'yearly';
    const amount = isYearly ? plan.priceYearly : plan.priceMonthly;
    const cycleText = isYearly ? 'اشتراك سنوي (توفير 20%)' : 'اشتراك شهري';

    const modalPlanName = document.getElementById('checkout-plan-name');
    const modalAmount = document.getElementById('checkout-amount');
    const modalCycle = document.getElementById('checkout-cycle-badge');

    if (modalPlanName) modalPlanName.textContent = plan.name;
    if (modalAmount) modalAmount.textContent = `${amount.toLocaleString('ar-DZ')} دج`;
    if (modalCycle) modalCycle.textContent = cycleText;

    const modal = document.getElementById('checkout-modal');
    if (modal) {
        modal.dataset.planId = planId;
        modal.dataset.amount = amount;
        modal.classList.add('open');
    }
}

function closeCheckoutModal() {
    document.getElementById('checkout-modal')?.classList.remove('open');
}

async function submitSubscriptionOrder(event) {
    if (event) event.preventDefault();

    const modal = document.getElementById('checkout-modal');
    const planId = modal ? modal.dataset.planId : 'pro';
    const amount = modal ? parseInt(modal.dataset.amount || '9900', 10) : 9900;
    const plan = SUBSCRIPTION_PLANS.find(p => p.id === planId);

    const docName = state.currentUser ? (state.currentUser.fullName || state.currentUser.name) : 'عيادة طبية جديدة (سطيف)';

    try {
        showToast('🔄 جاري الاتصال ببوابة الدفع الإلكترونية Chargily Pay بالبطاقة الذهبية...', 'info');
        const res = await api.createPaymentCheckout({
            planId,
            billingCycle: 'monthly',
            paymentMethod: 'edahabia',
        });

        state.subscriptions.unshift({
            doctorName: docName,
            plan: plan ? plan.id : 'pro',
            amount: amount,
            date: new Date().toISOString().split('T')[0],
            status: 'مدفوع (Chargily)'
        });

        renderSubscriptions();
        closeCheckoutModal();

        if (res && res.checkoutUrl) {
            setTimeout(() => {
                window.location.href = res.checkoutUrl;
            }, 600);
        } else {
            showToast('✅ تم إنشاء طلب الاشتراك بنجاح!', 'success');
        }
    } catch (err) {
        showToast('⚠️ تعذّر إنشاء طلب الدفع: ' + (err.message || 'خطأ غير معروف'), 'error');
    }
}

// Stats Calculation
function renderStats() {
    const docCount = document.getElementById('stat-doctors-count');
    const aptCount = document.getElementById('stat-appointments-count');
    animateCount(docCount, state.doctors.length);
    animateCount(aptCount, state.appointments.length);
}

// Toast helper

