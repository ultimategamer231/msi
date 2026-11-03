# Reference implementation of the loan money rules (integer cents, basis points, round half up).
from datetime import date
import calendar

def rnd(n, d):  # round half up, positive ints
    return (2 * n + d) // (2 * d)

def pct(amount, bps):
    return rnd(amount * bps, 10000)

def add_months(d, n):
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)

def penalties(total_due, original_due, bps, periods, base):
    out, owed = [], total_due
    for i in range(1, periods + 1):
        b = owed if base == 'outstanding_total' else original_due
        p = pct(b, bps)
        owed += p
        out.append((i, b, p, owed))
    return out

def allocate(pay, pen, intr, prin):
    a = {}
    for k, v in (('penalty', pen), ('interest', intr), ('principal', prin)):
        x = min(pay, v); a[k] = x; pay -= x
    a['unallocated'] = pay
    return a

P = 100000  # $1,000.00
I = pct(P, 2000 * 1)  # 1 month
print('interest', I, 'total', P + I)
print('due date 31 Jan + 1m:', add_months(date(2026, 1, 31), 1), '| 5 Jan +1m:', add_months(date(2026, 1, 5), 1))
for base in ('outstanding_total', 'original_due'):
    print(base)
    for r in penalties(P + I, P + I, 2000, 4, base):
        print('  wk', r[0], 'base', r[1], 'pen', r[2], 'owed', r[3])
# partial payment after wk1 (outstanding_total base)
owed_pen = pct(P + I, 2000)
print('alloc 500 after wk1:', allocate(50000, owed_pen, I, P))
# then wk2 penalty on remaining 940
rem = P - 6000
print('remaining principal', rem, 'wk2 pen', pct(rem, 2000), 'owed', rem + pct(rem, 2000))
# extension: 1000 principal outstanding, +1 month
print('extension interest', pct(P, 2000))
# rounding case
print('round 33.33 * 20%', pct(3333, 2000), '| 0.05 half up', pct(25, 2000))
# collateral sale: owed after wk4 2488.32, sale 2000 -> allocate
print('sale 2000 vs 2488.32 (pen 1288.32,int 200,prin 1000):', allocate(200000, 128832, 20000, 100000))
print('sale 3000:', allocate(300000, 128832, 20000, 100000))

# T-33 oracle: late accrual run equals daily run for penalty amounts and total outstanding
k1 = pct(P + I, 2000)
a = allocate(50000, k1, I, P); prinA = P - a['principal']; k2A = pct(prinA, 2000)
b = allocate(50000, 0, I, P); prinB = P - b['principal']; k2B = pct(prinB + k1, 2000)
print('T-33 run A owed', prinA + k2A, '| run B owed', prinB + k1 + k2B, '| k2', k2A, k2B)
assert k2A == k2B == 18800 and prinA + k2A == prinB + k1 + k2B == 112800
