"""Transaction tracking — add page (slides 10–18)."""

import dash
import pandas as pd

from src.app.txn_form import build_form

dash.register_page(__name__, path="/transactions/add", name="Add Transaction")


def layout(date=None, month=None, **_):
    # `date` (?date=YYYY-MM-DD) arrives when a day header is clicked; `month`
    # (?month=YYYY-MM) carries the month the user was viewing. Either lets the
    # "‹ Transactions" / Save navigation return to where they came from.
    initial = None
    origin_month = month
    if date:
        try:
            ts = pd.Timestamp(date)
            initial = {"period": ts}
            origin_month = origin_month or ts.strftime("%Y-%m")
        except (ValueError, TypeError):
            initial = None
    return build_form("add", initial=initial, origin_month=origin_month)
