// Single source of truth for Wavo web pricing. Native iOS prices are read from StoreKit.
export const CURRENCY = 'AUD'

export const PLANS = {
  standard: {
    id: 'standard',
    label: 'Premium',
    name: 'Wavo Premium',
    price: 4.99,
    priceAud: 4.99,
    priceLabel: '$4.99 AUD / month',
    blurb: 'Customisation and everyday power tools.',
    tier: 'premium',
    requiresStudentDeclaration: false,
  },
  student: {
    id: 'student',
    label: 'Student',
    name: 'Wavo Premium — Student',
    price: 3.49,
    priceAud: 3.49,
    priceLabel: '$3.49 AUD / month',
    blurb: 'Same Premium, cheaper if you are at school.',
    tier: 'premium',
    requiresStudentDeclaration: true,
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    name: 'Wavo Pro',
    price: 14.99,
    priceAud: 14.99,
    priceLabel: '$14.99 AUD / month',
    blurb: 'Premium plus AI, transcription and serious Space tools.',
    tier: 'pro',
    requiresStudentDeclaration: false,
  },
}

export const DEFAULT_PLAN = 'standard'
export const PRO_PLAN = 'pro'

export function getPlan(id) {
  return PLANS[id] ?? PLANS[DEFAULT_PLAN]
}

export function formatPrice(amount) {
  return `$${Number(amount).toFixed(2).replace(/\.00$/, '')}`
}

export function formatMonthly(amount) {
  return `${formatPrice(amount)}/mo`
}

export function planPrice(id) {
  return formatMonthly(getPlan(id).price)
}

export function priceSubtitle(id = DEFAULT_PLAN) {
  const plan = getPlan(id)
  return `${formatMonthly(plan.price)}. ${plan.blurb}`
}

export const PLAN_IDS = Object.keys(PLANS)
