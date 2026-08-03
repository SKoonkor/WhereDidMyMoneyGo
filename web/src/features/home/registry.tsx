// What each widget id actually is: its title, the page it belongs to, the CSS
// class its box wants, and the component that draws it.
//
// Typed as Record<…Id, Def> so TypeScript refuses to compile if homeLayout.ts
// gains an id this file forgot — the registry can never drift from the model.
//
// Titles and descriptions are stored as their ENGLISH strings, which are the
// i18n keys, and passed through t() at the render site. Translating them here
// would freeze the language at module-eval time, since t() reads the current
// language on every call.
import type { HomeItem, LargeWidgetId, SmallWidgetId } from '../../lib/homeLayout'
import {
  NetWorthHero, FlowWidget, BudgetWidget, LimitsWidget, PoolWidget, GoalSavingsWidget, AccountsWidget,
  DebtsWidget,
} from './large'
import { SmallRow } from './SmallRow'
import { MiniTrend } from './small/MiniTrend'
import { MiniBudgetBars } from './small/MiniBudgetBars'
import { MiniBudgetPie } from './small/MiniBudgetPie'
import { MiniLimits } from './small/MiniLimits'
import { MiniPoolGauge } from './small/MiniPoolGauge'
import { MiniGoals } from './small/MiniGoals'
import { MiniInOut } from './small/MiniInOut'
import { MiniDebt } from './small/MiniDebt'
import { MiniDsr } from './small/MiniDsr'

// Every large widget is handed its instance and the edit state; only the
// widget-row container has any use for them.
export interface WidgetProps {
  item: HomeItem
  editing: boolean
  /** Open the small-widget picker for one of this container's slots. */
  onPickSlot: (index: number) => void
}

export interface LargeDef {
  title: string
  desc: string
  /** Where "Go to page" sends you. Absent for the widget-row container. */
  route?: string
  /** The section name shown in the action sheet, when it differs from `title`. */
  routeLabel?: string
  className?: string
  /** Boxes without a header can't fold (a 90px hero has no room for a title bar). */
  header: boolean
  Render: React.ComponentType<WidgetProps>
}

export const LARGE: Record<LargeWidgetId, LargeDef> = {
  networth: {
    title: 'Net worth',
    desc: 'Everything you own, in one number.',
    route: '/flow', routeLabel: 'Money Flow',
    className: 'nw-hero', header: false, Render: NetWorthHero,
  },
  flow: {
    title: 'Money Flow',
    desc: 'Running balance and the forward forecast.',
    route: '/flow',
    className: 'dash-card plot-card', header: true, Render: FlowWidget,
  },
  budget: {
    title: 'Budget',
    desc: "This period's Needs / Wants / Savings bars.",
    route: '/budget',
    className: 'budget-card', header: true, Render: BudgetWidget,
  },
  limits: {
    title: 'Spending limits',
    desc: 'How close you are to each limit.',
    route: '/limits',
    className: 'budget-card', header: true, Render: LimitsWidget,
  },
  pool: {
    title: 'Savings Pool',
    desc: 'Emergency Fund plus the goals you ticked.',
    route: '/goals', routeLabel: 'Financial Goals',
    className: 'goals-gauge-card', header: true, Render: PoolWidget,
  },
  goals: {
    title: 'Goal savings',
    desc: 'How your pool is split between goals.',
    route: '/goal-savings',
    className: 'budget-card', header: true, Render: GoalSavingsWidget,
  },
  accounts: {
    title: 'Account balances',
    desc: 'What sits in each account right now.',
    route: '/transactions', routeLabel: 'Transactions',
    className: 'dash-card', header: true, Render: AccountsWidget,
  },
  debts: {
    title: 'Debts',
    desc: 'What you owe and what it takes from your income.',
    route: '/debts',
    className: 'budget-card', header: true, Render: DebtsWidget,
  },
  smallrow: {
    title: 'Widget row',
    desc: 'Holds up to three small previews side by side.',
    className: 'small-row-card', header: false, Render: SmallRow,
  },
}

export interface SmallDef {
  title: string
  Render: React.ComponentType
}

export const SMALL: Record<SmallWidgetId, SmallDef> = {
  'mini-trend': { title: '3-Month flow', Render: MiniTrend },
  'mini-bars': { title: 'Budget bars', Render: MiniBudgetBars },
  'mini-pie': { title: 'Budget used', Render: MiniBudgetPie },
  'mini-limits': { title: 'Limits', Render: MiniLimits },
  'mini-pool': { title: 'Savings Pool', Render: MiniPoolGauge },
  'mini-goals': { title: 'Goal savings', Render: MiniGoals },
  'mini-inout': { title: 'Income & Output', Render: MiniInOut },
  'mini-debt': { title: 'Debts', Render: MiniDebt },
  'mini-dsr': { title: 'Debt ratio', Render: MiniDsr },
}
