import { useLiveTxns } from './useLiveTxns'
import { t } from '../i18n'

export function Home() {
  const txns = useLiveTxns()
  const income = txns.filter((x) => x.type === 'Income').reduce((s, x) => s + x.amount, 0)
  const expense = txns.filter((x) => x.type === 'Expense').reduce((s, x) => s + x.amount, 0)
  const net = income - expense

  return (
    <div>
      <h1 className="h1">{t('Home')}</h1>
      <p className="muted">{t('Your data is stored on this device only.')}</p>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>{t('Income')}</div>
            <div className="money" style={{ fontSize: 22, color: 'var(--income)' }}>
              {income.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>{t('Expense')}</div>
            <div className="money" style={{ fontSize: 22, color: 'var(--expense)' }}>
              {expense.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Net</div>
            <div className="money" style={{ fontSize: 22 }}>{net.toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
