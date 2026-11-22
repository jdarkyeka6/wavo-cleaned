import { WELCOME_OFFERS, welcomePriceForMonth } from './lib/welcomeOffers'
import './welcome-offers.css'

const currency = (value) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value)

export default function WelcomeOfferPicker({ price, selected, onChange }) {
  return (
    <fieldset className="wavo-welcome-picker">
      <legend>🎁 Choose your welcome deal</legend>
      <p className="wavo-welcome-intro">First subscription only. Pick one, with no stacking.</p>
      <div className="wavo-welcome-choices">
        {WELCOME_OFFERS.map((deal) => (
          <label key={deal.id} className={`wavo-welcome-choice ${selected === deal.id ? 'selected' : ''}`}>
            <input type="radio" name="wavo-welcome-offer" value={deal.id}
              checked={selected === deal.id} onChange={() => onChange(deal.id)} />
            <span><strong>{deal.title}</strong><small>{deal.subtitle}</small></span>
          </label>
        ))}
      </div>
      <div className="wavo-welcome-breakdown" aria-live="polite">
        <strong>Your first three payments</strong>
        {[1, 2, 3].map((month) => (
          <div key={month}>
            <span>Month {month}</span>
            <strong>{currency(welcomePriceForMonth(price, selected, month))}</strong>
          </div>
        ))}
      </div>
      <p className="wavo-welcome-renewal">
        Auto-renews at {currency(price)}/month after your welcome offer unless cancelled.
        The two-for-one offer spreads the savings equally across the first two bills;
        it does not make month two a zero-dollar invoice.
      </p>
    </fieldset>
  )
}
