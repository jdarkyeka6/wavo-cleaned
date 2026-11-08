// Customer-facing welcome offers for WEB checkout only.
// The server validates the choice and verifies the configured Stripe coupon.
export const WELCOME_OFFERS = [
  {
    id: 'half1',
    title: '50% off',
    subtitle: 'Half price for your first month',
    percentOff: 50,
    discountedMonths: 1,
  },
  {
    id: 'twoforone',
    title: 'Two months for the price of one',
    subtitle: '50% off each of your first two monthly bills',
    percentOff: 50,
    discountedMonths: 2,
  },
  {
    id: 'quarter2',
    title: '25% off',
    subtitle: '25% off each of your first two months',
    percentOff: 25,
    discountedMonths: 2,
  },
];

export const welcomeOffersEnabled = import.meta.env.VITE_WAVO_WELCOME_OFFERS_ENABLED === 'true';

// Student pricing already includes a discount, so it cannot be stacked.
export function canOfferWelcomeDeal(plan) {
  return welcomeOffersEnabled && plan !== 'student';
}

export function welcomePriceForMonth(priceAud, offerId, month) {
  const fullCents = Math.round(priceAud * 100);
  const deal = WELCOME_OFFERS.find((item) => item.id === offerId);
  if (!deal || month > deal.discountedMonths) return fullCents / 100;
  return (fullCents - Math.round(fullCents * deal.percentOff / 100)) / 100;
}
